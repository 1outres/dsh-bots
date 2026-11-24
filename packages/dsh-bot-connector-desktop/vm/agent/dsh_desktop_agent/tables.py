"""Tables that manage their descendants (Calc sheets: 1048576 x 16384 cells) are read by geometry."""
from typing import Optional

import pyatspi

from . import atspi_access as ax
from .errors import invalid_params
from .limits import TreeLimits
from .model import Node, Rect


GRID_MIN_CELLS = 10000


def is_table(acc) -> bool:
    return "Table" in ax.interfaces(acc)


def column_label(col: int) -> str:
    label = ""
    col += 1
    while col:
        col, rem = divmod(col - 1, 26)
        label = chr(65 + rem) + label
    return label


def parse_address(address: str) -> tuple[int, int]:
    letters = "".join(ch for ch in address if ch.isalpha()).upper()
    digits = "".join(ch for ch in address if ch.isdigit())
    if not letters or not digits or letters + digits != address.upper().replace("$", ""):
        raise invalid_params(f"bad cell address {address!r}")
    col = 0
    for ch in letters:
        col = col * 26 + ord(ch) - 64
    return int(digits) - 1, col - 1


def parse_range(spec: str) -> tuple[tuple[int, int], tuple[int, int]]:
    first, _, last = spec.partition(":")
    a = parse_address(first)
    b = parse_address(last) if last else a
    return (min(a[0], b[0]), min(a[1], b[1])), (max(a[0], b[0]), max(a[1], b[1]))


def visible_range(acc, clip: Optional[Rect]) -> Optional[tuple[tuple[int, int], tuple[int, int]]]:
    comp = acc.queryComponent()
    e = comp.getExtents(pyatspi.DESKTOP_COORDS)
    area = Rect(e.x, e.y, e.width, e.height)
    if clip is not None:
        x0, y0 = max(area.x, clip.x), max(area.y, clip.y)
        x1, y1 = min(area.x + area.w, clip.x + clip.w), min(area.y + area.h, clip.y + clip.h)
        area = Rect(x0, y0, x1 - x0, y1 - y0)
    if area.w <= 2 or area.h <= 2:
        return None
    table = acc.queryTable()
    corners = []
    for x, y in ((area.x + 1, area.y + 1), (area.x + area.w - 2, area.y + area.h - 2)):
        cell = comp.getAccessibleAtPoint(x, y, pyatspi.DESKTOP_COORDS)
        if cell is None:
            return None
        index = cell.getIndexInParent()
        corners.append((table.getRowAtIndex(index), table.getColumnAtIndex(index)))
    return corners[0], corners[1]


def cell_node(cell, limits: TreeLimits) -> Node:
    ifaces = ax.interfaces(cell)
    st = cell.getState()
    nm = ax.name(cell)
    txt = ax.text(cell, ifaces, limits.max_text)
    return Node(id="", role=ax.role(cell), name=nm, rect=ax.rect(cell, ifaces), states=ax.states(st, False),
                text=None if txt == nm else txt, ref=cell)


def attach_visible_cells(acc, node: Node, limits: TreeLimits, clip: Optional[Rect]):
    table = acc.queryTable()
    span = visible_range(acc, clip)
    node.note = f"{table.nRows}x{table.nColumns}"
    node.cells = table.nRows * table.nColumns > GRID_MIN_CELLS
    if span is None:
        return
    (r0, c0), (r1, c1) = span
    node.note += f" visible {column_label(c0)}{r0 + 1}:{column_label(c1)}{r1 + 1}"
    empty = 0
    for row in range(r0, r1 + 1):
        for col in range(c0, c1 + 1):
            cell = table.getAccessibleAt(row, col)
            if cell.queryText().characterCount == 0:
                empty += 1
                continue
            if len(node.children) >= limits.table_max_cells:
                node.omitted += 1
                continue
            child = cell_node(cell, limits)
            child.order = (row, col)
            node.children.append(child)
    node.note += f" empty {empty}"
    selected = first_selected_cell(acc)
    if selected is not None:
        node.note += f" selected {selected}"


def first_selected_cell(acc) -> Optional[str]:
    """The first cell of a selected range (a single cell cursor is not a selection in Calc)."""
    if "Selection" not in ax.interfaces(acc):
        return None
    selection = acc.querySelection()
    if selection.nSelectedChildren == 0:
        return None
    return ax.name(selection.getSelectedChild(0))
