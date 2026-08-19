import { describe, expect, it } from "vitest";
import {
  parseWorkflowYaml,
  type WorkflowRecord,
  workflowSteps,
} from "./workflow-policy.ts";

const source = await Deno.readTextFile(
  new URL("../.github/workflows/ci.yml", import.meta.url),
);
const workflow = parseWorkflowYaml(source);

function record(value: unknown, label: string): WorkflowRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value as WorkflowRecord;
}

describe("Rust CI contract", () => {
  it("does not schedule Linux-native Rust checks", () => {
    const jobs = record(workflow.jobs, "jobs");
    expect(jobs).not.toHaveProperty("rust");

    const nativeJobs = [
      record(jobs["pagination-native-macos"], "macOS native job"),
      record(jobs["pagination-native-windows"], "Windows native job"),
    ];
    const macCommands = workflowSteps({ jobs: { native: nativeJobs[0] } })
      .map((step) => step.run)
      .filter((run): run is string => typeof run === "string");
    expect(macCommands).toContain("cargo fmt --check");
    expect(macCommands).toContain("cargo check --locked");
    expect(macCommands).toContain("cargo test --locked");

    const windowsCommands = workflowSteps({ jobs: { native: nativeJobs[1] } })
      .map((step) => step.run)
      .filter((run): run is string => typeof run === "string");
    expect(windowsCommands).toContain("cargo check --locked --lib");
    expect(windowsCommands).toContain("cargo test --locked --lib");

    expect(source).not.toMatch(/runs-on:\s*ubuntu-/);
    expect(source).not.toContain("Install Linux system dependencies");
  });
});
