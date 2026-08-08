export interface ProofPageWatchdog {
  cancel(): void;
}

export function startProofPageWatchdog(
  timeoutMs: number,
  onTimeout: () => void,
): ProofPageWatchdog {
  let settled = false;
  const deadline = setTimeout(() => {
    if (settled) return;
    settled = true;
    onTimeout();
  }, timeoutMs);
  return {
    cancel() {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
    },
  };
}
