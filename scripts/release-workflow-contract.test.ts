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

  it("uses tauri-action v1 with the stable DMG and updater names", () => {
    expect(releaseWorkflow).toContain("uses: tauri-apps/tauri-action@v1");
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
