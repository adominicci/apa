import { describe, expect, it } from "vitest";

import { verifyReleaseVersion } from "./verify-release-version.ts";

const validContract = {
  tag: "v0.1.0",
  tauriConfig: JSON.stringify({ version: "0.1.0" }),
  packageJson: JSON.stringify({ name: "tesina", version: "0.1.0" }),
  cargoToml: `[package]\nname = "tesina"\nversion = "0.1.0"\n`,
  changelog:
    `# Changelog\n\n## [0.1.0] - 2026-08-07\n\n- First public release.\n`,
};

describe("verifyReleaseVersion", () => {
  it("accepts one version shared by the tag, app metadata, and changelog", () => {
    expect(verifyReleaseVersion(validContract)).toBe("0.1.0");
  });

  it("requires an exact v-prefixed release tag", () => {
    expect(() => verifyReleaseVersion({ ...validContract, tag: "0.1.0" }))
      .toThrow('Release tag must start with "v"; received "0.1.0".');
  });

  it.each([
    ["Tauri", "tauriConfig", JSON.stringify({ version: "0.1.1" })],
    ["package", "packageJson", JSON.stringify({ version: "0.1.1" })],
    [
      "Cargo",
      "cargoToml",
      `[package]\nname = "tesina"\nversion = "0.1.1"\n`,
    ],
  ])("rejects a mismatched %s version", (label, field, value) => {
    expect(() =>
      verifyReleaseVersion({
        ...validContract,
        [field]: value,
      })
    ).toThrow(`${label} version must be "0.1.0"`);
  });

  it("requires a nonempty matching changelog section", () => {
    expect(() =>
      verifyReleaseVersion({
        ...validContract,
        changelog: "## [0.1.1]\n\n- Later.\n",
      })
    ).toThrow('No changelog section found for version "0.1.0".');
  });

  it("reads only the package table version from Cargo.toml", () => {
    expect(
      verifyReleaseVersion({
        ...validContract,
        cargoToml:
          `[workspace.package]\nversion = "9.9.9"\n\n[package]\nname = "tesina"\nversion = "0.1.0"\n\n[dependencies]\nexample = { version = "3.0.0" }\n`,
      }),
    ).toBe("0.1.0");
  });
});
