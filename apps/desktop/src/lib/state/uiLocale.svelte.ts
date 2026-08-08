import { readJson, writeJsonAtomicQuiet } from "$lib/persist/atomic";
import { overwriteGetLocale } from "$lib/paraglide/runtime";
import {
  DEFAULT_DOCK,
  parseDock,
  type ToolbarDock,
} from "$lib/state/toolbarDock";

const SETTINGS_FILE = "settings.json";

export type UiLanguage = "es" | "en";
export type UiTheme = "system" | "light" | "dark";

/**
 * Backup UI/status cache (design §8). Authoritative folder/backup-set state
 * lives in the Rust-owned `backup-directory.json`; these fields only feed
 * status display and scheduling hints, and are never exported in archives.
 * All fields are optional so a pre-backup settings.json loads unchanged and
 * `setupCardDismissed` can persist before any configuration exists.
 */
export interface BackupUiSettings {
  configuredAt?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastSuccessContentDigest?: string;
  lastErrorCode?: string;
  /** Local calendar day (YYYY-MM-DD) of the last AUTOMATIC success. */
  lastAutoSuccessDay?: string;
  setupCardDismissed?: boolean;
}

interface AppSettings {
  schemaVersion: 1;
  uiLanguage?: UiLanguage;
  uiTheme?: UiTheme;
  /** Opcional: un settings.json previo a esta feature cae en DEFAULT_DOCK. */
  toolbarDock?: ToolbarDock;
  /** Additive (schema stays 1): absent means backup was never touched. */
  backup?: BackupUiSettings;
}

function sanitizeBackup(value: unknown): BackupUiSettings | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const out: BackupUiSettings = {};
  for (
    const key of [
      "configuredAt",
      "lastAttemptAt",
      "lastSuccessAt",
      "lastSuccessContentDigest",
      "lastErrorCode",
      "lastAutoSuccessDay",
    ] as const
  ) {
    if (typeof raw[key] === "string") out[key] = raw[key] as string;
  }
  if (typeof raw["setupCardDismissed"] === "boolean") {
    out.setupCardDismissed = raw["setupCardDismissed"];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

interface SettingsWriteAttempt {
  revision: number;
  promise: Promise<void>;
}

/**
 * Global app settings: UI-chrome language (Paraglide axis — deliberately
 * independent from each essay's document language), theme, toolbar dock, and
 * the backup status cache. One store owns $APPDATA/settings.json so the
 * fields never clobber each other.
 *
 * Writes use the same serialized requested/persisted revision discipline as
 * the shared library store (task 8.4): rapid updates coalesce onto one write
 * chain, `flushPending()` drains to the latest revision, and a failed write
 * is retried by the next persist or flush — so a close or updater restart
 * can never lose or reorder the latest successful-backup record.
 */
export class UiSettingsStore {
  current = $state<UiLanguage>("es");
  theme = $state<UiTheme>("system");
  dock = $state<ToolbarDock>(DEFAULT_DOCK);
  backup = $state<BackupUiSettings | undefined>(undefined);
  loaded = $state(false);
  #requestedRevision = 0;
  #persistedRevision = 0;
  #writeChain: Promise<void> = Promise.resolve();
  #activeWrite: SettingsWriteAttempt | null = null;
  #activeFlush: Promise<void> | null = null;
  #notifyPersistenceDirty: (() => void) | null = null;

  constructor() {
    overwriteGetLocale(() => this.current);
  }

  async load(): Promise<void> {
    try {
      const settings = await readJson<AppSettings>(SETTINGS_FILE);
      if (settings?.uiLanguage) this.current = settings.uiLanguage;
      if (settings?.uiTheme) this.theme = settings.uiTheme;
      this.dock = parseDock(settings?.toolbarDock);
      this.backup = sanitizeBackup(settings?.backup);
    } catch (err) {
      console.error("No se pudo cargar settings.json:", err);
    } finally {
      this.loaded = true;
    }
  }

  #snapshot(): AppSettings {
    return {
      schemaVersion: 1,
      uiLanguage: this.current,
      uiTheme: this.theme,
      toolbarDock: this.dock,
      ...(this.backup
        ? { backup: $state.snapshot(this.backup) as BackupUiSettings }
        : {}),
    };
  }

  #enqueue(revision: number): Promise<void> {
    if (this.#persistedRevision >= revision) return Promise.resolve();
    if (this.#activeWrite?.revision === revision) {
      return this.#activeWrite.promise;
    }
    const file = this.#snapshot();
    const write = this.#writeChain.catch(() => undefined).then(async () => {
      // Quiet write: settings/status caches are not content-library data and
      // must not feed the backup-eligibility activity signal (a backup-owned
      // status update would otherwise retrigger its own eligibility check).
      await writeJsonAtomicQuiet(SETTINGS_FILE, file);
      this.#persistedRevision = Math.max(this.#persistedRevision, revision);
    });
    const attempt = { revision, promise: write };
    this.#activeWrite = attempt;
    this.#writeChain = write;
    const clear = () => {
      if (this.#activeWrite === attempt) this.#activeWrite = null;
    };
    void write.then(clear, clear);
    return write;
  }

  #persist(): void {
    this.#requestedRevision += 1;
    this.#notifyPersistenceDirty?.();
    const revision = this.#requestedRevision;
    this.#enqueue(revision).catch((err) => {
      console.error("No se pudo guardar settings.json:", err);
    });
  }

  /** Connect this app-lifetime store to its coordinator registration. */
  setPersistenceDirtyNotifier(notify: (() => void) | null): void {
    this.#notifyPersistenceDirty = notify;
  }

  /** Persist the latest state after every already-started atomic write. */
  flushPending(): Promise<void> {
    if (this.#activeFlush) return this.#activeFlush;
    const active = this.#flushUntilCaughtUp();
    this.#activeFlush = active;
    const clear = () => {
      if (this.#activeFlush === active) this.#activeFlush = null;
    };
    void active.then(clear, clear);
    return active;
  }

  async #flushUntilCaughtUp(): Promise<void> {
    while (this.#persistedRevision < this.#requestedRevision) {
      const revision = this.#requestedRevision;
      await this.#enqueue(revision);
    }
  }

  set(language: UiLanguage): void {
    if (this.current === language) return;
    this.current = language;
    this.#persist();
  }

  setTheme(theme: UiTheme): void {
    if (this.theme === theme) return;
    this.theme = theme;
    this.#persist();
  }

  setDock(dock: ToolbarDock): void {
    if (this.dock === dock) return;
    this.dock = dock;
    this.#persist();
  }

  /** Merge a backup status update and persist it durably. */
  updateBackup(patch: Partial<BackupUiSettings>): void {
    this.backup = { ...this.backup, ...patch };
    this.#persist();
  }

  /** Drop the backup status cache (Turn off keeps only card preferences). */
  clearBackup(options?: { keepCardPreference?: boolean }): void {
    const dismissed = this.backup?.setupCardDismissed;
    this.backup = options?.keepCardPreference && dismissed !== undefined
      ? { setupCardDismissed: dismissed }
      : undefined;
    this.#persist();
  }

  /** Cycle light → dark → system → light (one button, three states). */
  cycleTheme(): void {
    const order: UiTheme[] = ["light", "dark", "system"];
    const next = order[(order.indexOf(this.theme) + 1) % order.length]!;
    this.setTheme(next);
  }
}

export const uiLocale = new UiSettingsStore();
