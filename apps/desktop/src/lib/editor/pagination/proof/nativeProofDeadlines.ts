/** Browser-safe deadline policy shared by the page and native host runner. */
export const AUTOMATED_NATIVE_PROOF_TIMEOUTS_MS = Object.freeze({
  windowsHostBuild: 360_000,
  originReadiness: 10_000,
  outerNativeHostProcess: 60_000,
  expandedPaginationPage: 120_000,
  expandedPaginationHost: 135_000,
  expandedPaginationOuter: 150_000,
});
