import type { RecoveryOutcome } from "$lib/persist/importJournal";

export type RecoveryNotice = "resumed" | "rolled-back" | null;

/**
 * Returns a specific notice only when every completed recovery agrees.
 * Already-complete, absent, and mixed results stay neutral.
 */
export function recoveryNoticeFromOutcomes(
  outcomes: RecoveryOutcome[],
): RecoveryNotice {
  const resumed = outcomes.some((outcome) => outcome.kind === "resumed");
  const rolledBack = outcomes.some((outcome) => outcome.kind === "rolled-back");
  if (resumed === rolledBack) return null;
  return resumed ? "resumed" : "rolled-back";
}
