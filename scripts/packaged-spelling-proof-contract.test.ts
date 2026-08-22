import { describe, expect, it } from "vitest";
import { parse } from "yaml";

async function source(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

describe("packaged spelling proof contract", () => {
  it("keeps the hidden proof bootstrap out of normal builds and releases", async () => {
    const [cargo, layout, page, lib, release] = await Promise.all([
      source("apps/desktop/src-tauri/Cargo.toml"),
      source("apps/desktop/src/routes/+layout.svelte"),
      source("apps/desktop/src/routes/+page.svelte"),
      source("apps/desktop/src-tauri/src/lib.rs"),
      source(".github/workflows/release.yml"),
    ]);

    expect(cargo).toContain("packaged-spelling-proof = []");
    expect(cargo).not.toMatch(/^default\s*=.*packaged-spelling-proof/m);
    expect(page).toContain("VITE_TESINA_PACKAGED_SPELLING_PROOF");
    expect(page).toContain("$lib/spelling/packagedProof");
    expect(page).not.toContain("$lib/state/library.svelte");
    expect(page).not.toContain("$lib/state/updater.svelte");
    expect(layout).toContain("VITE_TESINA_PACKAGED_SPELLING_PROOF");
    expect(layout).not.toContain("$lib/persist/coordinator");
    expect(layout).not.toContain("$lib/state/uiLocale.svelte");
    expect(lib).toMatch(
      /fn run_packaged_spelling_proof\(\)[\s\S]*spelling::proof::spelling_packaged_proof,/,
    );
    expect(lib).toMatch(
      /fn run_packaged_spelling_proof\(\)[\s\S]*tauri_plugin_process::init\(\)/,
    );
    const packagedRun = lib.match(
      /fn run_packaged_spelling_proof\(\)([\s\S]*?)\n}\n/,
    )?.[1] ?? "";
    expect(packagedRun).not.toContain("tauri_plugin_http");
    expect(packagedRun).not.toContain("tauri_plugin_updater");
    expect(packagedRun).not.toContain("BackupDirectoryCore");
    expect(release).not.toContain("packaged-spelling-proof");
  });

  it("uses a hidden distinct non-updater application identity", async () => {
    const config = JSON.parse(
      await source(
        "apps/desktop/src-tauri/tauri.spelling-proof.conf.json",
      ),
    );

    expect(config.productName).toBe("Tesina Spelling Proof");
    expect(config.identifier).toBe("app.tesina.desktop.spelling-proof");
    expect(config.app.windows).toEqual([
      expect.objectContaining({ label: "main", visible: false }),
    ]);
    expect(config.bundle.createUpdaterArtifacts).toBe(false);
    expect(config.app.security.capabilities).toEqual(["spelling-proof"]);
    expect(config.plugins.updater.endpoints).toEqual([]);

    const capability = JSON.parse(
      await source(
        "apps/desktop/src-tauri/capabilities/spelling-proof.json",
      ),
    );
    expect(capability.permissions).toEqual([
      "core:default",
      "process:allow-exit",
    ]);
  });

  it("publishes a complete report without replacing existing evidence", async () => {
    const proof = await source(
      "apps/desktop/src-tauri/src/spelling/proof.rs",
    );

    expect(proof).toContain("sync_all()");
    expect(proof).toContain("std::fs::hard_link");
    expect(proof).toContain("std::fs::remove_file");
  });

  it("builds proof-only DMG and NSIS artifacts only on explicit manual dispatch", async () => {
    const workflow = await source(".github/workflows/build-artifacts.yml");

    expect(() => parse(workflow)).not.toThrow();
    expect(workflow).toContain("packagedSpellingProof:");
    expect(workflow).toContain("type: boolean");
    expect(workflow).toMatch(
      /packaged-spelling-proof:\s+name:[\s\S]*if: github\.event_name == 'workflow_dispatch' && inputs\.packagedSpellingProof/,
    );
    expect(workflow).toContain('VITE_TESINA_PACKAGED_SPELLING_PROOF: "1"');
    expect(workflow).toContain("--features packaged-spelling-proof");
    expect(workflow).toContain("--target universal-apple-darwin");
    expect(workflow).toContain("--bundles dmg");
    expect(workflow).toContain("--bundles nsis");
    expect(workflow).toContain("tauri.spelling-proof.conf.json");
    expect(workflow).toContain("tesina-spelling-proof-macos-universal");
    expect(workflow).toContain("tesina-spelling-proof-windows-x64");
    expect(workflow).toContain(
      "target/universal-apple-darwin/release/bundle/dmg/*.dmg",
    );
    expect(workflow).toContain("target/release/bundle/nsis/*-setup.exe");
  });

  it("documents exact bounded manual output collection on both platforms", async () => {
    const runbook = await source(
      "docs/runbooks/packaged-spelling-proof.md",
    );

    expect(runbook).toContain("packagedSpellingProof=true");
    expect(runbook).toContain("TESINA_PACKAGED_SPELLING_PROOF_OUTPUT");
    expect(runbook).toContain(
      "/Applications/Tesina Spelling Proof.app/Contents/MacOS/tesina",
    );
    expect(runbook).toContain('"/D=$install"');
    expect(runbook).toContain("Get-Content $out");
    expect(runbook).toMatch(
      /does not complete OpenSpec task\s+7\.2 or 7\.3/,
    );
  });
});
