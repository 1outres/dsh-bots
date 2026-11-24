"""Synthetic input on the X display through xdotool / xclip."""
import re
import subprocess
import time

from .errors import RpcError, invalid_params

BUTTONS = {"left": "1", "middle": "2", "right": "3"}
SCROLL_BUTTONS = {"up": "4", "down": "5", "left": "6", "right": "7"}
MODIFIERS = {"ctrl": "ctrl", "shift": "shift", "alt": "alt", "super": "super"}
KEY_COMBO = re.compile(r"^[A-Za-z0-9_]+(\+[A-Za-z0-9_]+)*$")


def _run(argv: list[str], stdin: bytes = b""):
    proc = subprocess.run(argv, input=stdin, capture_output=True, timeout=30)
    if proc.returncode != 0:
        raise RpcError("input_failed", f"{argv[0]} failed: {proc.stderr.decode(errors='replace').strip()}")
    return proc.stdout.decode(errors="replace")


def check_combo(combo: str) -> str:
    if not KEY_COMBO.match(combo):
        raise invalid_params(f"{combo!r} is not a key combination like ctrl+s, Return or shift+Tab")
    return combo


def _modifiers(mods: list[str]) -> list[str]:
    for m in mods:
        if m not in MODIFIERS:
            raise invalid_params(f"modifier must be one of {sorted(MODIFIERS)}")
    return mods


def key(combos: list[str]):
    _run(["xdotool", "key", "--clearmodifiers", "--delay", "40", *[check_combo(c) for c in combos]])


def hold_key(combo: str, duration_ms: int):
    parts = check_combo(combo).split("+")
    _run(["xdotool", "keydown", *parts])
    try:
        time.sleep(duration_ms / 1000)
    finally:
        _run(["xdotool", "keyup", *reversed(parts)])


def type_text(text: str, paste_combo: str) -> str:
    if text.isascii():
        _run(["xdotool", "type", "--clearmodifiers", "--delay", "8", "--", text])
        return "typed"
    set_clipboard(text)
    key([paste_combo])
    return "pasted"


def set_clipboard(text: str):
    """xclip forks a child that keeps serving the selection; it must not inherit our pipes."""
    proc = subprocess.run(["xclip", "-selection", "clipboard", "-i"], input=text.encode(),
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
    if proc.returncode != 0:
        raise RpcError("input_failed", "xclip could not take the clipboard")


def get_clipboard() -> str:
    proc = subprocess.run(["xclip", "-selection", "clipboard", "-o"], stdin=subprocess.DEVNULL,
                          capture_output=True, timeout=10)
    return proc.stdout.decode(errors="replace") if proc.returncode == 0 else ""


def _with_modifiers(mods: list[str], argv: list[str]) -> list[str]:
    mods = _modifiers(mods)
    if not mods:
        return argv
    return [*argv[:1], "keydown", *mods, *argv[1:], "keyup", *reversed(mods)]


def move(x: int, y: int):
    _run(["xdotool", "mousemove", "--sync", str(x), str(y)])


def click(x: int, y: int, button: str, count: int, mods: list[str]):
    if button not in BUTTONS:
        raise invalid_params(f"button must be one of {sorted(BUTTONS)}")
    _run(_with_modifiers(mods, ["xdotool", "mousemove", "--sync", str(x), str(y),
                                "click", "--repeat", str(count), "--delay", "80", BUTTONS[button]]))


def mouse_down(x: int, y: int, button: str):
    _run(["xdotool", "mousemove", "--sync", str(x), str(y), "mousedown", BUTTONS[button]])


def mouse_up(x: int, y: int, button: str):
    _run(["xdotool", "mousemove", "--sync", str(x), str(y), "mouseup", BUTTONS[button]])


def scroll(x: int, y: int, direction: str, amount: int):
    if direction not in SCROLL_BUTTONS:
        raise invalid_params(f"direction must be one of {sorted(SCROLL_BUTTONS)}")
    _run(["xdotool", "mousemove", "--sync", str(x), str(y), "click", "--repeat", str(amount), "--delay", "30",
          SCROLL_BUTTONS[direction]])


def drag(x1: int, y1: int, x2: int, y2: int, button: str):
    b = BUTTONS[button]
    _run(["xdotool", "mousemove", "--sync", str(x1), str(y1), "mousedown", b, "sleep", "0.1",
          "mousemove", "--sync", str((x1 + x2) // 2), str((y1 + y2) // 2), "sleep", "0.05",
          "mousemove", "--sync", str(x2), str(y2), "sleep", "0.1", "mouseup", b])


def cursor() -> tuple[int, int]:
    out = _run(["xdotool", "getmouselocation", "--shell"])
    values = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    return int(values["X"]), int(values["Y"])


def activate_window(pid: int, title: str):
    pattern = "^" + re.escape(title) + "$"
    proc = subprocess.run(["xdotool", "search", "--all", "--onlyvisible", "--pid", str(pid), "--name", pattern],
                          capture_output=True, text=True, timeout=10)
    windows = proc.stdout.split()
    if len(windows) != 1:
        raise RpcError("action_failed", f"{len(windows)} X windows match pid {pid} title {title!r}")
    _run(["xdotool", "windowactivate", "--sync", windows[0]])


def display_size() -> tuple[int, int]:
    out = _run(["xdotool", "getdisplaygeometry"]).split()
    return int(out[0]), int(out[1])
