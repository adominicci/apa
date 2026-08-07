import { describe, expect, it } from "vitest";
import { workflowPolicyViolations } from "./workflow-policy.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function expectAccepted(name: string, source: string): void {
  expect(workflowPolicyViolations(name, source)).toEqual([]);
}

function expectRejected(name: string, source: string, message: string): void {
  expect(workflowPolicyViolations(name, source)).toEqual(
    expect.arrayContaining([expect.stringContaining(message)]),
  );
}

describe("workflow policy", () => {
  it.each([
    [
      "block scalar",
      `
permissions:
  contents: read
jobs:
  test:
    steps:
      - uses: owner/action@${SHA}
`,
    ],
    [
      "single-quoted scalar",
      `
permissions: { contents: read }
jobs:
  test:
    steps:
      - uses: 'owner/action@${SHA}'
`,
    ],
    [
      "double-quoted scalar",
      `
permissions: { contents: read }
jobs:
  test:
    steps:
      - uses: "owner/action@${SHA}"
`,
    ],
    [
      "flow-style collection",
      `
permissions: { contents: read }
jobs: { test: { steps: [ { uses: "owner/action@${SHA}" } ] } }
`,
    ],
  ])("accepts pinned actions written as a %s", (_label, source) => {
    expectAccepted("ci.yml", source);
  });

  it("accepts real local actions and rejects a fake SHA suffix", () => {
    expectAccepted(
      "ci.yml",
      `
permissions: { contents: read }
jobs:
  test:
    steps:
      - uses: ./.github/actions/setup
`,
    );
    expectRejected(
      "ci.yml",
      `
permissions: { contents: read }
jobs:
  test:
    steps:
      - uses: ./.github/actions/setup@${SHA}
`,
      "unsupported local action reference",
    );
    expectRejected(
      "ci.yml",
      `
permissions: { contents: read }
jobs:
  test:
    steps:
      - uses: ./../outside-the-repository
`,
      "unsupported local action reference",
    );
  });

  it("requires external reusable workflows to use full commit SHAs", () => {
    expectAccepted(
      "ci.yml",
      `
permissions: { contents: read }
jobs:
  delegated:
    uses: owner/repository/.github/workflows/reusable.yml@${SHA}
`,
    );
    expectRejected(
      "ci.yml",
      `
permissions: { contents: read }
jobs:
  delegated:
    uses: owner/repository/.github/workflows/reusable.yml@main
`,
      "full 40-character commit SHA",
    );
  });

  it.each([
    ["empty", `owner/repository//evil@${SHA}`],
    ["current-directory", `owner/repository/.@${SHA}`],
    ["parent-directory", `owner/repository/../evil@${SHA}`],
  ])("rejects an external reference with a %s path segment", (
    _label,
    reference,
  ) => {
    expectRejected(
      "ci.yml",
      `
permissions: { contents: read }
jobs: { test: { steps: [ { uses: "${reference}" } ] } }
`,
      "unsupported action reference",
    );
  });

  it("finds a flow-style checkout hidden inside a nested collection", () => {
    expectRejected(
      "ci.yml",
      `
permissions: { contents: read }
jobs: { test: { steps: [ { name: hidden, meta: { wrapper: true }, uses: "actions/checkout@${SHA}", with: { fetch-depth: 0 } } ] } }
`,
      "persist-credentials: false",
    );
    expectAccepted(
      "ci.yml",
      `
permissions: { contents: read }
jobs: { test: { steps: [ { uses: "actions/checkout@${SHA}", with: { persist-credentials: "false" } } ] } }
      `,
    );
    expectRejected(
      "ci.yml",
      `
permissions: { contents: read }
jobs: { test: { steps: [ { uses: "Actions/Checkout@${SHA}" } ] } }
`,
      "persist-credentials: false",
    );
  });

  it.each([
    ["missing ref", "owner/action"],
    ["mutable tag", "owner/action@v4"],
    ["mutable branch", "owner/action@main"],
    ["container action", "docker://alpine:3.22"],
    ["expression", "${{ matrix.action }}"],
  ])("fails closed for an unsupported %s", (_label, reference) => {
    expectRejected(
      "ci.yml",
      `
permissions: { contents: read }
jobs: { test: { steps: [ { uses: "${reference}" } ] } }
`,
      "unsupported action reference",
    );
  });

  it("rejects malformed YAML and non-string uses values", () => {
    expectRejected(
      "ci.yml",
      "permissions: { contents: read\njobs: {}",
      "invalid YAML",
    );
    expectRejected(
      "ci.yml",
      `
permissions: { contents: read }
jobs: { test: { steps: [ { uses: [owner, action] } ] } }
`,
      "uses must be a string",
    );
  });

  it("allows contents write only for a draft release action", () => {
    expectAccepted(
      "release.yml",
      `
jobs:
  release:
    permissions: { contents: write }
    steps:
      - uses: tauri-apps/tauri-action@${SHA}
        with: { releaseDraft: true }
`,
    );
    expectRejected(
      "release.yml",
      `
jobs:
  release:
    permissions: { contents: write }
    steps:
      - uses: tauri-apps/tauri-action@${SHA}
        with: { releaseDraft: false }
`,
      "releaseDraft: true",
    );
    expectRejected(
      "ci.yml",
      `
permissions: { contents: write }
jobs: {}
`,
      "contents: read",
    );
    expectRejected(
      "release.yml",
      `
jobs:
  privileged:
    permissions: { contents: write }
    steps:
      - uses: owner/action@${SHA}
  publish:
    steps:
      - uses: tauri-apps/tauri-action@${SHA}
        with: { releaseDraft: true }
`,
      "same job",
    );
  });

  it("does not treat matrix data as executable release steps", () => {
    expectRejected(
      "release.yml",
      `
jobs:
  release:
    permissions: { contents: write }
    strategy:
      matrix:
        include:
          - steps:
              - uses: tauri-apps/tauri-action@${SHA}
                with: { releaseDraft: true }
    steps:
      - uses: owner/action@${SHA}
`,
      "expected exactly one tauri-apps/tauri-action release step",
    );
  });

  it("still audits action references hidden outside executable steps", () => {
    expectRejected(
      "ci.yml",
      `
permissions: { contents: read }
jobs:
  test:
    strategy:
      matrix:
        include:
          - metadata:
              uses: owner/action@main
    steps: []
`,
      "full 40-character commit SHA",
    );
  });
});
