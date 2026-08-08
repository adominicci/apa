/**
 * Deterministic ZIP writer and bounded central-directory reader for `.tesina`
 * archives (design §4; feasibility task 1.5).
 *
 * The reader is hand-rolled because the validator must observe attributes
 * fflate's public streaming API hides: the encryption and data-descriptor
 * general-purpose bits, ZIP64 markers, Unix modes carried in external
 * attributes (symlinks, FIFOs), and per-entry compression methods. fflate is
 * used only as the inflater, wrapped in observed-byte counters so a lying or
 * bomb-shaped stream stops at its cap instead of allocating first.
 *
 * The writer emits fully fixed metadata (DOS timestamp 1980-01-01, version
 * 20, zero attributes, no extra fields) so identical inputs produce identical
 * bytes across processes and platforms.
 */

import { deflateSync, Inflate } from "fflate";
import type { ArchiveLimits } from "./limits.ts";

export class ZipError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ZipError";
    this.code = code;
  }
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, seed = 0): number {
  let c = seed ^ -1;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

export interface ZipEntryInput {
  /** Forward-slash relative path; ASCII enforced by the archive contract. */
  path: string;
  bytes: Uint8Array;
}

export interface ZipBuildOptions {
  /** Deflate entries (level 9) instead of storing them. */
  compress?: boolean;
}

export interface ZipEntryMeta {
  path: string;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  versionMadeBy: number;
  externalAttrs: number;
  localHeaderOffset: number;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
/** DOS date 1980-01-01, time 00:00 — the writer's fixed timestamp. */
const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = 0x21;

class ByteWriter {
  #parts: Uint8Array[] = [];
  #length = 0;
  u16(value: number): void {
    this.#parts.push(Uint8Array.of(value & 0xff, (value >>> 8) & 0xff));
    this.#length += 2;
  }
  u32(value: number): void {
    this.#parts.push(
      Uint8Array.of(
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff,
      ),
    );
    this.#length += 4;
  }
  bytes(data: Uint8Array): void {
    this.#parts.push(data);
    this.#length += data.length;
  }
  get length(): number {
    return this.#length;
  }
  concat(): Uint8Array {
    const out = new Uint8Array(this.#length);
    let offset = 0;
    for (const part of this.#parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

function encodeAsciiPath(path: string): Uint8Array {
  const bytes = new Uint8Array(path.length);
  for (let i = 0; i < path.length; i += 1) {
    const code = path.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      throw new ZipError(
        "zip/path-encoding",
        `entry path contains a non-ASCII or control character: ${path}`,
      );
    }
    bytes[i] = code;
  }
  return bytes;
}

/** Deterministic archive bytes for the given entries, in the given order. */
export function buildZip(
  entries: ZipEntryInput[],
  options: ZipBuildOptions = {},
): Uint8Array {
  const writer = new ByteWriter();
  const central: {
    name: Uint8Array;
    method: number;
    crc: number;
    compressedSize: number;
    uncompressedSize: number;
    offset: number;
  }[] = [];

  for (const entry of entries) {
    const name = encodeAsciiPath(entry.path);
    const crc = crc32(entry.bytes);
    let method = 0;
    let payload = entry.bytes;
    if (options.compress) {
      const deflated = deflateSync(entry.bytes, { level: 9 });
      if (deflated.length < entry.bytes.length) {
        method = 8;
        payload = deflated;
      }
    }
    const offset = writer.length;
    central.push({
      name,
      method,
      crc,
      compressedSize: payload.length,
      uncompressedSize: entry.bytes.length,
      offset,
    });
    writer.u32(SIG_LOCAL);
    writer.u16(20);
    writer.u16(0);
    writer.u16(method);
    writer.u16(FIXED_DOS_TIME);
    writer.u16(FIXED_DOS_DATE);
    writer.u32(crc);
    writer.u32(payload.length);
    writer.u32(entry.bytes.length);
    writer.u16(name.length);
    writer.u16(0);
    writer.bytes(name);
    writer.bytes(payload);
  }

  const centralStart = writer.length;
  for (const entry of central) {
    writer.u32(SIG_CENTRAL);
    writer.u16(20);
    writer.u16(20);
    writer.u16(0);
    writer.u16(entry.method);
    writer.u16(FIXED_DOS_TIME);
    writer.u16(FIXED_DOS_DATE);
    writer.u32(entry.crc);
    writer.u32(entry.compressedSize);
    writer.u32(entry.uncompressedSize);
    writer.u16(entry.name.length);
    writer.u16(0);
    writer.u16(0);
    writer.u16(0);
    writer.u16(0);
    writer.u32(0);
    writer.u32(entry.offset);
    writer.bytes(entry.name);
  }
  const centralSize = writer.length - centralStart;

  writer.u32(SIG_EOCD);
  writer.u16(0);
  writer.u16(0);
  writer.u16(central.length);
  writer.u16(central.length);
  writer.u32(centralSize);
  writer.u32(centralStart);
  writer.u16(0);
  return writer.concat();
}

class ByteReader {
  constructor(readonly bytes: Uint8Array) {}
  u16(offset: number): number {
    this.#check(offset, 2);
    return this.bytes[offset] | (this.bytes[offset + 1] << 8);
  }
  u32(offset: number): number {
    this.#check(offset, 4);
    return (
      (this.bytes[offset] |
        (this.bytes[offset + 1] << 8) |
        (this.bytes[offset + 2] << 16) |
        (this.bytes[offset + 3] << 24)) >>> 0
    );
  }
  slice(offset: number, length: number): Uint8Array {
    this.#check(offset, length);
    return this.bytes.subarray(offset, offset + length);
  }
  #check(offset: number, length: number): void {
    if (
      offset < 0 || length < 0 || offset + length > this.bytes.length ||
      !Number.isSafeInteger(offset + length)
    ) {
      throw new ZipError("zip/truncated", "read past end of archive");
    }
  }
}

function decodeAsciiPath(bytes: Uint8Array): string {
  let path = "";
  for (const byte of bytes) {
    if (byte < 0x20 || byte > 0x7e) {
      throw new ZipError(
        "zip/path-encoding",
        "entry name contains non-ASCII or control bytes",
      );
    }
    path += String.fromCharCode(byte);
  }
  return path;
}

function findEndOfCentralDirectory(reader: ByteReader): number {
  const { bytes } = reader;
  const minPos = Math.max(0, bytes.length - 22 - 0xffff);
  for (let pos = bytes.length - 22; pos >= minPos; pos -= 1) {
    if (reader.u32(pos) === SIG_EOCD) {
      const commentLength = reader.u16(pos + 20);
      if (pos + 22 + commentLength === bytes.length) return pos;
    }
  }
  throw new ZipError("zip/eocd-missing", "no end-of-central-directory record");
}

/**
 * Parses the central directory under the archive limits, rejecting every
 * feature the `.tesina` contract does not support. Throws ZipError; never
 * extracts anything.
 */
export function readZipEntries(
  bytes: Uint8Array,
  limits: ArchiveLimits,
): ZipEntryMeta[] {
  if (bytes.length > limits.maxArchiveBytes) {
    throw new ZipError("zip/archive-bytes", "archive exceeds the byte limit");
  }
  const reader = new ByteReader(bytes);
  const eocd = findEndOfCentralDirectory(reader);
  if (reader.u16(eocd + 4) !== 0 || reader.u16(eocd + 6) !== 0) {
    throw new ZipError("zip/multi-disk", "multi-disk archives are unsupported");
  }
  const entriesOnDisk = reader.u16(eocd + 8);
  const totalEntries = reader.u16(eocd + 10);
  const centralSize = reader.u32(eocd + 12);
  const centralOffset = reader.u32(eocd + 16);
  if (totalEntries === 0xffff || centralOffset === 0xffffffff) {
    throw new ZipError(
      "zip/zip64-unsupported",
      "ZIP64 archives are unsupported",
    );
  }
  if (entriesOnDisk !== totalEntries) {
    throw new ZipError("zip/multi-disk", "spanned central directory");
  }
  if (totalEntries > limits.maxEntryCount) {
    throw new ZipError("zip/entry-count", "too many archive entries");
  }
  if (centralOffset + centralSize > eocd) {
    throw new ZipError(
      "zip/truncated",
      "central directory overruns its end record",
    );
  }

  const entries: ZipEntryMeta[] = [];
  const seenPaths = new Set<string>();
  let totalDeclaredExpanded = 0;
  let offset = centralOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (reader.u32(offset) !== SIG_CENTRAL) {
      throw new ZipError("zip/truncated", "malformed central directory entry");
    }
    const versionMadeBy = reader.u16(offset + 4);
    const flags = reader.u16(offset + 8);
    const method = reader.u16(offset + 10);
    const crc = reader.u32(offset + 16);
    const compressedSize = reader.u32(offset + 20);
    const uncompressedSize = reader.u32(offset + 24);
    const nameLength = reader.u16(offset + 28);
    const extraLength = reader.u16(offset + 30);
    const commentLength = reader.u16(offset + 32);
    const externalAttrs = reader.u32(offset + 38);
    const localHeaderOffset = reader.u32(offset + 42);

    if (flags & 0x0001 || flags & 0x0040) {
      throw new ZipError("zip/encrypted", "encrypted entries are unsupported");
    }
    if (flags & 0x0008) {
      throw new ZipError(
        "zip/data-descriptor",
        "data-descriptor entries are unsupported",
      );
    }
    if (
      compressedSize === 0xffffffff || uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new ZipError(
        "zip/zip64-unsupported",
        "ZIP64 sizes are unsupported",
      );
    }
    if (method !== 0 && method !== 8) {
      throw new ZipError(
        "zip/unsupported-compression",
        `compression method ${method} is unsupported`,
      );
    }

    const nameBytes = reader.slice(offset + 46, nameLength);
    const path = decodeAsciiPath(nameBytes);
    if (path.length === 0 || path.length > limits.maxEntryPathLength) {
      throw new ZipError(
        "zip/path-invalid",
        "entry path length is unsupported",
      );
    }

    const extra = reader.slice(offset + 46 + nameLength, extraLength);
    for (let e = 0; e + 4 <= extra.length;) {
      const headerId = extra[e] | (extra[e + 1] << 8);
      const size = extra[e + 2] | (extra[e + 3] << 8);
      if (headerId === 0x0001) {
        throw new ZipError(
          "zip/zip64-unsupported",
          "ZIP64 extra field is unsupported",
        );
      }
      e += 4 + size;
    }

    const hostSystem = versionMadeBy >>> 8;
    if (hostSystem === 3) {
      const mode = externalAttrs >>> 16;
      const format = mode & 0o170000;
      if (format === 0o120000) {
        throw new ZipError("zip/symlink", "symlink entries are unsupported");
      }
      if (format !== 0 && format !== 0o100000) {
        throw new ZipError(
          "zip/non-regular-entry",
          "non-regular file entries are unsupported",
        );
      }
    }
    if (path.endsWith("/") || (hostSystem === 0 && externalAttrs & 0x10)) {
      throw new ZipError(
        "zip/directory-entry",
        "directory entries are unsupported",
      );
    }
    if (seenPaths.has(path)) {
      throw new ZipError("zip/duplicate-entry", `duplicate entry: ${path}`);
    }
    seenPaths.add(path);

    if (uncompressedSize > limits.maxEntryExpandedBytes) {
      throw new ZipError(
        "zip/expanded-limit",
        "declared entry size exceeds the single-entry limit",
      );
    }
    totalDeclaredExpanded += uncompressedSize;
    if (totalDeclaredExpanded > limits.maxTotalExpandedBytes) {
      throw new ZipError(
        "zip/expanded-limit",
        "declared total size exceeds the archive expansion limit",
      );
    }
    if (
      method === 8 && compressedSize > 0 &&
      uncompressedSize > limits.compressionRatioExemptBytes &&
      uncompressedSize / compressedSize > limits.maxCompressionRatio
    ) {
      throw new ZipError(
        "zip/ratio-limit",
        "declared compression ratio exceeds the safety limit",
      );
    }

    entries.push({
      path,
      method,
      flags,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      versionMadeBy,
      externalAttrs,
      localHeaderOffset,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Extracts one entry with observed-byte counters as the authority: declared
 * sizes admit the read, but the stream stops the moment observed output
 * passes the declaration or a limit, and the CRC must match at the end.
 */
export function extractZipEntry(
  bytes: Uint8Array,
  entry: ZipEntryMeta,
  limits: ArchiveLimits,
): Uint8Array {
  const reader = new ByteReader(bytes);
  const at = entry.localHeaderOffset;
  if (reader.u32(at) !== SIG_LOCAL) {
    throw new ZipError("zip/truncated", "missing local header");
  }
  const nameLength = reader.u16(at + 26);
  const extraLength = reader.u16(at + 28);
  const dataStart = at + 30 + nameLength + extraLength;
  const payload = reader.slice(dataStart, entry.compressedSize);

  let expanded: Uint8Array;
  if (entry.method === 0) {
    if (payload.length !== entry.uncompressedSize) {
      throw new ZipError("zip/size-mismatch", "stored size disagrees");
    }
    expanded = payload;
  } else {
    const cap = Math.min(entry.uncompressedSize, limits.maxEntryExpandedBytes);
    const chunks: Uint8Array[] = [];
    let observed = 0;
    const inflater = new Inflate((chunk) => {
      observed += chunk.length;
      if (observed > cap) {
        throw new ZipError(
          "zip/size-mismatch",
          "inflated output exceeds the declared size",
        );
      }
      chunks.push(chunk);
    });
    try {
      inflater.push(payload, true);
    } catch (error) {
      if (error instanceof ZipError) throw error;
      throw new ZipError("zip/deflate-invalid", "corrupt deflate stream");
    }
    if (observed !== entry.uncompressedSize) {
      throw new ZipError(
        "zip/size-mismatch",
        "inflated output disagrees with the declared size",
      );
    }
    expanded = new Uint8Array(observed);
    let cursor = 0;
    for (const chunk of chunks) {
      expanded.set(chunk, cursor);
      cursor += chunk.length;
    }
  }

  if (crc32(expanded) !== entry.crc32) {
    throw new ZipError("zip/crc-mismatch", "entry checksum disagrees");
  }
  return expanded;
}
