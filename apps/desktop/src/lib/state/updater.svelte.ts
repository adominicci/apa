import { check as tauriCheck, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/**
 * In-app auto-update (Tauri updater plugin). On launch the app checks the
 * GitHub Releases updater manifest; if a newer *published* version exists, the
 * shell shows a banner and the user updates on one click. The essays live in
 * $APPDATA and are untouched by an in-place app update.
 *
 * Follows the app's store convention: one class holding `$state` fields, a
 * single exported singleton. Both `check` and `install` swallow their errors —
 * before the first published release the endpoint 404s and the plugin throws,
 * and outside the Tauri runtime the call throws too; either way the store must
 * stay `idle` and never surface an unhandled rejection.
 */
type UpdaterStatus = "idle" | "available" | "downloading" | "error";

class UpdaterStore {
  status = $state<UpdaterStatus>("idle");
  /** Version offered by the manifest, shown in the banner. */
  version = $state<string | undefined>(undefined);
  /** Download progress 0–100 (only meaningful while `downloading`). */
  progress = $state(0);

  #update: Update | null = null;
  #total = 0;
  #downloaded = 0;

  /** Check once, typically at boot. Never throws. */
  async check(): Promise<void> {
    try {
      const update = await tauriCheck();
      if (update) {
        this.#update = update;
        this.version = update.version;
        this.status = "available";
      }
    } catch (err) {
      // No published release yet (404), offline, or not in the Tauri runtime.
      console.error("No se pudo comprobar actualizaciones:", err);
    }
  }

  /** Download + install the pending update, then relaunch. Never throws. */
  async install(): Promise<void> {
    if (!this.#update) return;
    this.status = "downloading";
    this.progress = 0;
    this.#total = 0;
    this.#downloaded = 0;
    try {
      await this.#update.downloadAndInstall((e) => {
        switch (e.event) {
          case "Started":
            this.#total = e.data.contentLength ?? 0;
            break;
          case "Progress":
            this.#downloaded += e.data.chunkLength;
            if (this.#total > 0) {
              this.progress = Math.min(
                100,
                Math.round((this.#downloaded / this.#total) * 100),
              );
            }
            break;
          case "Finished":
            this.progress = 100;
            break;
        }
      });
      await relaunch();
    } catch (err) {
      console.error("No se pudo instalar la actualización:", err);
      this.status = "error";
    }
  }
}

export const updater = new UpdaterStore();
