import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { parse } from "yaml";

test("native spelling diagnostic reports the fixed proof contract on both hosted platforms", async () => {
  const workflow = await readFile(
    ".github/workflows/spelling-native-diagnostic.yml",
    "utf8",
  );

  expect(() => parse(workflow)).not.toThrow();
  expect(workflow).toContain("macos-latest");
  expect(workflow).toContain("macos-15-intel");
  expect(workflow).toContain("windows-latest");
  expect(workflow).toContain(
    "cargo test --locked spelling:: -- --nocapture",
  );
  expect(workflow).toContain("cargo run --locked --example spelling-proof");
  expect(workflow).toContain("spelling-proof-${{ matrix.platform }}.json");
  expect(workflow).toContain(
    "Hosted diagnostics do not replace packaged acceptance targets",
  );
  expect(workflow).toContain('TESINA_RUN_SPELLING_IPC: "1"');
  expect(workflow).toContain(
    "apps/desktop/src/lib/spelling/service.ipc.test.ts",
  );
  const dependencyInstall = workflow.indexOf(
    "Install TypeScript dependencies for the focused IPC contract",
  );
  const svelteSync = workflow.indexOf(
    "Sync SvelteKit configuration for the focused IPC contract",
  );
  const ipcTest = workflow.indexOf(
    "Run focused TypeScript-to-Tauri spelling IPC contract",
  );
  expect(dependencyInstall).toBeGreaterThan(-1);
  expect(svelteSync).toBeGreaterThan(dependencyInstall);
  expect(ipcTest).toBeGreaterThan(svelteSync);
  const cancellationRace = workflow.indexOf(
    "cancel_before_check_future_polling_is_preserved_until_admission",
  );
  const cancellationStep = workflow.indexOf(
    "Prove cancellation before command future polling",
  );
  const denoSetup = workflow.indexOf(
    "Install Deno for the focused IPC contract",
  );
  const featureTest = workflow.indexOf(
    "cargo test --locked --features spelling-ipc-test",
  );
  expect(featureTest).toBeGreaterThan(
    workflow.indexOf("Run focused native spelling tests"),
  );
  expect(cancellationRace).toBeGreaterThan(featureTest);
  expect(cancellationRace).toBeLessThan(dependencyInstall);
  expect(workflow.slice(cancellationStep, denoSetup)).toContain(
    "if: matrix.platform == 'macos-latest'",
  );
});
