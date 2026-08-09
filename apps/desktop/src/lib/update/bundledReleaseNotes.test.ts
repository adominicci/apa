import { describe, expect, it } from "vitest";
import desktopPackage from "../../../package.json" with { type: "json" };
import {
  bundledReleaseNotes,
  createBundledReleaseNotes,
} from "./bundledReleaseNotes.ts";

describe("bundled release notes", () => {
  it("bundles the exact desktop package version from the canonical changelog", () => {
    const expectedNotes = `### Added

- Export your complete library — every essay, reference, collection, and
  figure — as one portable \`.tesina\` file you can copy, move, or keep
  anywhere. Tesina verifies the saved file by reopening it before reporting
  success.
- Import a \`.tesina\` file with a clear preview first: new content is added,
  identical content is skipped, and anything that differs is kept as a
  separate imported copy. Importing never replaces or deletes your current
  work, and an interrupted import is finished or undone safely the next time
  Tesina starts.
- Optional daily backups to one folder you choose — including folders synced
  by Google Drive, iCloud Drive, OneDrive, or Dropbox — set up through a
  five-step guided wizard in your language. Tesina keeps the seven newest
  backups from this computer, never touches anyone else's files, and shows
  you the last successful backup at a glance.
- Restore from a backup by merging it into your current library, so newer
  work is never rolled back or replaced.
- Backup files are complete and not password-protected; the wizard explains
  this clearly before anything is written.`;

    expect(bundledReleaseNotes.version).toBe("0.1.4");
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
