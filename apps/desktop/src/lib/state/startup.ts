export interface StartupSafetyDeps {
  loadUiSettings(): Promise<void>;
  runRecovery(): Promise<void>;
}

/** Loads chrome settings before recovery can block normal startup. */
export async function runStartupSafetyPhase(
  deps: StartupSafetyDeps,
): Promise<void> {
  await deps.loadUiSettings();
  await deps.runRecovery();
}
