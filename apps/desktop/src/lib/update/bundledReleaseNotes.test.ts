import { describe, expect, it } from "vitest";
import desktopPackage from "../../../package.json" with { type: "json" };
import {
  bundledReleaseNotes,
  createBundledReleaseNotes,
} from "./bundledReleaseNotes.ts";

describe("bundled release notes", () => {
  it("bundles the exact desktop package version from the canonical changelog", () => {
    const expectedNotes = `### Changed

- Backup setup now uses neutral first-time wording whenever no configured
  backup folder can be confirmed.
- Backup folder access is now anchored entirely in native, renderer-denied
  storage. People who configured backups in v0.1.16 must select the folder
  again and complete one real test backup; existing backup files remain
  untouched. Later v0.1.17 restarts keep the renewed authorization, while a
  missing native trust anchor fails closed and asks for authorization again.
- Tesina's packaged web content and build dependencies now use tighter
  security boundaries without changing native DOI, ISBN, or update access.

### Fixed

- One damaged paper file no longer hides every other paper. Tesina preserves
  unreadable files, names them in recovery guidance, and keeps reference
  deletion blocked while the library scan is incomplete.
- The editor's Add menu now closes when you click outside it or press Escape,
  and keyboard focus returns to the Add button.
- Opening Tesina again on a Mac now shows and focuses the existing window even
  when it was hidden with the close button.`;

    expect(bundledReleaseNotes.version).toBe("0.1.17");
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
