from dataclasses import dataclass


@dataclass(frozen=True)
class TreeLimits:
    max_depth: int = 12
    max_nodes: int = 150
    max_text: int = 80
    max_children: int = 200
    table_max_cells: int = 120


DEFAULT_TREE = TreeLimits()
FIND_VISIT_BUDGET = 4000
FIND_LIMIT = 20
SNAPSHOTS_KEPT = 8
FOCUS_SEARCH_BUDGET = 800
ACT_MIN_MS = 100
ACT_MAX_MS = 2000
INPUT_SETTLE_MS = 300
SEQUENCE_MAX_STEPS = 2000
TEXT_LIMIT = 20000
SECRET_FOCUS_MS = 1000
