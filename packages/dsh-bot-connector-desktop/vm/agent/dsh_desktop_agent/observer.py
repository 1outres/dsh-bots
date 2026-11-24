"""Desktop state that changes underneath us: windows (polled; X decides which is active) and focus (AT-SPI events)."""
import subprocess
from collections import deque
from dataclasses import dataclass
from typing import Optional

import pyatspi
from gi.repository import GLib

from . import atspi_access as ax
from .limits import FOCUS_SEARCH_BUDGET
from .model import Rect


@dataclass(frozen=True)
class WindowInfo:
    app: str
    role: str
    name: str
    active: bool
    pid: int

    def key(self) -> tuple[str, str, str]:
        return self.app, self.role, self.name

    def label(self) -> dict:
        return {"app": self.app, "role": self.role, "name": self.name}


def x_active_window() -> Optional[tuple[int, str]]:
    proc = subprocess.run(["xdotool", "getactivewindow", "getwindowpid", "getwindowname"],
                          capture_output=True, text=True, timeout=5)
    lines = proc.stdout.splitlines()
    if proc.returncode != 0 or len(lines) < 2:
        return None
    return int(lines[0]), lines[1]


class Observer:
    def __init__(self, screen: Rect):
        self.screen = screen
        self.focus = None
        self.descendants = {}
        pyatspi.Registry.registerEventListener(self._on_focus, "object:state-changed:focused")
        pyatspi.Registry.registerEventListener(self._on_descendant, "object:active-descendant-changed")

    def _on_focus(self, event):
        if event.detail1 == 1:
            self.focus = event.source

    def _on_descendant(self, event):
        """Calc moves its cell cursor as the sheet table's active descendant, not as focus."""
        if event.any_data is not None:
            self.descendants[event.source] = event.any_data

    def active_descendant(self, acc):
        child = self.descendants.get(acc)
        if child is None or ax.is_defunct(child):
            return None
        return child

    def focus_summary(self) -> Optional[dict]:
        """The last focus event, unless that element lost focus since (LibreOffice skips some events)."""
        if self.focus is None or not self.focus.getState().contains(pyatspi.STATE_FOCUSED):
            active = self.active_window()
            self.focus = _find_focused(active[1]) if active else None
        return ax.describe(self.focus) if self.focus is not None else None

    def windows(self) -> list[tuple[WindowInfo, object]]:
        active = x_active_window()
        desktop = pyatspi.Registry.getDesktop(0)
        out = []
        for i in range(desktop.childCount):
            app = desktop.getChildAtIndex(i)
            if app is None or ax.is_defunct(app):
                continue
            try:
                pid = app.get_process_id()
            except GLib.Error as e:
                if "defunct" in e.message:
                    continue
                raise
            app_name = ax.name(app)
            for j in range(app.childCount):
                win = app.getChildAtIndex(j)
                if win is None or not ax.is_showing(win.getState()):
                    continue
                r = ax.rect(win, ax.interfaces(win))
                if r is None or not r.intersects(self.screen):
                    continue
                name = ax.name(win)
                is_active = active is not None and active[0] == pid and active[1] == name
                out.append((WindowInfo(app_name, ax.role(win), name, is_active, pid), win))
        return out

    def active_window(self):
        for info, win in self.windows():
            if info.active:
                return info, win
        return None

def _find_focused(root, budget: int = FOCUS_SEARCH_BUDGET):
    queue = deque([root])
    while queue and budget > 0:
        acc = queue.popleft()
        budget -= 1
        st = acc.getState()
        if st.contains(pyatspi.STATE_FOCUSED):
            return acc
        if not ax.is_showing(st) or ax.manages_descendants(st):
            continue
        queue.extend(ax.children(acc, 200)[0])
    return None
