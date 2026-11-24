from collections import OrderedDict
from dataclasses import dataclass, field

from .errors import stale_element
from .limits import SNAPSHOTS_KEPT


@dataclass
class Snapshot:
    number: int
    refs: dict[str, object] = field(default_factory=dict)
    count: int = 0

    def add(self, accessible) -> str:
        self.count += 1
        element_id = f"{self.number}:{self.count}"
        self.refs[element_id] = accessible
        return element_id


class SnapshotStore:
    def __init__(self, kept: int = SNAPSHOTS_KEPT):
        self._kept = kept
        self._next = 1
        self._snapshots: OrderedDict[int, Snapshot] = OrderedDict()

    def create(self) -> Snapshot:
        snapshot = Snapshot(self._next)
        self._next += 1
        self._snapshots[snapshot.number] = snapshot
        while len(self._snapshots) > self._kept:
            self._snapshots.popitem(last=False)
        return snapshot

    def resolve(self, element_id: str):
        number, _, _ = element_id.partition(":")
        snapshot = self._snapshots.get(int(number)) if number.isdigit() else None
        if snapshot is None or element_id not in snapshot.refs:
            raise stale_element(element_id)
        return snapshot.refs[element_id]
