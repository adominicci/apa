import { check as tauriCheck, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  type ReleaseNotesStorage,
  savePendingReleaseNotes,
} from "$lib/update/releaseNotes";
import { persistence } from "$lib/persist/coordinator";

export interface UpdaterUpdate {
  version: string;
  body?: string;
  downloadAndInstall: Update["downloadAndInstall"];
}

export interface UpdaterDependencies {
  check(): Promise<UpdaterUpdate | null>;
  flushPending(): Promise<void>;
  relaunch(): Promise<void>;
  storage(): ReleaseNotesStorage | null;
}

const defaultDependencies: UpdaterDependencies = {
  check: tauriCheck,
  flushPending: () => persistence.flushPending(),
  relaunch,
  storage: () => {
    try {
      return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      return null;
    }
  },
};

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

export class UpdaterStore {
  status = $state<UpdaterStatus>("idle");
  /** Version offered by the manifest, shown in the banner. */
  version = $state<string | undefined>(undefined);
  /** Plain-text release notes offered by the signed updater manifest. */
  body = $state<string | undefined>(undefined);
  /** Download progress 0–100 (only meaningful while `downloading`). */
  progress = $state(0);

  #update: UpdaterUpdate | null = null;
  #total = 0;
  #downloaded = 0;
  #installEpoch = 0;
  #installedPendingRelaunch = false;
  #dependencies: UpdaterDependencies;

  constructor(dependencies: UpdaterDependencies = defaultDependencies) {
    this.#dependencies = dependencies;
  }

  /** Check once, typically at boot. Never throws. */
  async check(): Promise<void> {
    if (this.status === "downloading" || this.#installedPendingRelaunch) return;
    const installEpoch = this.#installEpoch;
    try {
      const update = await this.#dependencies.check();
      if (installEpoch !== this.#installEpoch) return;
      if (update) {
        this.#update = update;
        this.version = update.version;
        this.body = update.body;
        this.status = "available";
      }
    } catch (err) {
      // No published release yet (404), offline, or not in the Tauri runtime.
      console.error("No se pudo comprobar actualizaciones:", err);
    }
  }

  /** Download + install the pending update, then relaunch. Never throws. */
  async install(): Promise<void> {
    if (!this.#update || this.status === "downloading") return;
    const update = this.#update;
    this.#installEpoch += 1;
    this.status = "downloading";
    try {
      if (!this.#installedPendingRelaunch) {
        this.progress = 0;
        this.#total = 0;
        this.#downloaded = 0;
        await update.downloadAndInstall((e) => {
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
        this.#installedPendingRelaunch = true;
        this.progress = 100;
      }
      await this.#dependencies.flushPending();
      try {
        const storage = this.#dependencies.storage();
        if (storage) {
          savePendingReleaseNotes(storage, {
            version: update.version,
            body: update.body ?? "",
          });
        }
      } catch (err) {
        // Notes are best-effort; storage failure cannot strand an installed
        // update in the old process.
        console.error("No se pudieron guardar las notas de versión:", err);
      }
      await this.#dependencies.relaunch();
      this.#update = null;
      this.#installedPendingRelaunch = false;
      this.status = "idle";
    } catch (err) {
      console.error("No se pudo instalar la actualización:", err);
      this.status = "error";
    }
  }
}

export const updater = new UpdaterStore();
