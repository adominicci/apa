import { describe, expect, it } from "vitest";

import { verifyReleaseDraft } from "./verify-release-draft.ts";

const notes = "### Added\n\n- First public macOS release.";
const signatureAsset = "trusted updater signature";
const archiveUrl =
  "https://api.github.com/repos/adominicci/apa/releases/assets/102";
const expectedPlatformKeys = [
  "darwin-universal",
  "darwin-aarch64",
  "darwin-x86_64",
  "darwin-universal-app",
  "darwin-aarch64-app",
  "darwin-x86_64-app",
];

function validRelease() {
  return {
    draft: true,
    prerelease: false,
    tag_name: "v0.1.0",
    body: notes,
    assets: [
      {
        name: "Tesina-macos-universal.dmg",
        url: "https://api.github.com/repos/adominicci/apa/releases/assets/101",
      },
      {
        name: "Tesina-macos-universal.app.tar.gz",
        url: archiveUrl,
      },
      {
        name: "Tesina-macos-universal.app.tar.gz.sig",
        url: "https://api.github.com/repos/adominicci/apa/releases/assets/103",
      },
      {
        name: "latest.json",
        url: "https://api.github.com/repos/adominicci/apa/releases/assets/104",
      },
    ],
  };
}

function validManifest() {
  return {
    version: "0.1.0",
    notes,
    pub_date: "2026-08-07T12:00:00.000Z",
    platforms: Object.fromEntries(
      expectedPlatformKeys.map((key) => [key, {
        signature: signatureAsset,
        url: archiveUrl,
      }]),
    ),
  };
}

describe("verifyReleaseDraft", () => {
  it("accepts the exact draft release and universal macOS updater manifest", () => {
    expect(() =>
      verifyReleaseDraft({
        release: validRelease(),
        manifest: validManifest(),
        version: "0.1.0",
        notes,
        signatureAsset,
      })
    ).not.toThrow();
  });

  it.each([
    ["published", { draft: false }, "must remain a draft"],
    ["prerelease", { prerelease: true }, "must not be a prerelease"],
    ["wrong tag", { tag_name: "v0.1.1" }, 'tag must be "v0.1.0"'],
    ["wrong notes", { body: "Different notes" }, "release body"],
  ])("rejects a %s release", (_name, changes, message) => {
    expect(() =>
      verifyReleaseDraft({
        release: { ...validRelease(), ...changes },
        manifest: validManifest(),
        version: "0.1.0",
        notes,
        signatureAsset,
      })
    ).toThrow(message);
  });

  it("rejects missing, unexpected, and Windows release assets", () => {
    const release = validRelease();
    release.assets.pop();
    release.assets.push({
      name: "Tesina-windows-x64.msi",
      url: "https://api.github.com/repos/adominicci/apa/releases/assets/105",
    });

    expect(() =>
      verifyReleaseDraft({
        release,
        manifest: validManifest(),
        version: "0.1.0",
        notes,
        signatureAsset,
      })
    ).toThrow("release asset names do not match the macOS contract");
  });

  it("rejects updater notes that differ from the release body", () => {
    expect(() =>
      verifyReleaseDraft({
        release: validRelease(),
        manifest: { ...validManifest(), notes: "Different notes" },
        version: "0.1.0",
        notes,
        signatureAsset,
      })
    ).toThrow("latest.json notes");
  });

  it("requires the downloaded signature asset to match every manifest signature", () => {
    expect(() =>
      verifyReleaseDraft({
        release: validRelease(),
        manifest: validManifest(),
        version: "0.1.0",
        notes,
        signatureAsset: "different signature asset",
      })
    ).toThrow("signature asset does not match latest.json");
  });

  it("requires every universal and native macOS updater key", () => {
    const manifest = validManifest();
    delete manifest.platforms["darwin-x86_64"];

    expect(() =>
      verifyReleaseDraft({
        release: validRelease(),
        manifest,
        version: "0.1.0",
        notes,
        signatureAsset,
      })
    ).toThrow('latest.json is missing platform "darwin-x86_64"');
  });

  it("requires every platform URL to resolve to the uploaded updater archive", () => {
    const manifest = validManifest();
    manifest.platforms["darwin-aarch64"].url =
      "https://example.com/wrong-asset";

    expect(() =>
      verifyReleaseDraft({
        release: validRelease(),
        manifest,
        version: "0.1.0",
        notes,
        signatureAsset,
      })
    ).toThrow("does not point to Tesina-macos-universal.app.tar.gz");
  });

  it("rejects non-macOS platforms in latest.json", () => {
    const manifest = validManifest();
    manifest.platforms["windows-x86_64"] = {
      signature: "signature",
      url: archiveUrl,
    };

    expect(() =>
      verifyReleaseDraft({
        release: validRelease(),
        manifest,
        version: "0.1.0",
        notes,
        signatureAsset,
      })
    ).toThrow('unexpected updater platform "windows-x86_64"');
  });
});
