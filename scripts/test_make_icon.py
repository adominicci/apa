#!/usr/bin/env python3
"""Regression checks for the generated Tesina app icon."""

import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_BOUNDS = (100, 100, 924, 924)


class AppIconTest(unittest.TestCase):
    def test_desktop_icon_artwork_uses_the_optical_safe_area(self) -> None:
        paths = (
            ROOT / "apps/desktop/src-tauri/app-icon.png",
            ROOT / "apps/desktop/src-tauri/icons/icon.icns",
        )

        for path in paths:
            with self.subTest(path=path.relative_to(ROOT)):
                with Image.open(path) as image:
                    rgba = image.convert("RGBA")
                    self.assertEqual(rgba.size, (1024, 1024))
                    self.assertEqual(
                        rgba.getchannel("A").getbbox(), EXPECTED_BOUNDS
                    )


if __name__ == "__main__":
    unittest.main()
