"""The agent's type_secret (docs/specs/bot-vaults.md §9), without a desktop: AT-SPI, GLib and the X tools are
stand-ins. Run by agent-secret.test.ts as `python3 -I test_secret_input.py <vm/agent>`."""
import base64
import contextlib
import io
import json
import sys
import types
import unittest

sys.path.insert(0, sys.argv.pop(1))


class _Sentinels(types.ModuleType):
    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        value = f"<{self.__name__}.{name}>"
        setattr(self, name, value)
        return value


def _stub(name, **attrs):
    module = _Sentinels(name)
    for key, value in attrs.items():
        setattr(module, key, value)
    sys.modules[name] = module
    return module


class _GLibError(Exception):
    message = ""


gi = _stub("gi", require_version=lambda *_: None)
gi.repository = _stub("gi.repository", GLib=types.SimpleNamespace(Error=_GLibError))
_stub("pyatspi", Registry=types.SimpleNamespace(registerEventListener=lambda *_: None))
_stub("PIL")
_stub("PIL.Image")
_stub("PIL.ImageGrab")

import pyatspi  # noqa: E402

from dsh_desktop_agent import secret_input, server, service  # noqa: E402
from dsh_desktop_agent.snapshots import SnapshotStore  # noqa: E402

VALUE = "Tr0ub4dor&3 secret~{}"
VALUE_BYTES = VALUE.encode()


class States:
    def __init__(self, states):
        self.states = states

    def contains(self, state):
        return state in self.states


class App:
    def __init__(self, name, pid):
        self.name = name
        self.pid = pid

    def get_process_id(self):
        return self.pid


class Field:
    def __init__(self, role="password text", app="zenity", pid=41, editable=True, text=""):
        self.role = role
        self.name = "Password"
        self.app = App(app, pid)
        self.states = {pyatspi.STATE_FOCUSED, pyatspi.STATE_SHOWING}
        if editable:
            self.states.add(pyatspi.STATE_EDITABLE)
        self.ifaces = ["Text", "Component"] + (["EditableText"] if editable else [])
        self.count = len(text)
        self.deleted = []

    def getRoleName(self):
        return self.role

    def getApplication(self):
        return self.app

    def get_interfaces(self):
        return self.ifaces

    def getState(self):
        return States(self.states)

    def getRelationSet(self):
        return []

    def queryText(self):
        return types.SimpleNamespace(characterCount=self.count)

    def queryEditableText(self):
        field = self

        class Editable:
            def deleteText(self, start, end):
                field.deleted.append((start, end))
                field.count = 0
                return True

        return Editable()

    def queryComponent(self):
        field = self

        class Component:
            def grabFocus(self):
                field.states.add(pyatspi.STATE_FOCUSED)
                return True

        return Component()


class Observer:
    def __init__(self, focused):
        self._focused = focused

    def focused(self):
        return self._focused

    def active_window(self):
        return None

    def focus_summary(self):
        return None


class Run:
    """xdotool: `type` puts the characters into the focused field (all of them, or `drop` fewer)."""

    def __init__(self):
        self.calls = []
        self.field = None
        self.drop = 0

    def __call__(self, argv, input=None, **_):
        self.calls.append((list(argv), input))
        if argv[:2] == ["xdotool", "type"]:
            self.field.count += len(input) - self.drop
        return types.SimpleNamespace(returncode=0, stdout=b"", stderr=b"")


class TypeSecret(unittest.TestCase):
    def setUp(self):
        self.field = Field()
        self.active_pid = 41
        self.executables = {41: "zenity"}
        self.run = Run()
        self.run.field = self.field
        self.patches = [
            (service, "pump", lambda _ms: None),
            (service, "x_active_window", lambda: (self.active_pid, "Password")),
            (secret_input, "_executable", lambda pid: self.executables[pid]),
            (secret_input.subprocess, "run", self.run),
        ]
        self.saved = [(m, n, getattr(m, n)) for m, n, _ in self.patches]
        for module, name, value in self.patches:
            setattr(module, name, value)
        desktop = service.DesktopService.__new__(service.DesktopService)
        desktop.snapshots = SnapshotStore()
        desktop.observer = Observer(self.field)
        desktop.secret_targets = secret_input.SecretTargets()
        self.desktop = desktop
        self.server = server.Server.__new__(server.Server)
        self.server.service = desktop
        self.stderr = io.StringIO()

    def tearDown(self):
        for module, name, value in self.saved:
            setattr(module, name, value)
        self.assertNotIn(VALUE, self.stderr.getvalue())

    def request(self, method, params, secret=None, request_id=1):
        message = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
        if secret is not None:
            message["secret"] = base64.b64encode(secret).decode()
        with contextlib.redirect_stderr(self.stderr):
            reply = self.server._handle(json.dumps(message).encode())
        text = json.dumps(reply, ensure_ascii=False)
        self.assertNotIn(VALUE, text)
        self.assertNotIn(base64.b64encode(VALUE_BYTES).decode(), text)
        return reply

    def target(self, field="password", **params):
        reply = self.request("secret_target", {"field": field, **params})
        self.assertIn("result", reply, reply)
        return reply["result"]

    def typed(self):
        return [call for call in self.run.calls if call[0][:2] == ["xdotool", "type"]]

    def test_types_the_value_through_stdin_only(self):
        self.field.count = 3
        token = self.target()["token"]
        reply = self.request("type_secret", {"token": token, "submit": True}, VALUE_BYTES)
        self.assertEqual(reply["result"]["application"], "zenity")
        self.assertEqual(self.field.deleted, [(0, 3)])
        [(argv, stdin)] = self.typed()
        self.assertEqual(argv[-2:], ["--file", "-"])
        self.assertFalse(any(VALUE in arg for arg in argv))
        self.assertEqual(stdin, VALUE_BYTES)
        self.assertEqual(self.run.calls[-1][0][:2], ["xdotool", "key"])
        self.assertFalse(any("xclip" in call[0][0] for call in self.run.calls))

    def test_a_token_is_used_once(self):
        token = self.target()["token"]
        self.request("type_secret", {"token": token, "submit": False}, VALUE_BYTES)
        reply = self.request("type_secret", {"token": token, "submit": False}, VALUE_BYTES)
        self.assertEqual(reply["error"]["code"], "target_expired")
        self.assertEqual(len(self.typed()), 1)

    def test_refuses_browsers_by_name_and_by_executable(self):
        self.field.app = App("Google Chrome", 41)
        self.assertEqual(self.request("secret_target", {"field": "username"})["error"]["code"], "browser_refused")
        self.field.app = App("renamed", 41)
        self.executables[41] = "chrome"
        self.assertEqual(self.request("secret_target", {"field": "username"})["error"]["code"], "browser_refused")

    def test_a_password_goes_only_into_a_password_field(self):
        self.field.role = "text"
        self.assertEqual(self.request("secret_target", {"field": "password"})["error"]["code"], "not_a_password_field")
        self.target("username")
        self.target("otp")

    def test_refuses_fields_that_are_not_editable(self):
        self.field = Field(role="label", editable=False)
        self.desktop.observer = Observer(self.field)
        self.assertEqual(self.request("secret_target", {"field": "username"})["error"]["code"], "not_a_text_field")

    def test_types_nothing_when_the_focus_moved(self):
        token = self.target()["token"]
        self.field.states.discard(pyatspi.STATE_FOCUSED)
        reply = self.request("type_secret", {"token": token, "submit": False}, VALUE_BYTES)
        self.assertEqual(reply["error"]["code"], "focus_moved")
        self.field.states.add(pyatspi.STATE_FOCUSED)
        token = self.target()["token"]
        self.active_pid = 77
        reply = self.request("type_secret", {"token": token, "submit": False}, VALUE_BYTES)
        self.assertEqual(reply["error"]["code"], "focus_moved")
        self.assertEqual(self.typed(), [])

    def test_types_nothing_it_cannot_type_with_keys(self):
        for value in (VALUE_BYTES + b"\n", b"\xff" + VALUE_BYTES, VALUE_BYTES + b"\x1b", b"", "pässwörd".encode()):
            token = self.target()["token"]
            reply = self.request("type_secret", {"token": token, "submit": False}, value)
            self.assertEqual(reply["error"]["code"], "untypeable")
        self.assertEqual(self.typed(), [])

    def test_says_when_the_focus_moved_while_typing(self):
        token = self.target()["token"]

        def steal_focus(argv, input=None, **_):
            self.run.calls.append((list(argv), input))
            self.field.states.discard(pyatspi.STATE_FOCUSED)
            return types.SimpleNamespace(returncode=0)

        secret_input.subprocess.run = steal_focus
        reply = self.request("type_secret", {"token": token, "submit": True}, VALUE_BYTES)
        self.assertEqual(reply["error"]["code"], "focus_moved")
        self.assertIn("while typing", reply["error"]["message"])
        self.assertEqual([call[0][1] for call in self.run.calls], ["type"])

    def test_clears_a_value_that_arrived_incompletely(self):
        token = self.target()["token"]
        self.run.drop = 1
        reply = self.request("type_secret", {"token": token, "submit": True}, VALUE_BYTES)
        self.assertEqual(reply["error"]["code"], "typed_incompletely")
        self.assertEqual(self.field.count, 0)
        self.assertEqual([call[0][1] for call in self.run.calls], ["type"])

    def test_an_unexpected_failure_never_echoes_the_value(self):
        def explode(value):
            raise ValueError(f"cannot type {value!r} {value.decode()}")

        secret_input_type, secret_input.type_value = secret_input.type_value, explode
        try:
            token = self.target()["token"]
            reply = self.request("type_secret", {"token": token, "submit": False}, VALUE_BYTES)
        finally:
            secret_input.type_value = secret_input_type
        self.assertEqual(reply["error"], {"code": "internal", "message": "type_secret failed"})

    def test_a_secret_goes_only_to_type_secret(self):
        reply = self.request("clipboard_set", {"text": "x"}, VALUE_BYTES)
        self.assertEqual(reply["error"]["code"], "invalid_params")
        reply = self.request("type_secret", {"token": "x", "submit": False})
        self.assertEqual(reply["error"]["code"], "invalid_params")
        self.assertEqual(self.run.calls, [])

    def test_focuses_the_element_it_is_given(self):
        self.field.states.discard(pyatspi.STATE_FOCUSED)
        self.desktop.observer = Observer(None)
        element = self.desktop.snapshots.create().add(self.field)
        result = self.target(element=element)
        self.assertEqual(result["role"], "password text")
        self.assertIn(pyatspi.STATE_FOCUSED, self.field.states)


class Typeable(unittest.TestCase):
    def test_printable_ascii_only(self):
        for good in (b" ~", bytes(range(0x20, 0x7f)), b"x" * secret_input.MAX_VALUE_BYTES):
            self.assertTrue(secret_input.typeable(good), good)
        for bad in (b"", b"a\x00", b"a\x7f", b"a\tb", b"a\nb", b"\xc3\xbc", "パス".encode(), "Ü".encode(),
                    b"x" * (secret_input.MAX_VALUE_BYTES + 1)):
            self.assertFalse(secret_input.typeable(bad), bad)


if __name__ == "__main__":
    unittest.main()
