from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Rect:
    x: int
    y: int
    w: int
    h: int

    def center(self) -> tuple[int, int]:
        return self.x + self.w // 2, self.y + self.h // 2

    def intersection(self, other: "Rect") -> "Rect":
        x0, y0 = max(self.x, other.x), max(self.y, other.y)
        x1, y1 = min(self.x + self.w, other.x + other.w), min(self.y + self.h, other.y + other.h)
        return Rect(x0, y0, max(0, x1 - x0), max(0, y1 - y0))

    def intersects(self, other: "Rect") -> bool:
        return self.x < other.x + other.w and other.x < self.x + self.w and self.y < other.y + other.h and other.y < self.y + self.h


@dataclass
class Node:
    id: str
    role: str
    name: str
    rect: Optional[Rect]
    states: list[str] = field(default_factory=list)
    text: Optional[str] = None
    value: Optional[float] = None
    actions: list[str] = field(default_factory=list)
    children: list["Node"] = field(default_factory=list)
    omitted: int = 0
    note: Optional[str] = None
    order: tuple = ()
    cells: bool = False
    ref: object = field(default=None, repr=False, compare=False)

    def sort_children(self):
        self.children.sort(key=lambda c: c.order)
        for child in self.children:
            child.sort_children()
