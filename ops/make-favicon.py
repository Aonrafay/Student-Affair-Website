"""Generate the favicon raster set from the site's brand mark.

Drawn rather than converted from the SVG: no SVG rasterizer is installed, and
the mark is simple enough (gradient rounded square + "SA") to render directly.
Keeps the 135-degree light-blue gradient and navy text of .brand-mark in
public/css/site.css so the tab icon matches the header logo.
"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")
NAVY = (30, 58, 138, 255)      # --navy
STROKE = (29, 78, 216, 46)     # rgba(29,78,216,.18)
GRAD_FROM = (219, 234, 254)    # #dbeafe
GRAD_TO = (96, 165, 250)       # #60a5fa


def gradient_rounded(size, radius):
    """135deg gradient fill, clipped to a rounded rect."""
    grad = Image.new("RGBA", (size, size))
    px = grad.load()
    # project each pixel onto the 135deg axis: (x + y) / (2*(size-1))
    denom = max(1, 2 * (size - 1))
    for y in range(size):
        for x in range(size):
            t = (x + y) / denom
            px[x, y] = tuple(
                int(round(GRAD_FROM[i] + (GRAD_TO[i] - GRAD_FROM[i]) * t)) for i in range(3)
            ) + (255,)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(grad, (0, 0), mask)
    return out


def find_font(size):
    """Prefer a bold UI font; fall back to Pillow's bitmap default."""
    for name in ("segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"):
        for base in (r"C:\Windows\Fonts", "/usr/share/fonts/truetype/dejavu"):
            path = os.path.join(base, name)
            if os.path.exists(path):
                return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def render(size):
    scale = 4  # supersample, then downscale for clean edges
    s = size * scale
    radius = int(round(s * 14 / 64.0))
    img = gradient_rounded(s, radius)

    # inset hairline border, same as the CSS box-shadow inset ring
    d = ImageDraw.Draw(img)
    inset = max(1, int(round(scale)))
    d.rounded_rectangle(
        [inset, inset, s - 1 - inset, s - 1 - inset],
        radius=max(1, radius - inset),
        outline=STROKE,
        width=max(1, int(round(2 * scale / 4))),
    )

    font = find_font(int(round(s * 27 / 64.0)))
    box = d.textbbox((0, 0), "SA", font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    # +1px tracking, matching letter-spacing in the CSS brand mark
    track = max(1, int(round(scale)))
    d.text(
        ((s - (tw + track)) / 2 - box[0], (s - th) / 2 - box[1] + s * 0.02),
        "SA",
        font=font,
        fill=NAVY,
    )
    return img.resize((size, size), Image.LANCZOS)


sizes = [16, 32, 48, 64, 128, 180, 256]
images = [render(s) for s in sizes]

# The .ico only needs the tab-icon sizes browsers actually pick from. Embedding
# 180/256 in it too pushed the file past 50 KB for no benefit - those are
# served as standalone PNGs referenced by <link rel="..."> in the page heads.
ICO_SIZES = [16, 32, 48]
by_size = dict(zip(sizes, images))
ico_path = os.path.join(OUT_DIR, "favicon.ico")
by_size[max(ICO_SIZES)].save(
    ico_path, format="ICO", sizes=[(s, s) for s in ICO_SIZES]
)

for s, im in zip(sizes, images):
    out = os.path.join(OUT_DIR, "favicon-%dx%d.png" % (s, s))
    im.save(out, format="PNG")

print("wrote %s (%d bytes, sizes %s) + %d PNGs" % (
    os.path.basename(ico_path), os.path.getsize(ico_path), ICO_SIZES, len(images)))
