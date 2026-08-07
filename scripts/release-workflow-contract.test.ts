import { describe, expect, it } from "vitest";

const root = decodeURIComponent(new URL("../", import.meta.url).pathname);
const releaseWorkflow = await Deno.readTextFile(
  `${root}.github/workflows/release.yml`,
);
const mergeWorkflow = await Deno.readTextFile(
  `${root}.github/workflows/build-artifacts.yml`,
);
const tauriConfig = JSON.parse(
  await Deno.readTextFile(`${root}apps/desktop/src-tauri/tauri.conf.json`),
);

describe("release workflow contract", () => {
  it("publishes only one universal macOS app and DMG build", () => {
    expect(releaseWorkflow).toContain("runs-on: macos-latest");
    expect(releaseWorkflow).toContain("--target universal-apple-darwin");
    expect(releaseWorkflow).toContain("--bundles app,dmg");
    expect(releaseWorkflow).not.toMatch(/windows-latest|ubuntu-|matrix:/);
  });

  it("pins every action used by the secret-bearing release job", () => {
    expect(releaseWorkflow).toContain(
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7",
    );
    expect(releaseWorkflow).toContain("persist-credentials: false");
    expect(releaseWorkflow).toContain(
      "denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed # v2",
    );
    expect(releaseWorkflow).toContain(
      "dtolnay/rust-toolchain@4360b52568e2003a75bf9bc1d59f33a8e3fc893c # stable",
    );
    expect(releaseWorkflow).toContain(
      "swatinem/rust-cache@6323deb102c322ba6fcbdcafc7e3dddab59af2b6 # v2",
    );
    expect(releaseWorkflow).toContain(
      "tauri-apps/tauri-action@1deb371b0cd8bd54025b384f1cd735e725c4060f # v1",
    );
    expect(releaseWorkflow).not.toMatch(
      /uses:\s+[^\n]+@(v\d+|main|master)\s*$/m,
    );
  });

  it("uses the stable DMG and updater names", () => {
    expect(releaseWorkflow).toContain(
      "releaseAssetNamePattern: Tesina-macos-universal[ext]",
    );
    expect(releaseWorkflow).toContain("uploadUpdaterJson: true");
    expect(releaseWorkflow).toContain("uploadUpdaterSignatures: true");
    expect(releaseWorkflow).toContain("uploadWorkflowArtifacts: false");
  });

  it("keeps publication manual and uses extracted notes", () => {
    expect(releaseWorkflow).toContain("releaseDraft: true");
    expect(releaseWorkflow).toContain("prerelease: false");
    expect(releaseWorkflow).toContain(
      "releaseBody: ${{ steps.release-notes.outputs.body }}",
    );
    expect(releaseWorkflow).toContain("scripts/extract-release-notes.ts");
    expect(releaseWorkflow).toContain("scripts/verify-release-version.ts");
    expect(releaseWorkflow).toContain("scripts/verify-release-draft.ts");
  });

  it("references only the documented updater secrets", () => {
    expect(releaseWorkflow).toContain(
      "secrets.TAURI_SIGNING_PRIVATE_KEY }}",
    );
    expect(releaseWorkflow).toContain(
      "secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}",
    );
    expect(releaseWorkflow.match(/TAURI_SIGNING_PRIVATE_KEY:/g)).toHaveLength(
      1,
    );
    expect(
      releaseWorkflow.match(/TAURI_SIGNING_PRIVATE_KEY_PASSWORD:/g),
    ).toHaveLength(1);
  });

  it("gives write permission only to the release job", () => {
    expect(releaseWorkflow.match(/contents: write/g)).toHaveLength(1);
    expect(releaseWorkflow).not.toContain("contents: read");
  });

  it("configures updater artifacts and documented ad-hoc macOS signing", () => {
    expect(tauriConfig.bundle.createUpdaterArtifacts).toBe(true);
    expect(tauriConfig.bundle.macOS.signingIdentity).toBe("-");
  });

  it("fails the tag job when the app or DMG package is structurally invalid", () => {
    expect(releaseWorkflow).toContain(
      "scripts/prepare-macos-release-artifacts.ts",
    );
    expect(releaseWorkflow).toContain("lipo -archs");
    expect(releaseWorkflow).toContain("arm64 x86_64");
    expect(releaseWorkflow).toContain("codesign --verify --deep --strict");
    expect(releaseWorkflow).toContain("hdiutil verify");
    expect(releaseWorkflow).toContain("hdiutil attach -readonly -nobrowse");
    expect(releaseWorkflow).toContain('"$mount_dir/Tesina.app"');
    expect(releaseWorkflow).toContain("hdiutil detach");
  });

  it("downloads and cryptographically verifies the updater archive", () => {
    expect(releaseWorkflow).toContain(
      'select(.name == "Tesina-macos-universal.app.tar.gz")',
    );
    expect(releaseWorkflow).toContain(
      'select(.name == "Tesina-macos-universal.app.tar.gz.sig")',
    );
    expect(releaseWorkflow).toContain(
      "--manifest-path scripts/updater-signature-verifier/Cargo.toml",
    );
    expect(releaseWorkflow).toContain("--locked");
  });

  it("preserves the merge workflow's no-upload policy", () => {
    expect(mergeWorkflow).toMatch(/macos-latest/);
    expect(mergeWorkflow).toMatch(/windows-latest/);
    expect(mergeWorkflow).toMatch(/ubuntu-22\.04/);
    expect(mergeWorkflow).toContain("uploadUpdaterJson: false");
    expect(mergeWorkflow).toContain("uploadWorkflowArtifacts: false");
    expect(mergeWorkflow).not.toMatch(
      /tagName:|releaseName:|releaseDraft:|contents: write|GITHUB_TOKEN/,
    );
  });
});
