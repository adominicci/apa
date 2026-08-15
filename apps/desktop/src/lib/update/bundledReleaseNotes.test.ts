import { describe, expect, it } from "vitest";
import desktopPackage from "../../../package.json" with { type: "json" };
import {
  bundledReleaseNotes,
  createBundledReleaseNotes,
} from "./bundledReleaseNotes.ts";

describe("bundled release notes", () => {
  it("bundles the exact desktop package version from the canonical changelog", () => {
    const expectedNotes = `### Changed

- Export no longer refuses to run when the title page is incomplete. Tesina
  now lists what APA asks for and lets you export anyway, so an unfinished
  cover page can never hold your document hostage.
- The course field accepts whatever you type. The number-colon-name form APA
  expects is still shown as advice instead of being enforced.
- The cover-page form shows every APA suggestion at once, in a yellow panel
  that empties as you fill the fields. Saving is never disabled.`;

    expect(bundledReleaseNotes.version).toBe("0.1.8");
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
