import { describe, expect, it } from "vitest";
import desktopPackage from "../../../package.json" with { type: "json" };
import {
  bundledReleaseNotes,
  createBundledReleaseNotes,
} from "./bundledReleaseNotes.ts";

describe("bundled release notes", () => {
  it("bundles the exact desktop package version from the canonical changelog", () => {
    const expectedNotes = `### Changed

- Every dialog in Tesina now shares one look: a larger, clearer title, field
  edges you can actually see before you type, a selected option that stands
  out at a glance, and a footer that reads as part of the window frame.
- Colors, text sizes, and spacing across the interface now come from one
  shared set of values. Light surfaces carry a faint paper warmth instead of
  a flat gray.
- Dropdowns now open a Tesina list instead of the grey system menu, and they
  follow your theme. In the font picker each family previews itself, with its
  APA point size beside it. Arrow keys, Home, End, Escape, and type-to-jump
  all still work.
- On the cover-page form, the course and the instructor each get a full line.
  Side by side, the course placeholder was cut off mid-word.
- Buttons are now one shared set across the whole app instead of five
  near-copies. Sizes settle onto two steps, and a destructive action reads as
  quiet until you reach the step that actually does it, which is filled red.
- Backup settings has been rebuilt around one status panel that answers
  whether your work is safe before anything else, a single obvious action,
  and separate Folder and Advanced sections. The backup path is no longer
  the loudest thing on the screen, and the window now has a Close button.

### Fixed

- The Insert citation button no longer turns its label near-black while you
  point at it in light mode. The label stayed readable in dark mode, so this
  only affected light.
- Font, Heading, List, Table, and Focus buttons in the toolbar keep their
  highlight while you point at them, so an open menu still looks open.
- The recovery notice no longer paints a cream strip that ignored your theme.
- Dropdowns and date fields no longer sit a few pixels shorter than the text
  boxes stacked next to them.
- The Back, Cancel, and Retry buttons in the backup setup wizard were drawn
  with no background or border at all. They look like buttons now.
- Keyboard focus outlines follow each control's own shape instead of being
  forced into the same rounded corner.`;

    expect(bundledReleaseNotes.version).toBe("0.1.7");
    expect(bundledReleaseNotes.version).toBe(desktopPackage.version);
    expect(bundledReleaseNotes.body).toBe(expectedNotes);
    expect(bundledReleaseNotes.body).not.toContain("## [0.1.2]");
  });

  it("fails when the packaged version has no matching changelog section", () => {
    expect(() =>
      createBundledReleaseNotes("2.0.0", "## [1.9.0]\n\n- Older notes.")
    ).toThrow('No changelog section found for version "2.0.0".');
  });

  it("fails when the packaged version section is empty", () => {
    expect(() =>
      createBundledReleaseNotes(
        "2.0.0",
        "## [2.0.0]\n\n## [1.9.0]\n\n- Older notes.",
      )
    ).toThrow('Changelog section for version "2.0.0" is empty.');
  });

  it.each(["", " 2.0.0", "2.0.0 "])(
    "rejects an invalid package version: %j",
    (version) => {
      expect(() =>
        createBundledReleaseNotes(version, `## [${version.trim()}]\n\n- Notes.`)
      ).toThrow("Desktop package version must be a non-empty trimmed string.");
    },
  );
});
