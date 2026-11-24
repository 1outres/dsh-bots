import time

from gi.repository import GLib


def pump(ms: int):
    """Lets AT-SPI events and application updates arrive while a request is being handled."""
    ctx = GLib.MainContext.default()
    deadline = time.monotonic() + ms / 1000
    while time.monotonic() < deadline:
        while ctx.pending():
            ctx.iteration(False)
        time.sleep(0.02)
