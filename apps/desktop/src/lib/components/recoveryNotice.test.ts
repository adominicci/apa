import { describe, expect, it } from "vitest";
import type { RecoveryOutcome } from "$lib/persist/importJournal";
import { recoveryNoticeFromOutcomes } from "./recoveryNotice";

function outcome(kind: RecoveryOutcome["kind"]): RecoveryOutcome {
  if (kind === "recovery-required") {
    return {
      kind,
      transactionId: "transaction-1",
      reason: "import/recovery-required",
    };
  }
  if (kind === "none") return { kind };
  return { kind, transactionId: "transaction-1" };
}

describe("recoveryNoticeFromOutcomes", () => {
  it("classifies one completed recovery without inventing a result", () => {
    expect(recoveryNoticeFromOutcomes([outcome("resumed")])).toBe("resumed");
    expect(recoveryNoticeFromOutcomes([outcome("rolled-back")])).toBe(
      "rolled-back",
    );
    expect(recoveryNoticeFromOutcomes([outcome("already-complete")])).toBe(
      null,
    );
  });

  it("uses a neutral notice for mixed recovery results", () => {
    expect(
      recoveryNoticeFromOutcomes([
        outcome("resumed"),
        outcome("rolled-back"),
      ]),
    ).toBe(null);
  });
});
