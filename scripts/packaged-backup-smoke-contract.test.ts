import { describe, expect, it } from "vitest";

async function source(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

describe("packaged backup smoke build contract", () => {
  it("keeps the smoke flavor default-off and outside ordinary release builds", async () => {
    const [cargo, page, ci, release, capabilities] = await Promise.all([
      source("apps/desktop/src-tauri/Cargo.toml"),
      source("apps/desktop/src/routes/+page.svelte"),
      source(".github/workflows/ci.yml"),
      source(".github/workflows/release.yml"),
      source("apps/desktop/src-tauri/capabilities/default.json"),
    ]);

    expect(cargo).toContain(
      'packaged-backup-smoke = ["packaged-portable-smoke"]',
    );
    expect(cargo).not.toMatch(/^default\s*=.*packaged-backup-smoke/m);
    expect(page).toContain("VITE_TESINA_PACKAGED_BACKUP_SMOKE");
    expect(ci).toContain("deno task smoke:backup:packaged");
    expect(release).not.toContain("packaged-backup-smoke");
    expect(capabilities).not.toContain("packaged-backup-smoke");
  });

  it("does not broaden the shipping filesystem capability", async () => {
    const capability = JSON.parse(
      await source("apps/desktop/src-tauri/capabilities/default.json"),
    ) as { permissions: unknown[] };
    const serialized = JSON.stringify(capability.permissions);

    expect(serialized).not.toContain("allow-home");
    expect(serialized).not.toContain("allow-download");
    expect(serialized).not.toContain("allow-document");
    expect(serialized).not.toContain("persisted-scope");
    expect(serialized).not.toContain("$HOME");
    expect(serialized).toContain("$APPDATA/.tesina-native");
    expect(serialized).toContain("$APPCACHE/.tesina-native");
  });

  it("declares one four-phase bounded runner and independent verifier", async () => {
    const [deno, runner, verifier] = await Promise.all([
      source("deno.json").then((text) => JSON.parse(text)),
      source("scripts/run-packaged-backup-smoke.ts"),
      source("scripts/verify-packaged-backup-smoke.ts"),
    ]);

    expect(deno.tasks["smoke:backup:packaged"]).toContain(
      "run-packaged-backup-smoke.ts",
    );
    expect(runner).toContain("PACKAGED_BACKUP_PHASES");
    expect(runner).toContain("ownedProcessStatusWithin");
    expect(runner).toContain("terminateOwnedProcess");
    expect(runner).toContain("verifyPackagedBackupSmoke");
    expect(runner).toContain("verifyPackagedPortableExport");
    expect(verifier).toContain("requiredAssertionsByPhase");
  });

  it("runs the Windows package proof on the exact pull-request SHA", async () => {
    const ci = await source(".github/workflows/ci.yml");

    expect(ci).toMatch(
      /windows-packaged-backup-e2e:[\s\S]*runs-on: windows-latest/,
    );
    expect(ci).toMatch(
      /windows-packaged-backup-e2e:[\s\S]*timeout-minutes: 30/,
    );
    expect(ci).toMatch(
      /windows-packaged-backup-e2e:[\s\S]*ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/,
    );
    expect(ci).toMatch(
      /TESINA_PROOF_COMMIT_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/,
    );
    expect(ci).toMatch(
      /windows-packaged-backup-e2e:[\s\S]*swatinem\/rust-cache@6323deb102c322ba6fcbdcafc7e3dddab59af2b6/,
    );
  });
});
