"""Starts allow-listed applications as transient systemd user units."""
import subprocess
import uuid

from .errors import RpcError, invalid_params

APPS = {
    "writer": ["libreoffice", "--writer", "--norestore"],
    "calc": ["libreoffice", "--calc", "--norestore"],
    "impress": ["libreoffice", "--impress", "--norestore"],
    "chrome": ["google-chrome-stable", "--new-window"],
    "terminal": ["xfce4-terminal"],
    "files": ["thunar"],
}


def launch(app: str, args: list[str]) -> str:
    if app not in APPS:
        raise invalid_params(f"app must be one of {sorted(APPS)}")
    if any(a.startswith("-") for a in args):
        raise invalid_params("args are files or URLs; options are not accepted")
    unit = f"dsh-app-{app}-{uuid.uuid4().hex[:8]}"
    proc = subprocess.run(["systemd-run", "--user", "--collect", "--quiet", f"--unit={unit}", "--", *APPS[app], *args],
                          capture_output=True, timeout=15)
    if proc.returncode != 0:
        raise RpcError("launch_failed", proc.stderr.decode(errors="replace").strip())
    return unit
