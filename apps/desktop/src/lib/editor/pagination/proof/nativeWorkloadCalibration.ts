/**
 * Converts a measured line start into a deletion boundary that removes the
 * whole containing workload paragraph. This avoids repeatedly preserving the
 * schema-required terminal paragraph when calibration trims the final page.
 */
export function nativeWorkloadTrimPosition(
  cutoff: number,
  paragraphPositions: readonly number[],
): number {
  let trimFrom: number | undefined;
  for (const position of paragraphPositions) {
    if (
      position <= cutoff &&
      (trimFrom === undefined || position > trimFrom)
    ) {
      trimFrom = position;
    }
  }
  return trimFrom ?? cutoff;
}
