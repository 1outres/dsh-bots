"""Typing a login's value into a desktop application (docs/specs/bot-vaults.md §9).

The target is checked when it is chosen, before the Host asks for the value, and again right before and after
typing. The value is only ever bytes handed to xdotool's standard input: never an argument, the clipboard, a
log line, an error or a reply.
"""
import base64
import binascii
import os
import secrets
import subprocess
import time
from dataclasses import dataclass
from typing import Optional

import pyatspi

from . import atspi_access as ax
from .errors import RpcError

FIELDS = ("username", "password", "otp")
PASSWORD_ROLE = "password text"
TARGET_TTL_S = 120
MAX_VALUE_BYTES = 1024
TYPE_TIMEOUT_S = 60
BROWSER_APPLICATIONS = frozenset({"google chrome", "chrome", "chromium", "chromium-browser", "firefox",
                                  "firefox-esr", "brave", "brave browser", "microsoft edge", "opera", "vivaldi",
                                  "epiphany"})
BROWSER_EXECUTABLES = frozenset({"chrome", "google-chrome", "chromium", "chromium-browser", "firefox",
                                 "firefox-esr", "firefox-bin", "brave", "msedge", "opera", "vivaldi-bin",
                                 "epiphany"})


@dataclass(frozen=True)
class SecretTarget:
    token: str
    acc: object
    field: str
    pid: int
    application: str
    expires: float


class SecretTargets:
    """The one target waiting for its value (the Host serializes calls on the display)."""

    def __init__(self):
        self._pending: Optional[SecretTarget] = None

    def put(self, target: SecretTarget):
        self._pending = target

    def take(self, token: str) -> SecretTarget:
        target, self._pending = self._pending, None
        if target is None or not secrets.compare_digest(target.token, token):
            raise RpcError("target_expired", "no field is waiting for this value; choose the field again")
        if time.monotonic() > target.expires:
            raise RpcError("target_expired", "the field was chosen too long ago; choose it again")
        return target


def _executable(pid: int) -> str:
    try:
        return os.path.basename(os.readlink(f"/proc/{pid}/exe"))
    except OSError:
        raise RpcError("stale_element", "the application of the field is gone; take a new desktop_tree")


def is_browser(application: str, pid: int) -> bool:
    return application.lower() in BROWSER_APPLICATIONS or _executable(pid) in BROWSER_EXECUTABLES


def _application(acc) -> tuple[str, int]:
    app = acc.getApplication()
    if app is None:
        raise RpcError("stale_element", "the field belongs to no application; take a new desktop_tree")
    return ax.name(app), app.get_process_id()


def check_field(acc, field: str) -> tuple[str, int]:
    """The application (name, pid) of a field the value may go in."""
    if ax.is_defunct(acc):
        raise RpcError("stale_element", "the element is gone; take a new desktop_tree")
    application, pid = _application(acc)
    if is_browser(application, pid):
        raise RpcError("browser_refused", f"{application} is a web browser: fill logins there with "
                                          "browser_fill_credential, which checks the site")
    role = ax.role(acc)
    editable = "EditableText" in ax.interfaces(acc) and acc.getState().contains(pyatspi.STATE_EDITABLE)
    if not editable:
        raise RpcError("not_a_text_field", f"{role} {ax.name(acc)!r} is not an editable text field; "
                                           "focus the field the value goes in")
    if field == "password" and role != PASSWORD_ROLE:
        raise RpcError("not_a_password_field", f"a password goes only into a password field ({PASSWORD_ROLE}), "
                                               f"not into {role} {ax.display_name(acc, role)!r}")
    return application, pid


def new_target(acc, field: str) -> SecretTarget:
    application, pid = check_field(acc, field)
    return SecretTarget(secrets.token_hex(16), acc, field, pid, application, time.monotonic() + TARGET_TTL_S)


def require_focus(target: SecretTarget, active_pid: Optional[int]):
    """The chosen field still has the keyboard focus, in the active window, and is still a field the value may go in."""
    if ax.is_defunct(target.acc) or not target.acc.getState().contains(pyatspi.STATE_FOCUSED):
        raise RpcError("focus_moved", "the field no longer has the keyboard focus; look at the screen and "
                                      "choose the field again")
    if active_pid != target.pid:
        raise RpcError("focus_moved", "another window is active now; look at the screen and choose the field again")
    if check_field(target.acc, target.field) != (target.application, target.pid):
        raise RpcError("focus_moved", "the field changed; choose it again")


def decode(encoded) -> bytes:
    if not isinstance(encoded, str) or len(encoded) > MAX_VALUE_BYTES * 2:
        raise RpcError("invalid_params", "type_secret needs a secret in base64")
    try:
        return base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise RpcError("invalid_params", "the secret is not base64")


def typeable(value: bytes) -> bool:
    """Printable ASCII only: the keys of the desktop's keymap. xdotool types other characters through a spare key it
    remaps on the fly, and applications then drop some or change their case, silently."""
    return 0 < len(value) <= MAX_VALUE_BYTES and all(0x20 <= b <= 0x7e for b in value)


def clear(acc):
    count = acc.queryText().characterCount
    if count > 0 and not acc.queryEditableText().deleteText(0, count):
        raise RpcError("action_failed", "the field's text could not be cleared")


def check_typed(acc, value: bytes):
    """Every character arrived (an input method or the application can drop keys silently); a partial value is cleared."""
    if acc.queryText().characterCount != len(value):
        clear(acc)
        raise RpcError("typed_incompletely", "the field did not receive the whole value (an input method or the "
                                             "application dropped keys), so it was cleared; try again")


def type_value(value: bytes):
    proc = subprocess.run(["xdotool", "type", "--clearmodifiers", "--delay", "12", "--file", "-"], input=value,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=TYPE_TIMEOUT_S)
    if proc.returncode != 0:
        raise RpcError("input_failed", "xdotool could not type the value")
