export const PENDING_RELEASE_NOTES_KEY = "tesina.pendingReleaseNotes";

export interface ReleaseNotesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PendingReleaseNotes {
  version: string;
  body: string;
}

export function savePendingReleaseNotes(
  storage: ReleaseNotesStorage,
  notes: PendingReleaseNotes,
): void {
  try {
    storage.setItem(PENDING_RELEASE_NOTES_KEY, JSON.stringify(notes));
  } catch {
    // Storage is best-effort. An installed update must still be allowed to
    // relaunch when web storage is unavailable.
  }
}

export function readPendingReleaseNotes(
  storage: ReleaseNotesStorage,
): PendingReleaseNotes | null {
  try {
    const raw = storage.getItem(PENDING_RELEASE_NOTES_KEY);
    if (raw === null) return null;

    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" && parsed !== null &&
      !Array.isArray(parsed) &&
      "version" in parsed && typeof parsed.version === "string" &&
      parsed.version.length > 0 && parsed.version.trim() === parsed.version &&
      "body" in parsed && typeof parsed.body === "string"
    ) {
      return { version: parsed.version, body: parsed.body };
    }

    storage.removeItem(PENDING_RELEASE_NOTES_KEY);
  } catch {
    try {
      storage.removeItem(PENDING_RELEASE_NOTES_KEY);
    } catch {
      // Reading release notes is never allowed to block startup.
    }
  }
  return null;
}

export function releaseNotesForVersion(
  storage: ReleaseNotesStorage,
  runningVersion: string,
  fallbackBody: string,
): PendingReleaseNotes | null {
  const pending = readPendingReleaseNotes(storage);
  if (pending?.version !== runningVersion) return null;
  return {
    version: pending.version,
    body: pending.body.trim() === "" ? fallbackBody : pending.body,
  };
}

export function clearPendingReleaseNotes(
  storage: ReleaseNotesStorage,
  displayed?: PendingReleaseNotes,
): void {
  try {
    if (displayed) {
      const pending = readPendingReleaseNotes(storage);
      if (pending?.version !== displayed.version) return;
    }
    storage.removeItem(PENDING_RELEASE_NOTES_KEY);
  } catch {
    // Dismissal remains non-blocking if web storage is unavailable.
  }
}
