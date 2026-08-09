import { describe, expect, it } from "vitest";
import {
  parseWorkflowYaml,
  type WorkflowRecord,
  workflowSteps,
} from "./workflow-policy.ts";
import { AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS } from "../apps/desktop/src/lib/editor/pagination/proof/nativeProofDeadlines.ts";

const root = decodeURIComponent(new URL("../", import.meta.url).pathname);
const source = await Deno.readTextFile(`${root}.github/workflows/ci.yml`);
const runnerSource = await Deno.readTextFile(
  `${root}apps/desktop/src/lib/editor/pagination/proof/runNativeProof.ts`,
);
const phaseSource = await Deno.readTextFile(
  `${root}apps/desktop/src/lib/editor/pagination/proof/nativeProofPhases.ts`,
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
    ["pagination-native-macos", "macos-latest", 10],
    ["pagination-native-windows", "windows-latest", 15],
  ])(
    "runs the shared proof in the dedicated %s job",
    (name, runner, timeout) => {
      const job = nativeJob(name);
      expect(job["runs-on"]).toBe(runner);
      expect(job["timeout-minutes"]).toBe(timeout);
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
    },
  );

  it("keeps the Windows job above the bounded cold-build and retry envelope", () => {
    const windowsJobMs = Number(
      nativeJob("pagination-native-windows")["timeout-minutes"],
    ) * 60_000;
    const proofEnvelopeMs =
      AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS.windowsHostBuild +
      AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS.originReadiness * 3 +
      AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS.outerNativeHostProcess * 3 +
      AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS.expandedPaginationOuter;

    expect(proofEnvelopeMs).toBe(720_000);
    expect(windowsJobMs - proofEnvelopeMs).toBeGreaterThanOrEqual(180_000);
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

  it("reuses one Windows host build and runner lifecycle for native OS input", () => {
    const steps = workflowSteps({
      jobs: { windows: nativeJob("pagination-native-windows") },
    });
    const proofCommands = steps.map((step) => step.run).filter((run) =>
      typeof run === "string" && run.includes("runNativeProof.ts")
    );

    expect(proofCommands).toHaveLength(1);
    expect(source).not.toContain("runNativeManualProof.ts");
    expect(runnerSource.match(/await buildWindowsHost\(\)/g)).toHaveLength(1);
    expect(runnerSource).toContain("nativeManualProof.html");
    expect(runnerSource).toContain("nativeProofPhases(process.platform)");
    expect(phaseSource).toContain('mode: "windows-native-input"');
  });
});
