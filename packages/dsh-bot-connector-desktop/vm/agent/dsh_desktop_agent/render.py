"""Two renderings of the same pruned tree: indented lines (default) and nested JSON."""
import json

from .model import Node


def _fmt_value(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else f"{v:g}"


def line(node: Node, geometry: bool) -> str:
    parts = [f"[{node.id}]", node.role]
    if node.name:
        parts.append(json.dumps(node.name, ensure_ascii=False))
    if node.text is not None:
        parts.append("text=" + json.dumps(node.text, ensure_ascii=False))
    if node.value is not None:
        parts.append("value=" + _fmt_value(node.value))
    parts.extend(node.states)
    if geometry and node.rect is not None:
        r = node.rect
        parts.append(f"@{r.x},{r.y},{r.w}x{r.h}")
    if node.note:
        parts.append(f"({node.note})")
    return " ".join(parts)


def as_lines(root: Node, geometry: bool) -> str:
    out: list[str] = []

    def walk(node: Node, depth: int):
        out.append("  " * depth + line(node, geometry))
        if node.cells:
            out.extend("  " * (depth + 1) + row for row in grid_rows(node.children))
        else:
            for child in node.children:
                walk(child, depth + 1)
        if node.omitted:
            out.append("  " * (depth + 1) + f"… {node.omitted} more not shown")

    walk(root, 0)
    return "\n".join(out)


def as_dict(node: Node, geometry: bool) -> dict:
    d: dict = {"id": node.id, "role": node.role}
    if node.name:
        d["name"] = node.name
    if node.text is not None:
        d["text"] = node.text
    if node.value is not None:
        d["value"] = node.value
    if node.states:
        d["states"] = node.states
    if node.actions:
        d["actions"] = node.actions
    if geometry and node.rect is not None:
        d["rect"] = [node.rect.x, node.rect.y, node.rect.w, node.rect.h]
    if node.note:
        d["note"] = node.note
    if node.children:
        d["children"] = [as_dict(c, geometry) for c in node.children]
    if node.omitted:
        d["omitted"] = node.omitted
    return d


def flat(nodes: list[Node], geometry: bool) -> list[dict]:
    return [as_dict(n, geometry) for n in nodes]

def grid_rows(cells: list[Node]) -> list[str]:
    """Visible non-empty cells, one line per sheet row: A1="x" C1="y"."""
    rows: dict[int, list[str]] = {}
    for cell in cells:
        rows.setdefault(cell.order[0], []).append(f"{cell.name}={json.dumps(cell.text or '', ensure_ascii=False)}")
    return [" ".join(parts) for _, parts in sorted(rows.items())]
