/** Fixed before Task 5 benchmarks; do not relax these limits to hide a run. */
export const PAGINATION_RESPONSIVENESS_BUDGET = Object.freeze({
  inputP95Ms: 16,
  inputMaxMs: 32,
  maxFramesPerPass: 2,
  maxPassesPerEpoch: 4,
  maxFramesPerEpoch: 8,
  workloads: Object.freeze({
    10: Object.freeze({
      typingDeletionMs: 750,
      referenceFontMs: 1_000,
      resizeMs: 250,
    }),
    25: Object.freeze({
      typingDeletionMs: 1_500,
      referenceFontMs: 2_000,
      resizeMs: 250,
    }),
    50: Object.freeze({
      typingDeletionMs: 3_000,
      referenceFontMs: 4_000,
      resizeMs: 250,
    }),
  }),
});
