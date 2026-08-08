/**
 * Owns the outer runner lifecycle so native failures cannot bypass cleanup.
 * When both phases fail, neither diagnostic is discarded.
 */
export async function runProofLifecycle<T>(
  run: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  const outcome = await run().then(
    (value) => ({ status: "fulfilled" as const, value }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  );
  const cleanupOutcome = await cleanup().then(
    () => ({ status: "fulfilled" as const }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  );

  if (outcome.status === "rejected") {
    if (cleanupOutcome.status === "rejected") {
      throw new AggregateError(
        [outcome.error, cleanupOutcome.error],
        "Native proof run and cleanup both failed",
      );
    }
    throw outcome.error;
  }
  if (cleanupOutcome.status === "rejected") throw cleanupOutcome.error;
  return outcome.value;
}
