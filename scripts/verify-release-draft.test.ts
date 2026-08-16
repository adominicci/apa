import { describe, expect, it } from "vitest";

import { verifyReleaseDraft } from "./verify-release-draft.ts";

const notes = "### Added\n\n- First public macOS release.";
const signatureAsset = "trusted updater signature";
const archiveUrl =
  "https://api.github.com/repos/adominicci/apa/releases/assets/102";
const browserDownloadUrl =
  "https://github.com/adominicci/apa/releases/download/untagged-b68ed30bf5463e9ba16d/Tesina-macos-universal.app.tar.gz";
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
        browser_download_url:
          "https://github.com/adominicci/apa/releases/download/untagged-b68ed30bf5463e9ba16d/Tesina-macos-universal.dmg",
      },
      {
        name: "Tesina-macos-universal.app.tar.gz",
        url: archiveUrl,
        browser_download_url: browserDownloadUrl,
      },
      {
        name: "Tesina-macos-universal.app.tar.gz.sig",
        url: "https://api.github.com/repos/adominicci/apa/releases/assets/103",
        browser_download_url:
          "https://github.com/adominicci/apa/releases/download/untagged-b68ed30bf5463e9ba16d/Tesina-macos-universal.app.tar.gz.sig",
      },
      {
        name: "latest.json",
        url: "https://api.github.com/repos/adominicci/apa/releases/assets/104",
        browser_download_url:
          "https://github.com/adominicci/apa/releases/download/untagged-b68ed30bf5463e9ba16d/latest.json",
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

const windowsExeSignature = "trusted windows exe signature";
const windowsMsiSignature = "trusted windows msi signature";
const exeUrl =
  "https://api.github.com/repos/adominicci/apa/releases/assets/201";
const msiUrl =
  "https://api.github.com/repos/adominicci/apa/releases/assets/202";

function fullRelease() {
  const release = validRelease();
  release.assets.push(
    {
      name: "Tesina-windows-x64.exe",
      url: exeUrl,
      browser_download_url:
        "https://github.com/adominicci/apa/releases/download/untagged-b68ed30bf5463e9ba16d/Tesina-windows-x64.exe",
    },
    {
      name: "Tesina-windows-x64.exe.sig",
      url: "https://api.github.com/repos/adominicci/apa/releases/assets/203",
      browser_download_url:
        "https://github.com/adominicci/apa/releases/download/untagged-b68ed30bf5463e9ba16d/Tesina-windows-x64.exe.sig",
    },
    {
      name: "Tesina-windows-x64.msi",
      url: msiUrl,
      browser_download_url:
        "https://github.com/adominicci/apa/releases/download/untagged-b68ed30bf5463e9ba16d/Tesina-windows-x64.msi",
    },
    {
      name: "Tesina-windows-x64.msi.sig",
      url: "https://api.github.com/repos/adominicci/apa/releases/assets/204",
      browser_download_url:
        "https://github.com/adominicci/apa/releases/download/untagged-b68ed30bf5463e9ba16d/Tesina-windows-x64.msi.sig",
    },
  );
  return release;
}

function fullManifest() {
  const manifest = validManifest();
  manifest.platforms["windows-x86_64"] = {
    signature: windowsExeSignature,
    url: exeUrl,
  };
  manifest.platforms["windows-x86_64-nsis"] = {
    signature: windowsExeSignature,
    url: exeUrl,
  };
  manifest.platforms["windows-x86_64-msi"] = {
    signature: windowsMsiSignature,
    url: msiUrl,
  };
  return manifest;
}

function fullContract() {
  return {
    release: fullRelease(),
    manifest: fullManifest(),
    version: "0.1.0",
    notes,
    signatureAsset,
    stage: "full" as const,
    windowsExeSignature,
    windowsMsiSignature,
  };
}

describe("verifyReleaseDraft", () => {
  it("accepts the archive REST API URL for every updater platform", () => {
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

  it("rejects a different release asset API URL", () => {
    const manifest = validManifest();
    for (const platform of Object.values(manifest.platforms)) {
      platform.url =
        "https://api.github.com/repos/adominicci/apa/releases/assets/999";
    }

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
      browser_download_url:
        "https://github.com/adominicci/apa/releases/download/v0.1.0/Tesina-windows-x64.msi",
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

  it("rejects the archive browser download URL under the pinned producer contract", () => {
    const manifest = validManifest();
    for (const platform of Object.values(manifest.platforms)) {
      platform.url = browserDownloadUrl;
    }

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

  it("accepts a complete two-platform draft in the full stage", () => {
    expect(() => verifyReleaseDraft(fullContract())).not.toThrow();
  });

  it("ignores surrounding whitespace on either side of a signature", () => {
    const contract = fullContract();
    // A downloaded asset may arrive with a trailing newline the manifest
    // value lacks; the base64 payload is what has to match.
    contract.signatureAsset = `${signatureAsset}\n`;
    contract.manifest.platforms["windows-x86_64"].signature =
      `${windowsExeSignature}\n`;

    expect(() => verifyReleaseDraft(contract)).not.toThrow();
  });

  it("still rejects a signature that differs beyond whitespace", () => {
    const contract = fullContract();
    contract.windowsExeSignature = `${windowsExeSignature} tampered\n`;

    expect(() => verifyReleaseDraft(contract)).toThrow(
      "signature asset does not match",
    );
  });

  it("full stage rejects a missing Windows platform key", () => {
    const contract = fullContract();
    delete contract.manifest.platforms["windows-x86_64"];

    expect(() => verifyReleaseDraft(contract)).toThrow(
      'latest.json is missing platform "windows-x86_64"',
    );
  });

  it("full stage rejects a Windows updater URL that points at the MSI", () => {
    const contract = fullContract();
    contract.manifest.platforms["windows-x86_64"].url = msiUrl;

    expect(() => verifyReleaseDraft(contract)).toThrow(
      'latest.json platform "windows-x86_64" does not point to Tesina-windows-x64.exe',
    );
  });

  it("full stage rejects a Windows signature that differs from the sig asset", () => {
    const contract = fullContract();
    contract.manifest.platforms["windows-x86_64-msi"].signature =
      "tampered signature";

    expect(() => verifyReleaseDraft(contract)).toThrow(
      'signature asset does not match latest.json platform "windows-x86_64-msi"',
    );
  });

  it("full stage rejects a release without the Windows sig assets", () => {
    const contract = fullContract();
    contract.release.assets = contract.release.assets.filter(
      ({ name }) => name !== "Tesina-windows-x64.exe.sig",
    );

    expect(() => verifyReleaseDraft(contract)).toThrow(
      "release asset names do not match",
    );
  });

  it("full stage requires both downloaded Windows signatures", () => {
    const contract = fullContract();
    contract.windowsMsiSignature = undefined as unknown as string;

    expect(() => verifyReleaseDraft(contract)).toThrow(
      "full stage requires both Windows signature assets",
    );
  });

  it("rejects non-macOS platforms in latest.json", () => {
    const manifest = validManifest();
    manifest.platforms["windows-x86_64"] = {
      signature: "signature",
      url: browserDownloadUrl,
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
