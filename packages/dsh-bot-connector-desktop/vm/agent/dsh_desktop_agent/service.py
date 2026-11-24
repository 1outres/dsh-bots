"""The JSON-RPC methods. Holds the agent's state (snapshots, observer); the logic lives in the modules it calls."""
import json
import time
from typing import Any, Optional

from . import actions
from . import atspi_access as ax
from . import inputs, launcher, params, render, screen, sheet, walker
from .errors import RpcError, invalid_params, unsupported
from .limits import (ACT_MAX_MS, ACT_MIN_MS, DEFAULT_TREE, FIND_LIMIT, FIND_VISIT_BUDGET, INPUT_SETTLE_MS,
                     SEQUENCE_MAX_STEPS, TEXT_LIMIT, TreeLimits)
from .loop import pump
from .model import Node, Rect
from .observer import Observer
from .snapshots import SnapshotStore

FORMATS = ("text", "json")
PASTE_COMBOS = ("ctrl+v", "ctrl+shift+v")
INPUT_KINDS = ("click", "move", "mouse_down", "mouse_up", "scroll", "drag", "key", "type", "hold_key")


class DesktopService:
    def __init__(self, display: str):
        self.display = display
        self.snapshots = SnapshotStore()
        self.observer = Observer(self._screen())

    def _screen(self) -> Rect:
        w, h = inputs.display_size()
        return Rect(0, 0, w, h)

    def _scope(self, scope: str):
        if scope == "active":
            found = self.observer.active_window()
            if found is None:
                raise RpcError("no_active_window", "no window is active: desktop_launch an app or desktop_focus_window one")
            return found[1]
        return self.snapshots.resolve(scope)

    def _limits(self, p: dict) -> TreeLimits:
        return TreeLimits(
            max_depth=params.integer(p, "max_depth", DEFAULT_TREE.max_depth, 1, 64),
            max_nodes=params.integer(p, "max_nodes", DEFAULT_TREE.max_nodes, 1, 2000),
            max_text=params.integer(p, "max_text", DEFAULT_TREE.max_text, 8, 4000),
            max_children=DEFAULT_TREE.max_children,
            table_max_cells=params.integer(p, "max_cells", DEFAULT_TREE.table_max_cells, 1, 480),
        )

    def _check_screen(self, p: dict) -> Rect:
        current = self._screen()
        self.observer.screen = current
        expected = params.obj(p, "expect_screen", None)
        if expected is not None and (expected.get("width"), expected.get("height")) != (current.w, current.h):
            raise RpcError("screen_changed", f"the screen is {current.w}x{current.h} now")
        return current

    def _point(self, p: dict, key: str, screen_rect: Rect) -> tuple[int, int]:
        at = params.obj(p, key)
        if "element" in at:
            return ax.center_on_screen(self.snapshots.resolve(params.text(at, "element")), screen_rect)
        x, y = params.integer(at, "x"), params.integer(at, "y")
        if not (0 <= x < screen_rect.w and 0 <= y < screen_rect.h):
            raise invalid_params(f"{x},{y} is outside the {screen_rect.w}x{screen_rect.h} screen")
        return x, y

    def _where(self) -> dict:
        active = self.observer.active_window()
        return {"active_window": active[0].label() if active else None, "focus": self.observer.focus_summary()}

    def status(self, p: dict) -> dict:
        screen_rect = self._check_screen(p)
        snapshot = self.snapshots.create()
        windows = [dict(info.label(), id=snapshot.add(win), active=info.active) for info, win in self.observer.windows()]
        return {"screen": {"width": screen_rect.w, "height": screen_rect.h}, "windows": windows,
                "focus": self.observer.focus_summary()}

    def launch(self, p: dict) -> dict:
        before = {info.key() for info, _ in self.observer.windows()}
        unit = launcher.launch(params.choice(p, "app", tuple(launcher.APPS)), params.strings(p, "args", [], 8))
        deadline = time.monotonic() + params.integer(p, "wait_ms", 20000, 0, 60000) / 1000
        while time.monotonic() < deadline:
            pump(250)
            opened = [info for info, _ in self.observer.windows() if info.key() not in before]
            if opened:
                pump(300)
                return {"unit": unit, "opened": [w.label() for w in opened], **self._where()}
        return {"unit": unit, "opened": [], **self._where()}

    def tree(self, p: dict) -> dict:
        started = time.monotonic()
        limits = self._limits(p)
        fmt = params.choice(p, "format", FORMATS, "text")
        geometry = params.flag(p, "geometry")
        root = self._scope(params.text(p, "scope", "active"))
        snapshot = self.snapshots.create()
        try:
            top, count = walker.build(root, snapshot, limits, self.observer.screen)
        except LookupError:
            raise unsupported("the element is not showing")
        body: Any = render.as_lines(top, geometry) if fmt == "text" else render.as_dict(top, geometry)
        return {"snapshot": snapshot.number, "nodes": count, "ms": _ms(started), "tree": body}

    def find(self, p: dict) -> dict:
        started = time.monotonic()
        limits = self._limits(p)
        fmt = params.choice(p, "format", FORMATS, "text")
        geometry = params.flag(p, "geometry")
        root = self._scope(params.text(p, "scope", "active"))
        snapshot = self.snapshots.create()
        match = _matcher(params.text(p, "role", None), params.text(p, "name", None), params.text(p, "text", None),
                         params.strings(p, "states", []))
        nodes, visited, truncated = walker.search(root, match, snapshot, limits, self.observer.screen,
                                                  params.integer(p, "visit_budget", FIND_VISIT_BUDGET, 1, 20000),
                                                  params.integer(p, "limit", FIND_LIMIT, 1, 200))
        body: Any = "\n".join(render.line(n, geometry) for n in nodes) if fmt == "text" else render.flat(nodes, geometry)
        return {"snapshot": snapshot.number, "matches": len(nodes), "visited": visited, "truncated": truncated,
                "ms": _ms(started), "results": body}

    def act(self, p: dict) -> dict:
        acc = self.snapshots.resolve(params.text(p, "id"))
        if ax.is_defunct(acc):
            raise RpcError("stale_element", "the element is gone; take a new desktop_tree")
        action = params.choice(p, "action", actions.ACTIONS)
        screen_rect = self._check_screen(p)
        before = self._state(acc)
        actions.perform(acc, action, p, screen_rect)
        after = self._settle(acc, before, params.integer(p, "settle_ms", ACT_MAX_MS, ACT_MIN_MS, ACT_MAX_MS))
        return _changes(before, after)

    def _state(self, acc) -> dict:
        windows = self.observer.windows()
        active = next((info for info, _ in windows if info.active), None)
        return {"windows": {info.key(): info for info, _ in windows}, "active": active,
                "focus": self.observer.focus_summary(), "target": _target_state(acc), }

    def _settle(self, acc, before: dict, max_ms: int) -> dict:
        deadline = time.monotonic() + max_ms / 1000
        pump(ACT_MIN_MS)
        while True:
            state = self._state(acc)
            if _fingerprint(state) != _fingerprint(before):
                pump(150)
                return self._state(acc)
            if time.monotonic() >= deadline:
                return state
            pump(100)

    def input(self, p: dict) -> dict:
        screen_rect = self._check_screen(p)
        result = self._input(p, screen_rect)
        pump(params.integer(p, "settle_ms", INPUT_SETTLE_MS, 0, 2000))
        result.update(self._where())
        return result

    def _input(self, p: dict, screen_rect: Rect) -> dict:
        kind = params.choice(p, "kind", INPUT_KINDS)
        button = params.choice(p, "button", tuple(inputs.BUTTONS), "left")
        if kind == "click":
            x, y = self._point(p, "at", screen_rect)
            inputs.click(x, y, button, params.integer(p, "count", 1, 1, 3), params.strings(p, "modifiers", [], 4))
        elif kind == "move":
            x, y = self._point(p, "at", screen_rect)
            inputs.move(x, y)
        elif kind == "mouse_down":
            x, y = self._point(p, "at", screen_rect)
            inputs.mouse_down(x, y, button)
        elif kind == "mouse_up":
            x, y = self._point(p, "at", screen_rect)
            inputs.mouse_up(x, y, button)
        elif kind == "scroll":
            x, y = self._point(p, "at", screen_rect)
            inputs.scroll(x, y, params.choice(p, "direction", tuple(inputs.SCROLL_BUTTONS)),
                          params.integer(p, "amount", 3, 1, 30))
        elif kind == "drag":
            x1, y1 = self._point(p, "from", screen_rect)
            x2, y2 = self._point(p, "to", screen_rect)
            inputs.drag(x1, y1, x2, y2, button)
        elif kind == "key":
            inputs.key(params.strings(p, "keys", max_items=32))
        elif kind == "hold_key":
            inputs.hold_key(params.text(p, "keys", max_len=64), params.integer(p, "duration_ms", lo=10, hi=10000))
        elif kind == "type":
            return {"via": inputs.type_text(params.text(p, "text", max_len=20000),
                                            params.choice(p, "paste", PASTE_COMBOS, "ctrl+v"))}
        if kind in ("click", "move", "mouse_down", "mouse_up", "scroll", "drag"):
            x, y = inputs.cursor()
            return {"pointer": {"x": x, "y": y}}
        return {}

    def sequence(self, p: dict) -> dict:
        screen_rect = self._check_screen(p)
        steps = params.items(p, "steps", SEQUENCE_MAX_STEPS)
        settle = params.integer(p, "settle_ms", 60, 0, 2000)
        done = 0
        for step in steps:
            try:
                kind = step.get("kind")
                if kind == "activate":
                    actions.activate_window(self.snapshots.resolve(params.text(step, "id")))
                elif kind == "await_focus":
                    self._await_focus(params.text(step, "role", max_len=64), params.integer(step, "timeout_ms", 2000, 0, 10000))
                else:
                    self._input(step, screen_rect)
            except RpcError as e:
                raise RpcError(e.code, f"step {done + 1} of {len(steps)} ({step.get('kind')}) failed after {done} steps: {e.message}")
            pump(params.integer(step, "settle_ms", settle, 0, 2000))
            done += 1
        pump(INPUT_SETTLE_MS)
        return {"steps": done, **self._where()}

    def _await_focus(self, role: str, timeout_ms: int):
        deadline = time.monotonic() + timeout_ms / 1000
        while True:
            focus = self.observer.focus_summary()
            if focus is not None and focus["role"] == role:
                return
            if time.monotonic() >= deadline:
                found = "nothing" if focus is None else f"{focus['role']} {focus['name']!r}"
                raise RpcError("focus_missed", f"the focus did not reach a {role} within {timeout_ms} ms ({found} has it)")
            pump(50)

    def cursor(self, p: dict) -> dict:
        screen_rect = self._check_screen(p)
        x, y = inputs.cursor()
        return {"x": x, "y": y, "screen": {"width": screen_rect.w, "height": screen_rect.h}}

    def clipboard_get(self, p: dict) -> dict:
        text = inputs.get_clipboard()
        limit = params.integer(p, "limit", TEXT_LIMIT, 1, TEXT_LIMIT)
        return {"length": len(text), "text": text[:limit]}

    def clipboard_set(self, p: dict) -> dict:
        text = params.text(p, "text", max_len=100_000)
        inputs.set_clipboard(text)
        return {"length": len(text)}

    def screenshot(self, p: dict) -> dict:
        screen_rect = self._check_screen(p)
        target = params.text(p, "target", "screen")
        region: Optional[Rect]
        if target == "screen":
            region = None
        elif target == "active":
            region = ax.rect(self._scope("active"), {"Component"})
        else:
            acc = self.snapshots.resolve(target)
            region = ax.rect(acc, ax.interfaces(acc))
            if region is None:
                raise unsupported("the element has no on-screen extents")
        box = params.obj(p, "region", None)
        if box is not None:
            if region is not None:
                raise invalid_params("give a target or a region, not both")
            region = Rect(params.integer(box, "x"), params.integer(box, "y"), params.integer(box, "width", lo=1),
                          params.integer(box, "height", lo=1))
        fmt = params.choice(p, "format", ("png", "jpeg"), "png")
        width = params.integer(p, "width", (region or screen_rect).w, 16, 4096)
        try:
            return screen.capture(self.display, region, width, fmt, params.integer(p, "quality", 80, 10, 95))
        except ValueError as e:
            raise invalid_params(str(e))

    def text(self, p: dict) -> dict:
        acc = self.snapshots.resolve(params.text(p, "id"))
        if "Text" not in ax.interfaces(acc):
            raise unsupported("the element has no text; read its name in desktop_tree")
        full = ax.full_text(acc)
        start = params.integer(p, "offset", 0, 0)
        limit = params.integer(p, "limit", 4000, 1, TEXT_LIMIT)
        return {"length": len(full), "offset": start, "text": full[start:start + limit]}

    def sheet_read(self, p: dict) -> dict:
        found = self.observer.active_window()
        if found is None:
            raise RpcError("no_active_window", "no window is active")
        info, window = found
        snapshot = self.snapshots.create()
        out = sheet.read(window, self._check_screen(p), params.text(p, "range", None),
                         params.integer(p, "max_cells", 480, 1, sheet.MAX_CELLS), self.observer.active_descendant)
        out["window"] = {"id": snapshot.add(window), **info.label()}
        return out


def _ms(started: float) -> int:
    return round((time.monotonic() - started) * 1000)


def _fingerprint(state: dict) -> str:
    return json.dumps([sorted(state["windows"]), state["active"].key() if state["active"] else None,
                       state["focus"], state["target"]], ensure_ascii=False, sort_keys=True)


def _changes(before: dict, after: dict) -> dict:
    out: dict = {}
    opened = [w.label() for k, w in after["windows"].items() if k not in before["windows"]]
    closed = [w.label() for k, w in before["windows"].items() if k not in after["windows"]]
    if opened:
        out["opened"] = opened
    if closed:
        out["closed"] = closed
    if after["active"] != before["active"]:
        out["active_window"] = after["active"].label() if after["active"] else None
    if after["focus"] != before["focus"]:
        out["focus"] = after["focus"]
    out["target"] = after["target"]
    return out


def _matcher(role: Optional[str], name: Optional[str], text: Optional[str], states: list[str]):
    if role is None and name is None and text is None and not states:
        raise invalid_params("find needs role, name, text or states")
    name_l = name.lower() if name else None
    text_l = text.lower() if text else None

    def match(node: Node) -> bool:
        if role is not None and node.role != role:
            return False
        if name_l is not None and name_l not in node.name.lower():
            return False
        if text_l is not None and text_l not in (node.text or "").lower() and text_l not in node.name.lower():
            return False
        return all(s in node.states for s in states)

    return match


def _target_state(acc) -> dict:
    if ax.is_defunct(acc):
        return {"gone": True}
    ifaces = ax.interfaces(acc)
    st = acc.getState()
    out = ax.describe(acc)
    out["states"] = ax.states(st, "Action" in ifaces)
    if not ax.is_showing(st):
        out["states"].append("hidden")
    txt = ax.text(acc, ifaces, 120)
    if txt is not None:
        out["text"] = txt
    val = ax.value(acc, ifaces)
    if val is not None:
        out["value"] = val
    return out
