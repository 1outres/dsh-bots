"""Screenshots straight from the X display (no files), optionally cropped and resized."""
import base64
import io
from typing import Optional

from PIL import Image, ImageGrab

from .model import Rect


def capture(display: str, region: Optional[Rect], width: int, fmt: str, quality: int) -> dict:
    image = ImageGrab.grab(xdisplay=display)
    screen = Rect(0, 0, image.width, image.height)
    area = screen if region is None else region.intersection(screen)
    if area.w <= 0 or area.h <= 0:
        raise ValueError("the region is outside the screen")
    if region is not None:
        image = image.crop((area.x, area.y, area.x + area.w, area.y + area.h))
    if image.width != width:
        image = image.resize((width, max(1, round(image.height * width / image.width))), Image.LANCZOS)
    buf = io.BytesIO()
    if fmt == "jpeg":
        image.convert("RGB").save(buf, "JPEG", quality=quality)
    else:
        image.save(buf, "PNG", optimize=True)
    data = buf.getvalue()
    return {"format": fmt, "width": image.width, "height": image.height, "bytes": len(data),
            "region": [area.x, area.y, area.w, area.h], "screen": [screen.w, screen.h],
            "data": base64.b64encode(data).decode()}
