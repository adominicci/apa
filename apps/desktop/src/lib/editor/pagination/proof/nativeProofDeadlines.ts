/** Browser-safe deadline policy shared by the page and native host runner. */
export const AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS = Object.freeze({
  windowsHostBuild: 360_000,
  originReadiness: 10_000,
  outerNativeHostProcess: 60_000,
  expandedPaginationPage: 120_000,
  expandedPaginationHost: 135_000,
  expandedPaginationOuter: 150_000,
});

export const NATIVE_EXPANDED_PROOF_BUDGET_MS = Object.freeze({
  workloadSetupPerFixture: 10_000,
  legacyAndParityHeadroom: 55_000,
});

export function nativeExpandedProofDeclaredCeilingMs(
  operationCeilingMs: number,
  workloadCount: number,
): number {
  return operationCeilingMs +
    NATIVE_EXPANDED_PROOF_BUDGET_MS.workloadSetupPerFixture * workloadCount +
    NATIVE_EXPANDED_PROOF_BUDGET_MS.legacyAndParityHeadroom;
}
