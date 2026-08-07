import { describe, expect, it } from "vitest";
import {
  parseWorkflowYaml,
  workflowPolicyViolations,
  workflowPropertyValues,
  type WorkflowRecord,
  workflowSteps,
  workflowUses,
} from "./workflow-policy.ts";

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
const releaseDocument = parseWorkflowYaml(releaseWorkflow);
const mergeDocument = parseWorkflowYaml(mergeWorkflow);
const tauriConfig = JSON.parse(
  await Deno.readTextFile(`${root}apps/desktop/src-tauri/tauri.conf.json`),
);

function workflowStep(name: string): WorkflowRecord {
  const matches = workflowSteps(releaseDocument).filter((step) =>
    step.name === name
  );
  if (matches.length !== 1) {
    throw new Error(`Release workflow is missing step: ${name}`);
  }
  return matches[0];
}

function stringField(record: WorkflowRecord, field: string): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw new Error(`Workflow field ${field} must be a string.`);
  }
  return value;
}

function recordField(record: WorkflowRecord, field: string): WorkflowRecord {
  const value = record[field];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Workflow field ${field} must be a mapping.`);
  }
  return value as WorkflowRecord;
}

function actionSteps(document: WorkflowRecord, ownerAndRepo: string) {
  return workflowSteps(document).filter((step) =>
    typeof step.uses === "string" && step.uses.startsWith(`${ownerAndRepo}@`)
  );
}

function assertNoProperty(document: WorkflowRecord, property: string): void {
  expect(workflowPropertyValues(document, property), property).toEqual([]);
}

describe("release workflow contract", () => {
  it("enforces structural action, checkout, and permission policy", () => {
    for (const workflow of workflowFiles) {
      expect(
        workflowPolicyViolations(workflow.name, workflow.source),
        workflow.name,
      ).toEqual([]);
    }
  });

  it("checks out source without persisting credentials in every workflow", () => {
    for (const workflow of workflowFiles) {
      const document = parseWorkflowYaml(workflow.source);
      const checkoutSteps = actionSteps(document, "actions/checkout");
      expect(checkoutSteps, `${workflow.name} checkout steps`).not.toHaveLength(
        0,
      );
      for (const step of checkoutSteps) {
        expect(recordField(step, "with")["persist-credentials"]).toBe(false);
      }
    }
  });

  it("resolves every parsed uses node to a supported immutable reference", () => {
    for (const workflow of workflowFiles) {
      expect(workflowUses(parseWorkflowYaml(workflow.source)).length).toBe(
        workflowPropertyValues(parseWorkflowYaml(workflow.source), "uses")
          .length,
      );
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
      "tauri-apps/tauri-action@1deb371b0cd8bd54025b384f1cd735e725c4060f # v1",
    );
  });

  it("isolates the release build from shared Rust build-output caches", () => {
    expect(actionSteps(releaseDocument, "swatinem/rust-cache")).toHaveLength(0);
    expect(actionSteps(mergeDocument, "swatinem/rust-cache")).toHaveLength(1);
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
    expect(workflowPropertyValues(releaseDocument, "permissions")).toEqual([
      { contents: "write" },
    ]);
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
    const run = stringField(prebuild, "run");
    expect(run).toContain("cargo build");
    expect(run).toContain("--locked");
    expect(run).toContain(
      "--manifest-path scripts/updater-signature-verifier/Cargo.toml",
    );
    expect(run).toContain("GITHUB_OUTPUT");
    expect(workflowSteps(releaseDocument).indexOf(prebuild)).toBeLessThan(
      workflowSteps(releaseDocument).findIndex((step) =>
        typeof step.uses === "string" &&
        step.uses.startsWith("tauri-apps/tauri-action@")
      ),
    );
  });

  it("limits the token-bearing step to downloading fixed draft inputs", () => {
    const download = workflowStep("Download draft release verification inputs");
    const run = stringField(download, "run");
    expect(recordField(download, "env").GH_TOKEN).toBe(
      "${{ secrets.GITHUB_TOKEN }}",
    );
    expect(run).toContain("gh api");
    expect(run).toContain("GITHUB_OUTPUT");
    expect(run).not.toMatch(/\b(?:cargo|deno)\b/);
  });

  it("cryptographically verifies the downloaded updater archive offline", () => {
    const verification = workflowStep(
      "Verify downloaded draft release and updater manifest",
    );
    const run = stringField(verification, "run");
    const env = recordField(verification, "env");
    expect(run).toContain("scripts/verify-release-draft.ts");
    expect(run).toContain("UPDATER_VERIFIER_BINARY");
    expect(run).not.toMatch(/\bcargo\s+run\b/);
    expect(env).not.toHaveProperty("GH_TOKEN");
    expect(env).not.toHaveProperty("GITHUB_TOKEN");
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
    const platforms = workflowPropertyValues(mergeDocument, "platform");
    expect(platforms).toEqual(
      expect.arrayContaining([
        "macos-latest",
        "windows-latest",
        "ubuntu-22.04",
      ]),
    );
    const tauriSteps = actionSteps(mergeDocument, "tauri-apps/tauri-action");
    expect(tauriSteps).toHaveLength(1);
    const inputs = recordField(tauriSteps[0], "with");
    expect(inputs.uploadUpdaterJson).toBe(false);
    expect(inputs.uploadWorkflowArtifacts).toBe(false);
    assertNoProperty(mergeDocument, "tagName");
    assertNoProperty(mergeDocument, "releaseName");
    assertNoProperty(mergeDocument, "releaseDraft");
    assertNoProperty(mergeDocument, "GITHUB_TOKEN");
  });
});
