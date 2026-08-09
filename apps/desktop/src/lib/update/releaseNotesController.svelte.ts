import { getContext, setContext } from "svelte";
import type { BundledReleaseNotes } from "./bundledReleaseNotes.ts";
import {
  clearPendingReleaseNotes,
  type PendingReleaseNotes,
  readPendingReleaseNotes,
  type ReleaseNotesStorage,
} from "./releaseNotes.ts";

export type ReleaseNotesPresentationKind = "automatic" | "manual";

export interface ReleaseNotesPresentation {
  kind: ReleaseNotesPresentationKind;
  version: string;
  body: string;
}

export interface ReleaseNotesControllerOptions {
  bundled: BundledReleaseNotes;
  getRuntimeVersion(): Promise<unknown>;
  getStorage(): ReleaseNotesStorage | null;
  unavailableBody(): string;
}

const RELEASE_NOTES_CONTROLLER = Symbol("tesina.releaseNotesController");

function validRuntimeVersion(value: unknown): value is string {
  return typeof value === "string" && value !== "" &&
    value.trim() === value;
}

export class ReleaseNotesController {
  installedVersion = $state("");
  presentation = $state<ReleaseNotesPresentation | null>(null);

  #runtimeResolved = $state(false);
  #uiReady = $state(false);
  #resolution: Promise<void> | null = null;
  #automaticChecked = false;
  #automaticDismissed = false;
  #automaticMarker: PendingReleaseNotes | null = null;

  readonly #bundled: BundledReleaseNotes;
  readonly #getRuntimeVersion: () => Promise<unknown>;
  readonly #getStorage: () => ReleaseNotesStorage | null;
  readonly #unavailableBody: () => string;

  constructor(options: ReleaseNotesControllerOptions) {
    this.#bundled = options.bundled;
    this.#getRuntimeVersion = options.getRuntimeVersion;
    this.#getStorage = options.getStorage;
    this.#unavailableBody = options.unavailableBody;
    this.installedVersion = options.bundled.version;
  }

  get resolutionPending(): boolean {
    return !this.#runtimeResolved || !this.#uiReady;
  }

  resolveRuntimeVersion(): Promise<void> {
    this.#resolution ??= this.#resolveRuntimeVersion();
    return this.#resolution;
  }

  setUiReady(ready: boolean): void {
    this.#uiReady = ready;
    this.#refreshPresentation();
    this.#openAutomaticNotesOnce();
  }

  openInstalledNotes(): void {
    this.presentation = this.#presentationFor("manual");
  }

  dismiss(): void {
    if (this.presentation?.kind === "automatic") {
      const storage = this.#storage();
      if (storage && this.#automaticMarker) {
        clearPendingReleaseNotes(storage, this.#automaticMarker);
      }
      this.#automaticDismissed = true;
    }

    this.#automaticMarker = null;
    this.presentation = null;
  }

  async #resolveRuntimeVersion(): Promise<void> {
    try {
      const runtimeVersion = await this.#getRuntimeVersion();
      if (validRuntimeVersion(runtimeVersion)) {
        this.installedVersion = runtimeVersion;
      }
    } catch {
      // The statically bundled package version remains the offline fallback.
    } finally {
      this.#runtimeResolved = true;
      this.#refreshPresentation();
      this.#openAutomaticNotesOnce();
    }
  }

  #presentationFor(
    kind: ReleaseNotesPresentationKind,
  ): ReleaseNotesPresentation {
    return {
      kind,
      version: this.installedVersion,
      body: this.installedVersion === this.#bundled.version
        ? this.#bundled.body
        : this.#unavailableBody(),
    };
  }

  #refreshPresentation(): void {
    if (this.presentation) {
      this.presentation = this.#presentationFor(this.presentation.kind);
    }
  }

  #openAutomaticNotesOnce(): void {
    if (
      this.resolutionPending || this.#automaticChecked ||
      this.#automaticDismissed
    ) return;

    this.#automaticChecked = true;
    const storage = this.#storage();
    if (!storage) return;

    const marker = readPendingReleaseNotes(storage);
    if (marker?.version !== this.installedVersion) return;

    this.#automaticMarker = marker;
    this.presentation = this.#presentationFor("automatic");
  }

  #storage(): ReleaseNotesStorage | null {
    try {
      return this.#getStorage();
    } catch {
      return null;
    }
  }
}

export function createReleaseNotesController(
  options: ReleaseNotesControllerOptions,
): ReleaseNotesController {
  return new ReleaseNotesController(options);
}

export function provideReleaseNotesController(
  controller: ReleaseNotesController,
): ReleaseNotesController {
  setContext(RELEASE_NOTES_CONTROLLER, controller);
  return controller;
}

export function useReleaseNotesController(): ReleaseNotesController {
  const controller = getContext<ReleaseNotesController>(
    RELEASE_NOTES_CONTROLLER,
  );
  if (!controller) {
    throw new Error("Release notes controller is unavailable outside layout.");
  }
  return controller;
}
