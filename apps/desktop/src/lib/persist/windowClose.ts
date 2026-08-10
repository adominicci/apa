interface CloseRequestEvent {
  preventDefault(): void;
}

interface CloseRequestDependencies {
  flushPending(): Promise<void>;
  destroy(): Promise<void>;
  resumeAfterFailedShutdown?(): Promise<void>;
  onError(error: unknown): void;
}

/**
 * Prevents Tauri's default close until persistence completes. `destroy()` is
 * used after the barrier so the approved close does not emit another close
 * request and recurse through this handler.
 */
export function createCloseRequestHandler(
  dependencies: CloseRequestDependencies,
): (event: CloseRequestEvent) => Promise<void> {
  let closing = false;

  return async (event) => {
    event.preventDefault();
    if (closing) return;
    closing = true;
    try {
      await dependencies.flushPending();
      await dependencies.destroy();
    } catch (error) {
      closing = false;
      await dependencies.resumeAfterFailedShutdown?.();
      dependencies.onError(error);
    }
  };
}
