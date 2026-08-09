export interface StableInspectionSettlement {
  requested: boolean;
  localPassed: boolean;
  resultAccepted: boolean;
  destroy: () => void;
  markReady: () => void;
}

/** Keeps a stable editor only when its passing result won the page lifecycle. */
export function settleStableInspectionEditor(
  settlement: StableInspectionSettlement,
): boolean {
  const preserve = settlement.requested && settlement.localPassed &&
    settlement.resultAccepted;
  if (preserve) settlement.markReady();
  else settlement.destroy();
  return preserve;
}
