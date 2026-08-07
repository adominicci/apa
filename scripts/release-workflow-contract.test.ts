import { describe, expect, it } from "vitest";

const root = decodeURIComponent(new URL("../", import.meta.url).pathname);
const releaseWorkflow = await Deno.readTextFile(
  `${root}.github/workflows/release.yml`,
);
const mergeWorkflow = await Deno.readTextFile(
  `${root}.github/workflows/build-artifacts.yml`,
);
const workflowDirectory = `${root}.github/workflows`;
const workflowFiles: Array<{ name: string; source: string }> = [];
for await (const entry of Deno.readDir(workflowDirectory)) {
  if (entry.isFile && /\.ya?ml$/.test(entry.name)) {
    workflowFiles.push({
      name: entry.name,
      source: await Deno.readTextFile(`${workflowDirectory}/${entry.name}`),
    });
  }
}
workflowFiles.sort((left, right) => left.name.localeCompare(right.name));
const tauriConfig = JSON.parse(
  await Deno.readTextFile(`${root}apps/desktop/src-tauri/tauri.conf.json`),
);

function workflowStep(name: string): string {
  const marker = `      - name: ${name}\n`;
  const start = releaseWorkflow.indexOf(marker);
  if (start === -1) {
    throw new Error(`Release workflow is missing step: ${name}`);
  }
  const end = releaseWorkflow.indexOf("\n      - ", start + marker.length);
  return releaseWorkflow.slice(start, end === -1 ? undefined : end);
}

function actionReferences(source: string): string[] {
  return [
    ...source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#.*)?$/gm),
  ].map((match) => match[1]);
}

function workflowSteps(source: string): string[] {
  const lines = source.split("\n");
  const starts = lines.flatMap((line, index) => {
    const match = line.match(/^(\s*)-\s+(?:name|uses|run|id|if):/);
    return match ? [{ index, indentation: match[1].length }] : [];
  });

  return starts.map(({ index, indentation }) => {
    const end = starts.find(
      (candidate) =>
        candidate.index > index && candidate.indentation === indentation,
    )?.index;
    return lines.slice(index, end).join("\n");
  });
}

function permissionDeclarations(source: string): string[][] {
  const lines = source.split("\n");
  return lines.flatMap((line, index) => {
    const match = line.match(/^(\s*)permissions:\s*(.*)$/);
    if (!match) return [];

    if (match[2]) return [[match[2]]];

    const indentation = match[1].length;
    const end = lines.findIndex((candidate, candidateIndex) =>
      candidateIndex > index && candidate.trim() !== "" &&
      (candidate.match(/^\s*/)?.[0].length ?? 0) <= indentation
    );
    return [[
      ...lines.slice(index + 1, end === -1 ? undefined : end)
        .filter((candidate) => candidate.trim() !== "")
        .map((candidate) => candidate.trim()),
    ]];
  });
}

describe("release workflow contract", () => {
  it("pins every external action in every workflow to a full commit SHA", () => {
    for (const workflow of workflowFiles) {
      for (const reference of actionReferences(workflow.source)) {
        expect(reference, `${workflow.name}: ${reference}`).toMatch(
          /^[^@]+@[0-9a-f]{40}$/,
        );
      }
    }
  });

  it("disables persisted checkout credentials in every workflow", () => {
    for (const workflow of workflowFiles) {
      const checkoutSteps = workflowSteps(workflow.source).filter((step) =>
        /uses:\s*actions\/checkout@/.test(step)
      );
      expect(checkoutSteps, `${workflow.name} checkout steps`).not.toHaveLength(
        0,
      );
      for (const step of checkoutSteps) {
        expect(step, `${workflow.name} checkout step`).toMatch(
          /persist-credentials:\s*false/,
        );
      }
    }
  });

  it("keeps non-release workflows read-only and release writes draft-only", () => {
    for (const workflow of workflowFiles) {
      const permissions = permissionDeclarations(workflow.source);
      if (workflow.name === "release.yml") {
        expect(permissions).toEqual([["contents: write"]]);
        expect(workflow.source).toContain("releaseDraft: true");
        expect(workflow.source).not.toContain("releaseDraft: false");
      } else {
        expect(permissions, `${workflow.name} permissions`).toEqual([
          ["contents: read"],
        ]);
        expect(workflow.source).not.toMatch(
          /tagName:|releaseName:|releaseDraft:|GITHUB_TOKEN/,
        );
      }
    }
  });

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

  it("prebuilds the locked verifier before the secret-bearing release action", () => {
    const prebuild = workflowStep("Build locked updater verifier");
    expect(prebuild).toContain("cargo build");
    expect(prebuild).toContain("--locked");
    expect(prebuild).toContain(
      "--manifest-path scripts/updater-signature-verifier/Cargo.toml",
    );
    expect(prebuild).toContain("GITHUB_OUTPUT");
    expect(releaseWorkflow.indexOf(prebuild)).toBeLessThan(
      releaseWorkflow.indexOf("tauri-apps/tauri-action@"),
    );
  });

  it("limits the token-bearing step to downloading fixed draft inputs", () => {
    const download = workflowStep("Download draft release verification inputs");
    expect(download).toContain("GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
    expect(download).toContain("gh api");
    expect(download).toContain("GITHUB_OUTPUT");
    expect(download).not.toMatch(/\b(?:cargo|deno)\b/);
  });

  it("cryptographically verifies the downloaded updater archive offline", () => {
    const verification = workflowStep(
      "Verify downloaded draft release and updater manifest",
    );
    expect(verification).toContain("scripts/verify-release-draft.ts");
    expect(verification).toContain("UPDATER_VERIFIER_BINARY");
    expect(verification).not.toMatch(/\bcargo\s+run\b/);
    expect(verification).not.toMatch(/\b(?:GH_TOKEN|GITHUB_TOKEN)\b/);
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
