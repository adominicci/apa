import {
  createQuitRequest,
  type ShutdownDependencies,
} from "$lib/persist/windowClose";

/**
 * One quit request for the whole app.
 *
 * The native close button and the Quit entry in Settings both route here, so
 * they share a single in-flight guard: whichever arrives first owns the
 * shutdown, and the second is ignored rather than stacking a second
 * confirmation.
 *
 * Configured once by the root layout, and only under Tauri — in a plain
 * browser there is no process to end, so `available` stays false and the Quit
 * entry is not rendered.
 */
class Shutdown {
  #quit: (() => Promise<void>) | null = $state(null);

  configure(dependencies: ShutdownDependencies): void {
    this.#quit = createQuitRequest(dependencies);
  }

  get available(): boolean {
    return this.#quit !== null;
  }

  async request(): Promise<void> {
    await this.#quit?.();
  }
}

export const shutdown = new Shutdown();
