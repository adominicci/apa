import { describe, expect, it } from "vitest";
import desktopPackage from "../../../package.json" with { type: "json" };
import {
  bundledReleaseNotes,
  createBundledReleaseNotes,
} from "./bundledReleaseNotes.ts";

describe("bundled release notes", () => {
  it("bundles the exact desktop package version from the canonical changelog", () => {
    const expectedNotes = `### Changed

- Installing Tesina on a Mac is now a single step. The app is signed with an
  Apple Developer ID certificate and notarized by Apple, so the first launch
  only asks whether you want to open an app downloaded from the internet.
  Nobody has to visit System Settings to allow a blocked app anymore.`;

    expect(bundledReleaseNotes.version).toBe("0.1.10");
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
