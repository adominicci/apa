#!/usr/bin/env python3
"""Regenerate the Tesina source app icon.

Writes apps/desktop/src-tauri/app-icon.png (1024x1024): a blue rounded square
in Tesina blue (#2158D6) with a centered white serif "T" and transparent
optical padding. After running this, regenerate every platform size with:

    cd apps/desktop && deno task tauri icon src-tauri/app-icon.png

Requires Pillow (`pip install pillow`) and a serif font. Georgia Bold ships
with macOS; on other platforms point FONT_PATH at any bold serif .ttf.
"""
import os

from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
INSET = 100  # 80.5% artwork coverage, aligned with standard macOS Dock icons
ART_SIZE = SIZE - (2 * INSET)
SCALE = ART_SIZE / SIZE
RADIUS = round(205 * SCALE)
FONT_SIZE = round(640 * SCALE)
BLUE = (33, 88, 214, 255)  # #2158D6
WHITE = (255, 255, 255, 255)
FONT_PATH = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(
    os.path.join(HERE, "..", "apps", "desktop", "src-tauri", "app-icon.png")
)

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Inset rounded square in Tesina blue. The transparent border keeps the icon's
# optical size consistent with neighboring apps in the macOS Dock.
draw.rounded_rectangle(
    [INSET, INSET, SIZE - INSET - 1, SIZE - INSET - 1],
    radius=RADIUS,
    fill=BLUE,
)

# Centered white serif "T".
font = ImageFont.truetype(FONT_PATH, FONT_SIZE)
bbox = draw.textbbox((0, 0), "T", font=font)
tw = bbox[2] - bbox[0]
th = bbox[3] - bbox[1]
x = (SIZE - tw) / 2 - bbox[0]
y = (SIZE - th) / 2 - bbox[1]
draw.text((x, y), "T", font=font, fill=WHITE)

img.save(OUT, "PNG")
print("wrote", OUT, img.size)
