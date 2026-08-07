import { describe, expect, it } from "vitest";

import { extractReleaseNotes } from "./extract-release-notes.ts";

const changelog = `# Changelog

## [Unreleased]

### Changed

- Work still in progress.

## [0.1.0] - 2026-08-07

### Added

- First public macOS release.

### Fixed

- Student title pages match APA 7.

## [0.0.9] - 2026-07-01

### Added

- Internal preview.

[Unreleased]: https://example.com/compare/v0.1.0...HEAD
[0.1.0]: https://example.com/releases/tag/v0.1.0
`;

describe("extractReleaseNotes", () => {
  it("returns only the requested version body", () => {
    expect(extractReleaseNotes(changelog, "0.1.0")).toBe(
      `### Added

- First public macOS release.

### Fixed

- Student title pages match APA 7.`,
    );
  });

  it("fails clearly when the requested version is missing", () => {
    expect(() => extractReleaseNotes(changelog, "9.9.9")).toThrow(
      'No changelog section found for version "9.9.9".',
    );
  });

  it("fails clearly when the requested version appears more than once", () => {
    const duplicate = `${changelog}\n## [0.1.0] - 2026-08-08\n\n- Duplicate.\n`;

    expect(() => extractReleaseNotes(duplicate, "0.1.0")).toThrow(
      'Changelog contains more than one section for version "0.1.0".',
    );
  });

  it("omits changelog link definitions after the last version", () => {
    const finalSection = `# Changelog

## [0.1.0] - 2026-08-07

- First public macOS release.

[Unreleased]: https://example.com/compare/v0.1.0...HEAD
[0.1.0]: https://example.com/releases/tag/v0.1.0
`;

    expect(extractReleaseNotes(finalSection, "0.1.0")).toBe(
      "- First public macOS release.",
    );
  });
});
