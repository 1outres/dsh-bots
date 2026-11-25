"""Newline-delimited JSON-RPC 2.0 on a Unix socket, served from the GLib main loop AT-SPI uses."""
import json
import os
import socket
import traceback

from gi.repository import GLib

from . import secret_input
from .errors import RpcError
from .service import DesktopService

METHODS = ("status", "launch", "tree", "find", "act", "text", "input", "sequence", "cursor", "clipboard_get",
           "clipboard_set", "screenshot", "sheet_read", "secret_target")
SECRET_METHODS = ("type_secret",)
MAX_REQUEST = 1 << 20


class Server:
    def __init__(self, path: str, service: DesktopService):
        self.service = service
        if os.path.exists(path):
            os.unlink(path)
        old = os.umask(0o177)
        try:
            self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self.sock.bind(path)
        finally:
            os.umask(old)
        self.sock.listen(8)
        GLib.io_add_watch(self.sock.fileno(), GLib.IO_IN, self._accept)

    def _accept(self, *_):
        conn, _ = self.sock.accept()
        buffer = bytearray()
        GLib.io_add_watch(conn.fileno(), GLib.IO_IN | GLib.IO_HUP | GLib.IO_ERR, self._readable, conn, buffer)
        return True

    def _readable(self, _fd, _cond, conn, buffer):
        try:
            chunk = conn.recv(65536)
        except OSError:
            chunk = b""
        if not chunk:
            conn.close()
            return False
        buffer.extend(chunk)
        while b"\n" in buffer:
            line, _, rest = bytes(buffer).partition(b"\n")
            buffer[:] = rest
            try:
                conn.sendall(json.dumps(self._handle(line), ensure_ascii=False).encode() + b"\n")
            except OSError:
                conn.close()
                return False
        if len(buffer) > MAX_REQUEST:
            conn.close()
            return False
        return True

    def _handle(self, line: bytes) -> dict:
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            method = request.get("method")
            if method in SECRET_METHODS:
                return self._handle_secret(request_id, method, request)
            if "secret" in request:
                raise RpcError("invalid_params", f"{method} takes no secret")
            if method not in METHODS:
                raise RpcError("method_not_found", f"unknown method {method}")
            p = request.get("params", {})
            if not isinstance(p, dict):
                raise RpcError("invalid_params", "params must be an object")
            return {"jsonrpc": "2.0", "id": request_id, "result": getattr(self.service, method)(p)}
        except RpcError as e:
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": e.code, "message": e.message}}
        except GLib.Error as e:
            message = "the application did not answer through accessibility in time (it may be busy); wait and try again, with a smaller scope or range"
            if "defunct" in e.message.lower():
                message = "the element's application is gone; take a new desktop_tree"
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": "app_not_responding", "message": message}}
        except (KeyError, ValueError, TypeError) as e:
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": "invalid_params", "message": repr(e)}}
        except Exception as e:
            traceback.print_exc()
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": "internal", "message": repr(e)}}

    def _handle_secret(self, request_id, method: str, request: dict) -> dict:
        """The value is in the request's own `secret` member; nothing about a failure may echo it, so only
        the agent's own errors pass and every other one becomes a fixed message without a log line."""
        try:
            p = request.get("params", {})
            if not isinstance(p, dict):
                raise RpcError("invalid_params", "params must be an object")
            value = secret_input.decode(request.get("secret"))
            return {"jsonrpc": "2.0", "id": request_id, "result": getattr(self.service, method)(p, value)}
        except RpcError as e:
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": e.code, "message": e.message}}
        except GLib.Error:
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": "app_not_responding",
                                                                   "message": "the application did not answer through accessibility in time"}}
        except Exception:
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": "internal", "message": f"{method} failed"}}
