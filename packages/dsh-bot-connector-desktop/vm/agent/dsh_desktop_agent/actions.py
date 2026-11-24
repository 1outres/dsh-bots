"""Semantic actions on one element, through AT-SPI interfaces only. Where AT-SPI cannot do it, the error says what to do instead."""
import pyatspi

from . import atspi_access as ax
from . import inputs
from .errors import RpcError, invalid_params, unsupported

ACTIONS = ("press", "focus", "set_text", "set_value", "select", "click", "activate", "scroll_into_view")


def _require(acc, iface: str, action: str):
    if iface not in ax.interfaces(acc):
        raise unsupported(f"{action}: {ax.role(acc)} {ax.name(acc)!r} has no {iface} interface")


def press(acc, action_name):
    _require(acc, "Action", "press")
    if ax.role(acc) == "toggle button" and ax.app_name(acc) == "xfce4-panel":
        raise unsupported("press only toggles a panel menu button without opening its menu: use action click on it, "
                          "then press the items of the menu that opens")
    a = acc.queryAction()
    names = [a.getName(i) for i in range(a.nActions)]
    index = 0 if action_name is None else names.index(action_name) if action_name in names else -1
    if index < 0:
        raise invalid_params(f"action_name {action_name!r} is not one of {names}")
    if not a.doAction(index):
        raise RpcError("action_failed", f"{names[index]} was refused")


def focus(acc):
    _require(acc, "Component", "focus")
    if not acc.queryComponent().grabFocus():
        raise RpcError("action_failed", "grabFocus was refused")


def set_text(acc, text: str):
    if "EditableText" not in ax.interfaces(acc):
        raise unsupported(f"set_text: {ax.role(acc)} {ax.name(acc)!r} has no editable text (Chrome's fields never do): "
                          "use action focus on it, then desktop_key ctrl+a and desktop_type")
    if not acc.queryEditableText().setTextContents(text):
        raise RpcError("action_failed", "setTextContents was refused")


def set_value(acc, value: float):
    _require(acc, "Value", "set_value")
    acc.queryValue().currentValue = value


def select(acc):
    parent = acc.parent
    if parent is not None and ax.manages_descendants(parent.getState()) and "Table" in ax.interfaces(parent):
        raise unsupported("select on a spreadsheet cell makes a selection range that typing cycles through: "
                          "read and write cells with desktop_sheet, or click the cell")
    if parent is None or "Selection" not in ax.interfaces(parent):
        raise unsupported(f"select: the parent of {ax.role(acc)} {ax.name(acc)!r} has no Selection interface; use press")
    if not parent.querySelection().selectChild(acc.getIndexInParent()):
        raise RpcError("action_failed", "selectChild was refused")


def click(acc, screen, button: str, count: int):
    point = ax.center_on_screen(acc, screen)
    inputs.click(point[0], point[1], button, count, [])


def activate_window(acc):
    if acc.parent is None or ax.role(acc.parent) != "application":
        raise invalid_params("activate needs a window id from desktop_windows")
    inputs.activate_window(acc.parent.get_process_id(), ax.name(acc))


def scroll_into_view(acc):
    _require(acc, "Component", "scroll_into_view")
    acc.queryComponent().scrollTo(pyatspi.SCROLL_ANYWHERE)


def perform(acc, action: str, p: dict, screen):
    from . import params
    if action == "press":
        press(acc, params.text(p, "action_name", None))
    elif action == "focus":
        focus(acc)
    elif action == "set_text":
        set_text(acc, params.text(p, "text"))
    elif action == "set_value":
        set_value(acc, params.number(p, "value"))
    elif action == "select":
        select(acc)
    elif action == "click":
        click(acc, screen, params.choice(p, "button", tuple(inputs.BUTTONS), "left"),
              params.integer(p, "count", 1, 1, 3))
    elif action == "activate":
        activate_window(acc)
    elif action == "scroll_into_view":
        scroll_into_view(acc)
    else:
        raise invalid_params(f"action must be one of {', '.join(ACTIONS)}")
