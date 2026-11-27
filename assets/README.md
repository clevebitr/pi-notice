# pi-notice icon

`pi-notice.svg` is the notification icon used by the desktop channel. It is
based on the Lucide `bell-ring` icon, recolored to amber (`#f59e0b`) without
changing its geometry.

| File | Purpose |
| --- | --- |
| `pi-notice.svg` | Editable source |
| `pi-notice.png` | 512 px transparent PNG (Linux / macOS) |
| `pi-notice.ico` | 16–256 px Windows icon (toast identity / shortcut) |

This is **not** the Pi logo and does not use Earendil/Pi brand assets. It is an
unofficial, original-colored bell icon for the pi-notice extension.

## License

Lucide is licensed under the ISC license; see
[`LICENSE-lucide.txt`](./LICENSE-lucide.txt). The ISC notice must stay with the
icon when it is redistributed.

## Regenerating

The PNG/ICO files are generated from the SVG. With
[`@resvg/resvg-js`](https://github.com/thx/resvg-js) and Pillow installed:

```python
# after rendering pi-notice.png at 512 px from pi-notice.svg
from PIL import Image

Image.open("pi-notice.png").convert("RGBA").save(
    "pi-notice.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
```
