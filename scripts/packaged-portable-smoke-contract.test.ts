import { describe, expect, it } from "vitest";

async function source(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

describe("packaged portable smoke build contract", () => {
  it("keeps the smoke feature and frontend bootstrap out of ordinary builds", async () => {
    const cargo = await source("apps/desktop/src-tauri/Cargo.toml");
    const page = await source("apps/desktop/src/routes/+page.svelte");
    const workflow = await source(".github/workflows/build-artifacts.yml");

    expect(cargo).toContain("packaged-portable-smoke = []");
    expect(page).toContain("VITE_TESINA_PACKAGED_PORTABLE_SMOKE");
    expect(workflow).toContain("deno task smoke:portable:packaged");
    expect(workflow).not.toMatch(
      /tauri-action[\s\S]{0,1200}packaged-portable-smoke/,
    );
  });

  it("uses a hidden uniquely identified non-updater app bundle", async () => {
    const config = JSON.parse(
      await source("apps/desktop/src-tauri/tauri.portable-smoke.conf.json"),
    );

    expect(config.productName).toBe("Tesina Portable Smoke");
    expect(config.identifier).toBe("app.tesina.desktop.portable-smoke");
    expect(config.app.windows).toEqual([
      expect.objectContaining({ label: "main", visible: false }),
    ]);
    expect(config.bundle).toMatchObject({
      createUpdaterArtifacts: false,
      targets: ["app"],
    });
  });

  it("declares one bounded runner as the root task", async () => {
    const deno = JSON.parse(await source("deno.json"));
    const runner = await source(
      "scripts/run-packaged-portable-export-smoke.ts",
    );

    expect(deno.tasks["smoke:portable:packaged"]).toContain(
      "run-packaged-portable-export-smoke.ts",
    );
    expect(runner).toContain("PACKAGED_SMOKE_TIMEOUT_MS");
    expect(runner).toContain("packagedSmokeBundleIdentifier");
    expect(runner).toContain("ownedProcessStatusWithin");
    expect(runner).toContain("terminateOwnedProcess");
    expect(runner).toContain("verifyPackagedPortableExport");
    expect(runner).toContain('stdout: "null"');
  });
});
