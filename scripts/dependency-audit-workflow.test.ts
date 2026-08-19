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

describe("dependency audit CI contract", () => {
  it("audits the frozen Deno dependency graph before repository checks", () => {
    const jobs = record(workflow.jobs, "jobs");
    const testJob = record(jobs.test, "job test");
    const commands = workflowSteps({ jobs: { test: testJob } }).map((step) =>
      step.run
    );

    const install = commands.indexOf("deno install --frozen");
    const audit = commands.indexOf("deno audit --frozen");
    const format = commands.indexOf("deno fmt --check");
    expect(install).toBeGreaterThan(-1);
    expect(audit).toBeGreaterThan(install);
    expect(format).toBeGreaterThan(audit);
  });
});
