import { parse } from "yaml";

export type WorkflowRecord = Record<string, unknown>;

const FULL_SHA_REFERENCE =
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?@[0-9a-fA-F]{40}$/;
const LOCAL_PATH_SEGMENT = /^[A-Za-z0-9_.-]+$/;

function isRecord(value: unknown): value is WorkflowRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function booleanInput(value: unknown, expected: boolean): boolean {
  return value === expected || value === String(expected);
}

function localReference(value: string): boolean {
  const segments = value.slice(2).split("/");
  return segments.length > 0 &&
    segments.every((segment) =>
      segment !== "" && segment !== "." && segment !== ".." &&
      LOCAL_PATH_SEGMENT.test(segment)
    );
}

function walkRecords(
  value: unknown,
  visitor: (record: WorkflowRecord, path: string) => void,
  path = "$",
  seen = new WeakSet<object>(),
): void {
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    value.forEach((item, index) =>
      walkRecords(item, visitor, `${path}[${index}]`, seen)
    );
    return;
  }
  if (!isRecord(value) || seen.has(value)) return;
  seen.add(value);
  visitor(value, path);
  for (const [key, child] of Object.entries(value)) {
    walkRecords(child, visitor, `${path}.${key}`, seen);
  }
}

function permissionValue(
  value: unknown,
  expected: "read" | "write",
): boolean {
  return isRecord(value) && Object.keys(value).length === 1 &&
    value.contents === expected;
}

function jobRecords(document: WorkflowRecord): WorkflowRecord[] {
  if (!isRecord(document.jobs)) return [];
  return Object.values(document.jobs).filter(isRecord);
}

export function parseWorkflowYaml(source: string): WorkflowRecord {
  const document = parse(source);
  if (!isRecord(document)) {
    throw new TypeError("workflow root must be a mapping");
  }
  return document;
}

export function workflowSteps(document: WorkflowRecord): WorkflowRecord[] {
  const steps: WorkflowRecord[] = [];
  walkRecords(document, (record) => {
    if (Array.isArray(record.steps)) {
      steps.push(...record.steps.filter(isRecord));
    }
  });
  return steps;
}

export function workflowUses(document: WorkflowRecord): string[] {
  const references: string[] = [];
  walkRecords(document, (record) => {
    if (typeof record.uses === "string") references.push(record.uses);
  });
  return references;
}

export function workflowPropertyValues(
  document: WorkflowRecord,
  property: string,
): unknown[] {
  const values: unknown[] = [];
  walkRecords(document, (record) => {
    if (property in record) values.push(record[property]);
  });
  return values;
}

export function workflowPolicyViolations(
  name: string,
  source: string,
): string[] {
  let document: WorkflowRecord;
  try {
    document = parseWorkflowYaml(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return [`${name}: invalid YAML (${detail})`];
  }

  const violations: string[] = [];
  const releaseWorkflow = name === "release.yml";

  walkRecords(document, (record, path) => {
    if (!("uses" in record)) return;
    if (typeof record.uses !== "string") {
      violations.push(`${name} ${path}.uses: uses must be a string`);
      return;
    }

    const reference = record.uses;
    if (reference.startsWith("./")) {
      if (!localReference(reference) || reference.includes("@")) {
        violations.push(
          `${name} ${path}.uses: unsupported local action reference ${reference}`,
        );
      }
      return;
    }
    if (!FULL_SHA_REFERENCE.test(reference)) {
      violations.push(
        `${name} ${path}.uses: unsupported action reference ${reference}; ` +
          "external actions and reusable workflows require a full 40-character commit SHA",
      );
      return;
    }

    if (reference.toLowerCase().startsWith("actions/checkout@")) {
      const inputs = record.with;
      if (
        !isRecord(inputs) ||
        !booleanInput(inputs["persist-credentials"], false)
      ) {
        violations.push(
          `${name} ${path}: checkout must set persist-credentials: false`,
        );
      }
    }
  });

  const jobs = jobRecords(document);
  if (releaseWorkflow) {
    if (
      document.permissions !== undefined &&
      !permissionValue(document.permissions, "read")
    ) {
      violations.push(
        `${name}: top-level permissions must be absent or contents: read`,
      );
    }

    const writeJobs = jobs.filter((job) =>
      permissionValue(job.permissions, "write")
    );
    if (writeJobs.length !== 1) {
      violations.push(
        `${name}: exactly one release job must declare contents: write`,
      );
    }
    for (const job of jobs) {
      if (
        job.permissions !== undefined &&
        !permissionValue(job.permissions, "read") &&
        !permissionValue(job.permissions, "write")
      ) {
        violations.push(
          `${name}: job permissions must be exactly contents: read or contents: write`,
        );
      }
    }

    const tauriReleaseSteps = workflowSteps(document).filter((step) =>
      typeof step.uses === "string" &&
      step.uses.toLowerCase().startsWith("tauri-apps/tauri-action@")
    );
    if (tauriReleaseSteps.length !== 1) {
      violations.push(
        `${name}: expected exactly one tauri-apps/tauri-action release step`,
      );
    } else {
      const inputs = tauriReleaseSteps[0].with;
      if (!isRecord(inputs) || !booleanInput(inputs.releaseDraft, true)) {
        violations.push(
          `${name}: tauri release step must set releaseDraft: true`,
        );
      }
    }
    if (
      writeJobs.length === 1 &&
      !workflowSteps(writeJobs[0]).some((step) =>
        typeof step.uses === "string" &&
        step.uses.toLowerCase().startsWith("tauri-apps/tauri-action@")
      )
    ) {
      violations.push(
        `${name}: contents: write and the tauri release action must be in the same job`,
      );
    }
  } else {
    if (!permissionValue(document.permissions, "read")) {
      violations.push(
        `${name}: top-level permissions must be exactly contents: read`,
      );
    }
    for (const job of jobs) {
      if (
        job.permissions !== undefined &&
        !permissionValue(job.permissions, "read")
      ) {
        violations.push(
          `${name}: non-release job permissions must be exactly contents: read`,
        );
      }
    }
  }

  return violations;
}
