"""LibreOffice Calc sheets: the sheet table of the active window, and its cells by address."""
from collections import deque

import pyatspi

from . import atspi_access as ax
from . import tables
from .errors import RpcError, invalid_params

SEARCH_BUDGET = 3000
MAX_CELLS = 480
MAX_SCAN = 2000


def find_sheet(window):
    queue = deque([window])
    budget = SEARCH_BUDGET
    while queue and budget > 0:
        acc = queue.popleft()
        budget -= 1
        st = acc.getState()
        if not ax.is_showing(st):
            continue
        if ax.manages_descendants(st) and tables.is_table(acc) and ax.role(acc) == "table":
            return acc
        if ax.manages_descendants(st):
            continue
        queue.extend(ax.children(acc, 200)[0])
    raise RpcError("no_sheet", "the active window shows no spreadsheet: desktop_launch calc or desktop_focus_window "
                               "a LibreOffice Calc window first")


def read(window, screen, spec, max_cells: int, active_of) -> dict:
    acc = find_sheet(window)
    table = acc.queryTable()
    visible = tables.visible_range(acc, screen)
    if spec is None:
        if visible is None:
            raise RpcError("no_sheet", "the sheet is not on screen")
        (r0, c0), (r1, c1) = visible
    else:
        (r0, c0), (r1, c1) = tables.parse_range(spec)
    if r1 >= table.nRows or c1 >= table.nColumns:
        raise invalid_params(f"the range is outside the sheet ({table.nRows}x{table.nColumns})")
    if (r1 - r0 + 1) * (c1 - c0 + 1) > MAX_SCAN:
        raise invalid_params(f"the range has more than {MAX_SCAN} cells; read a smaller range")
    cells = []
    truncated = False
    for row in range(r0, r1 + 1):
        for col in range(c0, c1 + 1):
            cell = table.getAccessibleAt(row, col)
            t = cell.queryText()
            if t.characterCount == 0:
                continue
            if len(cells) >= max_cells:
                truncated = True
                continue
            cells.append({"address": tables.column_label(col) + str(row + 1), "text": t.getText(0, t.characterCount)})
    out = {"name": ax.name(acc), "rows": table.nRows, "columns": table.nColumns,
           "range": f"{tables.column_label(c0)}{r0 + 1}:{tables.column_label(c1)}{r1 + 1}",
           "cells": cells, "truncated": truncated}
    if visible is not None:
        (v0, w0), (v1, w1) = visible
        out["visible"] = f"{tables.column_label(w0)}{v0 + 1}:{tables.column_label(w1)}{v1 + 1}"
    active = active_of(acc)
    if active is not None:
        out["active"] = ax.name(active)
    return out
