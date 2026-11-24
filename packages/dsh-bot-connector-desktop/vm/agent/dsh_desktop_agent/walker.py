"""Builds a pruned view of an AT-SPI subtree: showing, scrolled-into-view, meaningful nodes only.

Clipping follows scroll panes and viewports (GTK reports scrolled-out widgets as showing); a window larger
than the screen keeps its off-screen part, marked "offscreen", because AT-SPI actions still reach it.
"""
from collections import deque
from dataclasses import dataclass
from typing import Callable, Optional

from . import atspi_access as ax
from . import tables
from .limits import TreeLimits
from .model import Node, Rect
from .snapshots import Snapshot

STRUCTURAL_ROLES = {
    "panel", "filler", "viewport", "scroll pane", "split pane", "layered pane", "glass pane",
    "root pane", "redundant object", "unknown", "section", "invalid", "option pane", "grouping",
    "tool bar", "form", "block quote", "landmark", "article",
}
CLIPPING_ROLES = {"viewport", "scroll pane"}
DROPPED_ROLES = {"separator", "scroll bar", "ruler"}
TEXT_LEAF_ROLES = {"static", "text", "label"}
EMPTY_LEAF_ROLES = {"label", "icon", "image", "drawing area", "static", "filler", "panel"}


@dataclass
class Visit:
    acc: object
    parent: Node
    depth: int
    order: tuple
    clip: Optional[Rect]


@dataclass
class Read:
    node: Node
    state: object
    clip: Optional[Rect]
    hidden: bool


def _is_noise(acc, role: str, name: str, text: Optional[str], acts: list[str]) -> bool:
    if role in DROPPED_ROLES:
        return True
    if name or text or acts:
        return False
    return role in STRUCTURAL_ROLES or (role in EMPTY_LEAF_ROLES and acc.childCount == 0)


def _repeats_parent(node: Node, parent: Node) -> bool:
    own = node.text or node.name
    return not own or own in (parent.text or "") or own in parent.name


def read_node(acc, limits: TreeLimits, clip: Optional[Rect], screen: Rect) -> Optional[Read]:
    st = acc.getState()
    if not ax.is_showing(st):
        return None
    ifaces = ax.interfaces(acc)
    r = ax.rect(acc, ifaces)
    if clip is not None and r is not None and not r.intersects(clip):
        return None
    role = ax.role(acc)
    nm = ax.display_name(acc, role)
    acts = ax.actions(acc, ifaces)
    txt = ax.text(acc, ifaces, limits.max_text)
    if txt == nm:
        txt = None
    states = ax.states(st, bool(acts))
    if r is not None and not r.intersects(screen):
        states.append("offscreen")
    node = Node(id="", role=role, name=nm[: limits.max_text], rect=r, states=states,
                text=txt, value=ax.value(acc, ifaces), actions=acts)
    inner = clip
    if role in CLIPPING_ROLES and r is not None:
        inner = r if clip is None else clip.intersection(r)
    hidden = _is_noise(acc, role, nm, txt, acts) or (role == "label" and ax.labels_something(acc))
    return Read(node, st, inner, hidden)


def build(root, snapshot: Snapshot, limits: TreeLimits, screen: Rect) -> tuple[Node, int]:
    """Breadth-first so the node budget covers the upper levels of every branch first."""
    read = read_node(root, limits, None, screen)
    if read is None:
        raise LookupError("element is not showing")
    top = read.node
    top.ref = root
    emitted = 1
    queue: deque[Visit] = deque()
    _expand(root, top, read, 0, queue, limits, screen, ())
    while queue:
        visit = queue.popleft()
        if emitted >= limits.max_nodes:
            if ax.is_showing(visit.acc.getState()):
                visit.parent.omitted += 1
            continue
        read = read_node(visit.acc, limits, visit.clip, screen)
        if read is None:
            continue
        node = read.node
        if read.hidden:
            _expand(visit.acc, visit.parent, read, visit.depth, queue, limits, screen, visit.order)
            continue
        if node.role in TEXT_LEAF_ROLES and not node.actions and _repeats_parent(node, visit.parent):
            continue
        node.ref = visit.acc
        node.order = visit.order
        visit.parent.children.append(node)
        emitted += 1
        if visit.depth + 1 > limits.max_depth:
            node.omitted = visit.acc.childCount
            continue
        _expand(visit.acc, node, read, visit.depth + 1, queue, limits, screen, visit.order)
    top.sort_children()
    _fold_labels(top)
    _number(top, snapshot)
    return top, emitted


def _fold_labels(node: Node):
    """An unnamed item whose children are only plain labels (GTK list rows) takes their text as its name."""
    for child in node.children:
        _fold_labels(child)
    if node.name or not node.children:
        return
    if all(c.role in TEXT_LEAF_ROLES | {"icon"} and not c.children and not c.actions for c in node.children):
        node.name = " ".join(c.name or c.text or "" for c in node.children).strip()
        node.children = []


def _number(node: Node, snapshot: Snapshot):
    node.id = snapshot.add(node.ref)
    for child in node.children:
        _number(child, snapshot)


def _expand(acc, node: Node, read: Read, depth: int, queue: deque, limits: TreeLimits, screen: Rect, order: tuple):
    if ax.manages_descendants(read.state) and tables.is_table(acc):
        visible = screen if read.clip is None else read.clip.intersection(screen)
        tables.attach_visible_cells(acc, node, limits, visible)
        return
    kids, rest = ax.children(acc, limits.max_children)
    node.omitted += rest
    for index, kid in enumerate(kids):
        queue.append(Visit(kid, node, depth, order + (index,), read.clip))


def search(root, match: Callable[[Node], bool], snapshot: Snapshot, limits: TreeLimits, screen: Rect,
           visit_budget: int, max_results: int) -> tuple[list[Node], int, bool]:
    results: list[Node] = []
    visited = 0
    queue: deque = deque([(root, None, None)])
    while queue and visited < visit_budget and len(results) < max_results:
        acc, parent, clip = queue.popleft()
        visited += 1
        read = read_node(acc, limits, clip, screen)
        if read is None:
            continue
        node = read.node
        redundant = read.hidden or (parent is not None and node.role in TEXT_LEAF_ROLES and not node.actions
                                    and _repeats_parent(node, parent))
        if not redundant and match(node):
            node.id = snapshot.add(acc)
            results.append(node)
        if ax.manages_descendants(read.state) and tables.is_table(acc):
            visible = screen if read.clip is None else read.clip.intersection(screen)
            tables.attach_visible_cells(acc, node, limits, visible)
            for cell in node.children:
                if len(results) < max_results and match(cell):
                    cell.id = snapshot.add(cell.ref)
                    results.append(cell)
            continue
        kids, _ = ax.children(acc, limits.max_children)
        queue.extend((kid, node, read.clip) for kid in kids)
    return results, visited, bool(queue) and len(results) < max_results