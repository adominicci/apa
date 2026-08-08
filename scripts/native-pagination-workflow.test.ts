import { describe, expect, it } from "vitest";
import {
  parseWorkflowYaml,
  type WorkflowRecord,
  workflowSteps,
} from "./workflow-policy.ts";

const root = decodeURIComponent(new URL("../", import.meta.url).pathname);
const source = await Deno.readTextFile(`${root}.github/workflows/ci.yml`);
const runnerSource = await Deno.readTextFile(
  `${root}apps/desktop/src/lib/editor/pagination/proof/runNativeProof.ts`,
);
const processTestSource = await Deno.readTextFile(
  `${root}apps/desktop/src/lib/editor/pagination/proof/proofProcess.test.ts`,
);
const workflow = parseWorkflowYaml(source);

function record(value: unknown, label: string): WorkflowRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value as WorkflowRecord;
}

function nativeJob(name: string): WorkflowRecord {
  return record(record(workflow.jobs, "jobs")[name], `job ${name}`);
}

describe("native pagination CI contract", () => {
  it.each([
    ["pagination-native-macos", "macos-latest"],
    ["pagination-native-windows", "windows-latest"],
  ])("runs the shared proof in the dedicated %s job", (name, runner) => {
    const job = nativeJob(name);
    expect(job["runs-on"]).toBe(runner);
    expect(job["timeout-minutes"]).toBe(10);
    const steps = workflowSteps({ jobs: { [name]: job } });
    const commands = steps.map((step) => step.run).filter((run) =>
      typeof run === "string"
    ).join("\n");
    expect(commands).toContain(
      "vitest run apps/desktop/src/lib/editor/pagination",
    );
    expect(commands).toContain(
      "apps/desktop/src/lib/editor/pagination/proof/runNativeProof.ts",
    );
    expect(commands).not.toMatch(/playwright|chromium|browser bundle/i);
  });

  it.each([
    "pagination-native-macos",
    "pagination-native-windows",
  ])("runs Svelte generation and checking before Vitest in %s", (name) => {
    const steps = workflowSteps({ jobs: { [name]: nativeJob(name) } });
    const svelteCheckIndex = steps.findIndex((step) =>
      step.run === "deno task check"
    );
    const focusedSuiteIndex = steps.findIndex((step) =>
      typeof step.run === "string" &&
      step.run.includes("vitest run apps/desktop/src/lib/editor/pagination")
    );

    expect(svelteCheckIndex).toBeGreaterThan(-1);
    expect(focusedSuiteIndex).toBeGreaterThan(svelteCheckIndex);
  });

  it("installs locked Rust for the direct WebView2 host only", () => {
    const macSteps = workflowSteps({
      jobs: { mac: nativeJob("pagination-native-macos") },
    });
    const windowsSteps = workflowSteps({
      jobs: { windows: nativeJob("pagination-native-windows") },
    });
    expect(macSteps.some((step) =>
      typeof step.uses === "string" &&
      step.uses.startsWith("dtolnay/rust-toolchain@")
    )).toBe(false);
    expect(windowsSteps.some((step) =>
      typeof step.uses === "string" &&
      step.uses.startsWith("dtolnay/rust-toolchain@")
    )).toBe(true);
    expect(runnerSource).toContain('"cargo"');
    expect(runnerSource).toContain('"build"');
    expect(runnerSource).toContain('"--locked"');
  });

  it("runs a real descendant-termination regression on Windows", () => {
    expect(processTestSource).toContain(
      'it(\n    "settles at the deadline and kills descendants that retain its pipes"',
    );
    expect(processTestSource).not.toContain(
      'it.runIf(process.platform !== "win32")(\n    "settles at the deadline and kills descendants that retain its pipes"',
    );
  });
});
