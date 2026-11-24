"""Reads of AT-SPI objects. Every read is a D-Bus round trip to the application."""
from typing import Optional

import pyatspi

from .model import Rect

REPORTED_STATES = {
    pyatspi.STATE_FOCUSED: "focused",
    pyatspi.STATE_SELECTED: "selected",
    pyatspi.STATE_CHECKED: "checked",
    pyatspi.STATE_PRESSED: "pressed",
    pyatspi.STATE_EXPANDED: "expanded",
    pyatspi.STATE_EDITABLE: "editable",
    pyatspi.STATE_MODAL: "modal",
}


def role(acc) -> str:
    return acc.getRoleName()


def name(acc) -> str:
    return " ".join((acc.name or "").split())


def related(acc, relation) -> list:
    out = []
    for rel in acc.getRelationSet():
        if rel.getRelationType() == relation:
            out.extend(rel.getTarget(i) for i in range(rel.getNTargets()))
    return out


def label_from_relations(acc) -> str:
    """GTK dialogs leave inputs unnamed and point at their label with LABELLED_BY."""
    return " ".join(name(t) for t in related(acc, pyatspi.RELATION_LABELLED_BY) if t is not None)


def labels_something(acc) -> bool:
    return bool(related(acc, pyatspi.RELATION_LABEL_FOR))


LABELLED_ROLES = {"spin button", "combo box", "entry", "text", "password text", "slider", "list", "list box",
                  "tree table", "table"}


def display_name(acc, role_name: str) -> str:
    own = name(acc)
    if own or role_name not in LABELLED_ROLES:
        return own
    return label_from_relations(acc)


def interfaces(acc) -> set[str]:
    return set(acc.get_interfaces())


def is_showing(st) -> bool:
    return st.contains(pyatspi.STATE_SHOWING)


def manages_descendants(st) -> bool:
    return st.contains(pyatspi.STATE_MANAGES_DESCENDANTS)


def rect(acc, ifaces: set[str]) -> Optional[Rect]:
    if "Component" not in ifaces:
        return None
    e = acc.queryComponent().getExtents(pyatspi.DESKTOP_COORDS)
    if e.width <= 0 or e.height <= 0:
        return None
    return Rect(e.x, e.y, e.width, e.height)


def states(st, has_actions: bool) -> list[str]:
    out = [label for state, label in REPORTED_STATES.items() if st.contains(state)]
    if st.contains(pyatspi.STATE_EXPANDABLE) and not st.contains(pyatspi.STATE_EXPANDED):
        out.append("collapsed")
    if has_actions and not st.contains(pyatspi.STATE_ENABLED):
        out.append("disabled")
    return out


EMBEDDED_OBJECT = "\ufffc"


def clip(s: str, max_len: int, total: int) -> str:
    s = " ".join(s.replace(EMBEDDED_OBJECT, " ").split())
    if not s or total <= max_len:
        return s
    return s[:max_len] + f"…(+{total - max_len})"


def text(acc, ifaces: set[str], max_len: int) -> Optional[str]:
    if "Text" not in ifaces:
        return None
    t = acc.queryText()
    count = t.characterCount
    if count <= 0:
        return None
    return clip(t.getText(0, min(count, max_len + 1)), max_len, count) or None


def full_text(acc) -> str:
    t = acc.queryText()
    return t.getText(0, t.characterCount)


VALUE_ROLES = {"slider", "spin button", "scroll bar", "progress bar", "dial", "level bar"}


def is_defunct(acc) -> bool:
    return acc.getState().contains(pyatspi.STATE_DEFUNCT)


def value(acc, ifaces: set[str]) -> Optional[float]:
    """LibreOffice puts a meaningless Value on buttons and menus; only ranged widgets report one."""
    if "Value" not in ifaces or role(acc) not in VALUE_ROLES:
        return None
    return acc.queryValue().currentValue


GENERIC_ACTIONS = {"doDefault", "showContextMenu", "clickAncestor", "scrollBackward", "scrollForward",
                   "scrollDown", "scrollUp", "scrollLeft", "scrollRight"}


def actions(acc, ifaces: set[str]) -> list[str]:
    """Actions that say what the element is for; Chrome offers the generic ones on every node."""
    if "Action" not in ifaces:
        return []
    a = acc.queryAction()
    return [n for n in (a.getName(i) for i in range(a.nActions)) if n not in GENERIC_ACTIONS]


def children(acc, limit: int) -> tuple[list, int]:
    count = acc.childCount
    kids = [acc.getChildAtIndex(i) for i in range(min(count, limit))]
    return [k for k in kids if k is not None], max(0, count - limit)


def app_name(acc) -> str:
    app = acc.getApplication()
    return name(app) if app is not None else ""


def center_on_screen(acc, screen: Rect) -> tuple[int, int]:
    from .errors import unsupported
    r = rect(acc, interfaces(acc))
    if r is None:
        raise unsupported(f"{role(acc)} {name(acc)!r} has no on-screen extents; use press or another action")
    x, y = r.center()
    if not (screen.x <= x < screen.x + screen.w and screen.y <= y < screen.y + screen.h):
        raise unsupported(f"{role(acc)} {name(acc)!r} is off screen; use act scroll_into_view or press instead")
    return x, y


def describe(acc) -> dict:
    r = role(acc)
    return {"role": r, "name": display_name(acc, r)}
