"""
Builds the team-bus template from the reference picture (the club bus on a stadium background).

    python3 scripts/make-bus-template.py <reference.png>

Writes public/bus/:
  base.webp   the picture with the club's lettering and crests removed (the app paints its own)
  paint.webp  (lossless) R = how much of a pixel is the main colour (yellow in the reference: body, brush strokes)
              G = how much is the second colour (royal blue: swoosh, roof line, strokes)
              B = shade, 128 = the reference tone, below darkens, above lightens toward white (gloss)
The runtime (src/lib/busArt.ts) recolours with the event kit and writes the team name and logo
into the spots listed in LAYOUT there (coordinates of the 1774x887 reference, scaled to the output).
Only numpy and Pillow are needed.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC_W, SRC_H = 1774, 887
OUT_W, OUT_H = 1400, 700

# areas in the reference (pixels)
TEXT_AREA = [(334, 492), (560, 470), (727, 457), (729, 634), (334, 636)]   # "מכבי הרצליה / כדורגל" on the side
SIDE_CREST = (260, 592, 64, 104)                                          # cx, cy, rx, ry of the crest on the side
CORNER_CREST = (201, 175, 166)                                            # cx, cy, r of the big crest top-left
BALL = (1655, 775, 128)
GLASS = [
    [(95, 432), (870, 196), (870, 424), (100, 500)],                       # side windows
    [(873, 245), (1000, 236), (1000, 528), (873, 528)],                    # door
    [(1000, 168), (1300, 168), (1480, 420), (1480, 600), (1030, 578)],     # windscreen
]


def poly_mask(polys, shape):
    m = Image.new('L', (shape[1], shape[0]), 0)
    d = ImageDraw.Draw(m)
    for p in polys:
        d.polygon(p, fill=255)
    return np.asarray(m) > 0


def ellipse_mask(cx, cy, rx, ry, shape):
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
    return ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1


def hsv(img):
    a = np.asarray(Image.fromarray(img).convert('HSV')).astype(float)
    return a[..., 0] * 360 / 255, a[..., 1] / 255, a[..., 2] / 255


def is_yellow(img):
    h, s, v = hsv(img)
    return (h > 30) & (h < 66) & (s > 0.5) & (v > 0.35)


def is_royal(img):
    f = img.astype(float)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    return (b > 80) & (g < 80) & (g < 0.45 * b) & (r < 0.3 * b)


def fill_along(img, hole, slope):
    """Fills the hole by interpolating, along lines of the given slope, between the nearest pixels outside it."""
    out = img.astype(float).copy()
    h, w = hole.shape
    ys, xs = np.nonzero(hole)
    norm = np.hypot(1, slope)
    dx, dy = 1 / norm, slope / norm
    for y, x in zip(ys, xs):
        ends = []
        for sgn in (1, -1):
            t = 1
            while True:
                px, py = int(round(x + sgn * dx * t)), int(round(y + sgn * dy * t))
                if not (0 <= px < w and 0 <= py < h):
                    ends.append(None)
                    break
                if not hole[py, px]:
                    ends.append((t, img[py, px].astype(float)))
                    break
                t += 1
        a, b = ends
        if a and b:
            out[y, x] = (a[1] * b[0] + b[1] * a[0]) / (a[0] + b[0])
        elif a or b:
            out[y, x] = (a or b)[1]
    return out.astype(np.uint8)


def main(src):
    img = np.asarray(Image.open(src).convert('RGB').resize((SRC_W, SRC_H), Image.LANCZOS)).copy()
    shape = img.shape[:2]

    # 1. remove the lettering on the side: refill the whole text area row by row from its two edges (body
    #    yellow on both), then soften so no row streaks remain
    area = poly_mask([TEXT_AREA], shape)
    filled = fill_along(img, area, 0.0)
    soft = np.asarray(Image.fromarray(filled).filter(ImageFilter.GaussianBlur(3)))
    img = np.where(area[..., None], soft, img)
    # 2. the crest on the side (across the swoosh) and the big crest in the corner
    side = ellipse_mask(*SIDE_CREST, shape)
    img = fill_along(img, side, 0.37)
    cx, cy, r = CORNER_CREST
    corner = ellipse_mask(cx, cy, r, r, shape)
    img = fill_along(img, corner, -0.47)

    # 3. paint masks
    ball = ellipse_mask(*BALL[:2], BALL[2], BALL[2], shape)
    glass = poly_mask(GLASS, shape)
    def clean(m, k):
        im = Image.fromarray(m.astype(np.uint8) * 255).filter(ImageFilter.MinFilter(k)).filter(ImageFilter.MaxFilter(k))
        return np.asarray(im) > 0
    yel = clean(is_yellow(img), 3)
    roy = clean(is_royal(img) & ~ball & ~glass, 3)
    # the refilled text area is all paint: bluish pixels (the swoosh's tail) take the second colour, the rest the main
    fi = img.astype(int)
    bluish = area & (fi[..., 2] > fi[..., 0])
    yel = (yel & ~area) | (area & ~bluish)
    roy = (roy & ~area) | bluish

    f = img.astype(float) / 255
    lum = 0.299 * f[..., 0] + 0.587 * f[..., 1] + 0.114 * f[..., 2]
    h, _, _ = hsv(img)
    ref = np.where((h > 150) & (h < 280), 0.166, 0.787)  # tone of the reference blue / yellow
    shade = np.where(lum >= ref, (lum - ref) / (1 - ref), lum / ref - 1)
    shade = np.clip(shade, -1, 1)

    def soft(m):
        im = Image.fromarray(m.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.1))
        return np.asarray(im).astype(float) / 255
    p, s = soft(yel), soft(roy)
    total = p + s
    over = total > 1
    p[over] /= total[over]
    s[over] /= total[over]

    shade[(p + s) < 0.004] = 0  # shade only matters where a colour is painted; flat elsewhere keeps the file small
    paint = np.dstack([p * 255, s * 255, 128 + 127 * shade]).round().clip(0, 255).astype(np.uint8)
    out = Path(__file__).resolve().parent.parent / 'public' / 'bus'
    out.mkdir(parents=True, exist_ok=True)
    Image.fromarray(img).resize((OUT_W, OUT_H), Image.LANCZOS).save(out / 'base.webp', quality=86, method=6)
    Image.fromarray(paint).resize((OUT_W, OUT_H), Image.BILINEAR).save(out / 'paint.webp', lossless=True, method=6)
    print('written', out)


if __name__ == '__main__':
    main(sys.argv[1])
