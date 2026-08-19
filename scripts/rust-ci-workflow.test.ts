import { describe, expect, it } from "vitest";
import {
  parseWorkflowYaml,
  type WorkflowRecord,
  workflowSteps,
} from "./workflow-policy.ts";

const root = decodeURIComponent(new URL("../", import.meta.url).pathname);
const source = await Deno.readTextFile(`${root}.github/workflows/ci.yml`);
const workflow = parseWorkflowYaml(source);

function record(value: unknown, label: string): WorkflowRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value as WorkflowRecord;
}

function rustJob(): WorkflowRecord {
  return record(record(workflow.jobs, "jobs").rust, "job rust");
}

describe("Rust CI contract", () => {
  it("checks the locked Tauri crate on Linux without building installers", () => {
    const job = rustJob();
    expect(job["runs-on"]).toBe("ubuntu-22.04");
    expect(job["timeout-minutes"]).toBe(45);

    const steps = workflowSteps({ jobs: { rust: job } });
    expect(steps.some((step) =>
      typeof step.uses === "string" &&
      step.uses.startsWith("dtolnay/rust-toolchain@")
    )).toBe(true);
    expect(steps.some((step) =>
      typeof step.uses === "string" &&
      step.uses.startsWith("swatinem/rust-cache@")
    )).toBe(true);

    const systemDependencies = steps.find((step) =>
      step.name === "Install Linux system dependencies"
    );
    expect(systemDependencies?.run).toContain("libwebkit2gtk-4.1-dev");

    const cargoSteps = steps.filter((step) =>
      typeof step.run === "string" && step.run.startsWith("cargo ")
    );
    expect(cargoSteps.map((step) => step.run)).toEqual([
      "cargo fmt --check",
      "cargo check --locked",
      "cargo test --locked",
    ]);
    expect(
      cargoSteps.every((step) =>
        step["working-directory"] === "apps/desktop/src-tauri"
      ),
    ).toBe(true);

    expect(steps.some((step) =>
      typeof step.uses === "string" &&
      step.uses.startsWith("tauri-apps/tauri-action@")
    )).toBe(false);
    const commands = steps.map((step) => step.run).filter((run) =>
      typeof run === "string"
    ).join("\n");
    expect(commands).not.toMatch(/\btauri(?:\s+|:).*build\b/i);
  });
});
