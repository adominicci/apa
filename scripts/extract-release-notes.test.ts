import { describe, expect, it } from "vitest";

import { extractReleaseNotes } from "../apps/desktop/src/lib/update/extractReleaseNotes.ts";

const decoder = new TextDecoder();
const scriptPath = decodeURIComponent(
  new URL("./extract-release-notes.ts", import.meta.url).pathname,
);

async function runCli(
  contents: string,
  version: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const temporaryDirectory = await Deno.makeTempDir({
    prefix: "tesina-release-notes-",
  });
  const changelogPath = `${temporaryDirectory}/CHANGELOG.md`;

  try {
    await Deno.writeTextFile(changelogPath, contents);
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", scriptPath, changelogPath, version],
      stdout: "piped",
      stderr: "piped",
    }).output();

    return {
      code: output.code,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
    };
  } finally {
    await Deno.remove(temporaryDirectory, { recursive: true });
  }
}

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
  it("keeps the shared extractor pure and the CLI adapter thin", async () => {
    const extractorSource = await Deno.readTextFile(
      new URL(
        "../apps/desktop/src/lib/update/extractReleaseNotes.ts",
        import.meta.url,
      ),
    );
    const cliSource = await Deno.readTextFile(
      new URL("./extract-release-notes.ts", import.meta.url),
    );

    expect(extractorSource).not.toMatch(
      /\b(?:import|Deno|window|document|localStorage)\b/,
    );
    expect(cliSource).toContain(
      'import { extractReleaseNotes } from "../apps/desktop/src/lib/update/extractReleaseNotes.ts";',
    );
    expect(cliSource).not.toContain("function escapeRegExp");
  });

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

  it("fails clearly when the requested version section is empty", () => {
    const empty = `# Changelog

## [0.1.0] - 2026-08-07

## [0.0.9] - 2026-07-01

- Internal preview.
`;

    expect(() => extractReleaseNotes(empty, "0.1.0")).toThrow(
      'Changelog section for version "0.1.0" is empty.',
    );
  });

  it("supports CRLF changelogs", () => {
    const crlf = [
      "# Changelog",
      "",
      "## [0.1.0] - 2026-08-07",
      "",
      "- First public release.",
      "",
      "## [0.0.9] - 2026-07-01",
      "",
      "- Preview.",
      "",
    ].join("\r\n");

    expect(extractReleaseNotes(crlf, "0.1.0")).toBe(
      "- First public release.",
    );
  });

  it("separates adjacent version headings", () => {
    const adjacent = `## [0.1.0]
- Current.
## [0.0.9]
- Previous.
`;

    expect(extractReleaseNotes(adjacent, "0.1.0")).toBe("- Current.");
  });

  it("matches version strings containing regular-expression metacharacters", () => {
    const versioned = `## [1.0.0+dev(1)]

- Development build.

## [1x0x0+devv1]

- Must not match.
`;

    expect(extractReleaseNotes(versioned, "1.0.0+dev(1)")).toBe(
      "- Development build.",
    );
  });

  it("preserves an interior reference-style link and all later notes", () => {
    const linked = `## [0.1.0]

### Changed

[docs]: https://example.com/details

- Read the linked details before updating.
- Keep this later note.

## [0.0.9]

- Previous.
`;

    expect(extractReleaseNotes(linked, "0.1.0")).toBe(
      `### Changed

[docs]: https://example.com/details

- Read the linked details before updating.
- Keep this later note.`,
    );
  });

  it("prints only the requested notes on successful CLI execution", async () => {
    const result = await runCli(changelog, "0.1.0");

    expect(result).toEqual({
      code: 0,
      stdout: `### Added

- First public macOS release.

### Fixed

- Student title pages match APA 7.\n`,
      stderr: "",
    });
  });

  it("exits nonzero without stdout when the CLI section is empty", async () => {
    const result = await runCli(
      `## [0.1.0]\n\n## [0.0.9]\n\n- Previous.\n`,
      "0.1.0",
    );

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: 'Changelog section for version "0.1.0" is empty.\n',
    });
  });
});

describe("release documentation claims only shipped workflows", () => {
  it("keeps the v0.1.0 notes free of the PDF claims that shipped in 0.1.9", async () => {
    const releaseNotes = extractReleaseNotes(
      await Deno.readTextFile(new URL("../CHANGELOG.md", import.meta.url)),
      "0.1.0",
    );

    expect(releaseNotes).toContain(
      "- Paged preview and Word export, with student title-page validation.",
    );
    // A released section is history: PDF did not exist in 0.1.0 and must never
    // be back-dated into its notes.
    expect(releaseNotes).not.toMatch(/\b(?:print(?:ing)?|PDF)\b/i);
  });

  it("advertises PDF export only as the shipped export path, never printing", async () => {
    const readme = await Deno.readTextFile(
      new URL("../README.md", import.meta.url),
    );

    expect(readme).toContain("Provides a paged preview and exports `.docx`");
    expect(readme).toContain("Exports PDF from the same pages the preview");
    // The original guard banned "PDF" outright because 0.1.0 had no PDF path.
    // It now guards the promise instead: Tesina saves a PDF straight to a
    // chosen folder, so the README must not offer printing as a workflow. The
    // one allowed mention is the negative — that no print panel appears.
    for (const line of readme.split("\n")) {
      if (!/\bprint(?:ing|s|er)?\b/i.test(line)) continue;
      expect(line).toMatch(
        /without going through the macOS print panel|preview/i,
      );
    }
  });
});
