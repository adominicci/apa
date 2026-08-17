import { describe, expect, it } from "vitest";
import type { ApaCheckIssue } from "@tesina/engine";
import { localizeApaCheck } from "./apaCheckMessages.ts";

const issue = (rule: ApaCheckIssue["rule"]): ApaCheckIssue => ({
  rule,
  path: [0, 0],
});

describe("localizeApaCheck", () => {
  it("gives every rule its own non-empty label", () => {
    const labels = [
      "empty-paragraph",
      "skipped-heading-level",
      "empty-table-title",
      "empty-figure-title",
    ].map((rule) => localizeApaCheck(issue(rule as ApaCheckIssue["rule"])));
    for (const label of labels) expect(label).not.toBe("");
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("names both heading levels in a skipped-heading label", () => {
    const label = localizeApaCheck({
      rule: "skipped-heading-level",
      path: [0, 1],
      found: 3,
      allowed: 2,
    });
    expect(label).toContain("3");
    expect(label).toContain("2");
  });
});
