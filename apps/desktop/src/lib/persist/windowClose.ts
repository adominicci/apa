interface CloseRequestEvent {
  preventDefault(): void;
}

/**
 * How long the save barrier may run before the user is offered a way out.
 * A close button that can hang is a close button that does not work: the only
 * remaining exit is the task manager, which loses strictly more than quitting
 * does.
 */
export const SHUTDOWN_DEADLINE_MS = 8000;

export interface ShutdownDependencies {
  /** Saves everything and waits for exports/backups to reach a safe point. */
  flushPending(): Promise<void>;
  /** Ends the process. Used once the barrier has cleared. */
  exitApp(): Promise<void>;
  /** Asks the user to confirm an ordinary quit. */
  confirmQuit(): Promise<boolean>;
  /** Asks whether to quit anyway after the barrier failed or timed out. */
  confirmQuitWithoutSaving(error: unknown): Promise<boolean>;
  resumeAfterFailedShutdown?(): Promise<void>;
  onError(error: unknown): void;
  /** Injected so tests do not wait out the real deadline. */
  deadlineMs?: number;
  delay?: (ms: number) => Promise<void>;
}

export class ShutdownTimeout extends Error {
  constructor() {
    super("The save barrier did not finish before the shutdown deadline.");
    this.name = "ShutdownTimeout";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Quits after saving, and never leaves the user without an exit.
 *
 * The barrier is bounded: if saving fails or outlives the deadline, the user
 * is told and asked whether to quit anyway, instead of the window silently
 * refusing to close.
 */
export function createQuitRequest(
  dependencies: ShutdownDependencies,
): () => Promise<void> {
  const deadlineMs = dependencies.deadlineMs ?? SHUTDOWN_DEADLINE_MS;
  const delay = dependencies.delay ?? sleep;
  // Raised before the confirmation is awaited, not after: the close button can
  // be clicked twice faster than a dialog appears, and two stacked quit
  // confirmations would be the user's next bug report.
  let inFlight = false;

  return async () => {
    if (inFlight) return;
    inFlight = true;

    if (!await dependencies.confirmQuit()) {
      inFlight = false;
      return;
    }

    let failure: unknown;
    try {
      // `Promise.race` and not an abort: the flush owns real filesystem work
      // that cannot be cancelled midway without risking a partial write. The
      // deadline bounds the *waiting*, never the writing.
      const timeout = delay(deadlineMs).then(() => {
        throw new ShutdownTimeout();
      });
      await Promise.race([dependencies.flushPending(), timeout]);
      await dependencies.exitApp();
      return;
    } catch (error) {
      failure = error;
    }

    dependencies.onError(failure);
    if (await dependencies.confirmQuitWithoutSaving(failure)) {
      await dependencies.exitApp();
      return;
    }
    inFlight = false;
    await dependencies.resumeAfterFailedShutdown?.();
  };
}

export interface CloseRequestDependencies {
  /**
   * `"macos"` follows the Mac convention: the close button hides the window
   * and the app stays in the Dock. Every other host quits, which is what
   * Windows and Linux users expect from the same button.
   */
  hostOs: string;
  hideWindow(): Promise<void>;
  /**
   * The same quit request the Quit menu entry uses, so the two paths share
   * one in-flight guard and one confirmation.
   */
  quit(): Promise<void>;
  onError(error: unknown): void;
}

export function createCloseRequestHandler(
  dependencies: CloseRequestDependencies,
): (event: CloseRequestEvent) => Promise<void> {
  return async (event) => {
    // Prevented on every host: macOS hides instead of closing, and elsewhere
    // the confirmation has to be answered before anything is destroyed.
    event.preventDefault();
    if (dependencies.hostOs === "macos") {
      try {
        await dependencies.hideWindow();
      } catch (error) {
        dependencies.onError(error);
      }
      return;
    }
    await dependencies.quit();
  };
}
