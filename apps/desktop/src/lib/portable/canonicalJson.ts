/**
 * Canonical JSON: recursively key-sorted, whitespace-free serialization so
 * identical values always produce identical UTF-8 bytes across processes and
 * platforms (design §1). Semantic digests and manifest bytes both build on
 * this. Undefined object properties are dropped, matching JSON.stringify.
 */

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = canonicalize(item);
    }
    return out;
  }
  return value;
}

export function canonicalJsonText(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJsonText(value));
}
