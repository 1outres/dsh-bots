"""Typed reads of request parameters; anything else is invalid_params."""
from typing import Optional

from .errors import invalid_params


def _get(p: dict, key: str, kind, default):
    if key not in p or p[key] is None:
        if default is _REQUIRED:
            raise invalid_params(f"{key} is required")
        return default
    value = p[key]
    if kind is int and isinstance(value, bool):
        raise invalid_params(f"{key} must be an integer")
    if kind is float and isinstance(value, int) and not isinstance(value, bool):
        value = float(value)
    if not isinstance(value, kind):
        raise invalid_params(f"{key} must be {kind.__name__}")
    return value


_REQUIRED = object()


def text(p: dict, key: str, default=_REQUIRED, max_len: int = 100_000) -> str:
    value = _get(p, key, str, default)
    if value is not None and len(value) > max_len:
        raise invalid_params(f"{key} is longer than {max_len}")
    return value


def integer(p: dict, key: str, default=_REQUIRED, lo: int = -(1 << 31), hi: int = 1 << 31) -> int:
    value = _get(p, key, int, default)
    if value is not None and not lo <= value <= hi:
        raise invalid_params(f"{key} must be from {lo} to {hi}")
    return value


def number(p: dict, key: str, default=_REQUIRED) -> float:
    return _get(p, key, float, default)


def flag(p: dict, key: str, default: bool = False) -> bool:
    return _get(p, key, bool, default)


def choice(p: dict, key: str, options: tuple, default=_REQUIRED) -> str:
    value = text(p, key, default)
    if value not in options:
        raise invalid_params(f"{key} must be one of {', '.join(options)}")
    return value


def strings(p: dict, key: str, default=_REQUIRED, max_items: int = 64) -> list:
    value = _get(p, key, list, default)
    if value is None:
        return value
    if len(value) > max_items or not all(isinstance(v, str) for v in value):
        raise invalid_params(f"{key} must be a list of at most {max_items} strings")
    return value


def obj(p: dict, key: str, default=_REQUIRED) -> Optional[dict]:
    return _get(p, key, dict, default)


def items(p: dict, key: str, max_items: int) -> list:
    value = _get(p, key, list, _REQUIRED)
    if len(value) > max_items or not all(isinstance(v, dict) for v in value):
        raise invalid_params(f"{key} must be a list of at most {max_items} objects")
    return value
