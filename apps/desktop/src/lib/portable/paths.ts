/**
 * Typed path constructors (task 3.6, pure half). Every attacker-controlled
 * identifier passes through these before any local path is derived. The
 * grammar is exact ASCII lowercase — separators, traversal, reserved device
 * names, Unicode lookalikes, and case aliases are unrepresentable, and entry
 * names compare byte-wise afterwards (amended archive spec). The native
 * adapters add a final canonical containment check on the real filesystem.
 */

export class PathError extends Error {
  readonly code: string;
  readonly detail?: string;
  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = "PathError";
    this.code = code;
    this.detail = detail;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EXTENSION_PATTERN = /^[a-z0-9]{1,5}$/;

export function isCanonicalUuid(value: string): boolean {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function requireUuid(value: string, what: string): string {
  if (!isCanonicalUuid(value)) {
    throw new PathError(
      "path/identifier",
      `${what} is not a canonical lowercase UUID`,
      value,
    );
  }
  return value;
}

export function isSupportedExtension(value: string): boolean {
  return typeof value === "string" && EXTENSION_PATTERN.test(value);
}

/** Local app-data path of one essay file. */
export function localEssayFile(id: string): string {
  return `essays/${requireUuid(id, "essay id")}.json`;
}

/** Local app-data path of one figure asset. */
export function localAssetFile(id: string, extension: string): string {
  requireUuid(id, "asset id");
  if (!isSupportedExtension(extension)) {
    throw new PathError(
      "path/extension",
      "asset extension must be 1-5 lowercase ASCII letters or digits",
      extension,
    );
  }
  return `essays/assets/${id}.${extension}`;
}

export type ArchiveEntryPath =
  | { kind: "manifest" }
  | { kind: "library" }
  | { kind: "essay"; id: string }
  | { kind: "asset"; id: string; extension: string };

const ESSAY_ENTRY = /^essays\/([0-9a-f-]{36})\.json$/;
const ASSET_ENTRY = /^assets\/([0-9a-f-]{36})\.([a-z0-9]{1,5})$/;

/** Strict grammar for the four allowed archive entry shapes. */
export function parseArchiveEntryPath(path: string): ArchiveEntryPath {
  if (path === "manifest.json") return { kind: "manifest" };
  if (path === "library.json") return { kind: "library" };
  const essay = ESSAY_ENTRY.exec(path);
  if (essay && isCanonicalUuid(essay[1])) {
    return { kind: "essay", id: essay[1] };
  }
  const asset = ASSET_ENTRY.exec(path);
  if (asset && isCanonicalUuid(asset[1])) {
    return { kind: "asset", id: asset[1], extension: asset[2] };
  }
  throw new PathError(
    "path/entry",
    "archive entry path is outside the allowed grammar",
    path,
  );
}
