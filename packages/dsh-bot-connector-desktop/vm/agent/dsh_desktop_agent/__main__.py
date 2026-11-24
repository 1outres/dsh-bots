import argparse
import os
import socket

import gi

gi.require_version("Atspi", "2.0")
from gi.repository import GLib  # noqa: E402

from .server import Server  # noqa: E402
from .service import DesktopService  # noqa: E402


def notify_ready():
    """systemd Type=notify: the unit is started once the socket accepts connections."""
    path = os.environ.get("NOTIFY_SOCKET")
    if not path:
        return
    address = "\0" + path[1:] if path.startswith("@") else path
    with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as s:
        s.connect(address)
        s.sendall(b"READY=1")


def main():
    parser = argparse.ArgumentParser(prog="dsh-desktop-agent")
    parser.add_argument("--socket", required=True)
    parser.add_argument("--display", default=os.environ["DISPLAY"])
    args = parser.parse_args()
    Server(args.socket, DesktopService(args.display))
    notify_ready()
    GLib.MainLoop().run()


main()
