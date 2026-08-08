/**
 * Pure contracts for the `.tesina` portable library archive (design §1/§3).
 * This module must stay free of Svelte, runes, Tauri, and filesystem paths.
 */

import type { Reference } from "@tesina/engine";
import type { Essay } from "$lib/model/essay";
import type { RefCollection } from "$lib/model/collections";

/** On-disk shape of `$APPDATA/library.json` (schema version 1). */
export interface SharedLibraryFile {
  schemaVersion: 1;
  references: Reference[];
  collections?: RefCollection[];
}

export interface ArchiveFileRecord {
  /** Archive-relative entry path (`library.json`, `essays/...`, `assets/...`). */
  path: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
}

export interface LibraryArchiveManifestV1 {
  kind: "tesina-library";
  formatVersion: 1;
  createdAt: string;
  appVersion: string;
  /** Version one is always unencrypted; the field documents that fact. */
  encryption: null;
  /** Present only when the archive belongs to a configured backup set. */
  backup?: {
    backupSetId: string;
  };
  counts: {
    essays: number;
    references: number;
    collections: number;
    assets: number;
  };
  /** Describes every entry except `manifest.json` itself. */
  files: ArchiveFileRecord[];
}

/**
 * Immutable captured library content with asset bytes keyed by their local
 * `essays/assets/...` relative path (pre-normalization).
 */
export interface LibrarySnapshotContent {
  essays: Essay[];
  library: SharedLibraryFile;
  assets: ReadonlyMap<string, Uint8Array>;
}

/**
 * Assembled, normalized archive content: essays carry `assets/...` figure
 * paths and the asset map is keyed by archive path.
 */
export interface ArchiveContent {
  essays: Essay[];
  library: SharedLibraryFile;
  assets: ReadonlyMap<string, Uint8Array>;
}

export interface ArchiveBuildDeps {
  /** Injected clock; returns an ISO timestamp for `createdAt`. */
  now: () => string;
  appVersion: string;
  /** Marks the archive as part of this installation's backup set. */
  backupSetId?: string;
}

export class ArchiveError extends Error {
  readonly code: string;
  readonly detail?: string;
  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = "ArchiveError";
    this.code = code;
    this.detail = detail;
  }
}
