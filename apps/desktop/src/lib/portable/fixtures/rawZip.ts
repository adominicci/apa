/**
 * Hand-crafted ZIP byte builder for adversarial fixtures. Unlike the
 * production writer in ../zip.ts, every header field here is overridable so
 * tests can fabricate encrypted bits, data descriptors, ZIP64 markers, hostile
 * modes, and lying sizes that no well-behaved library would emit.
 */

export interface RawZipEntry {
  /** Entry name; a Uint8Array allows non-ASCII byte sequences. */
  name: string | Uint8Array;
  /** Bytes stored in the local entry (already compressed for method 8). */
  data: Uint8Array;
  method?: number;
  flags?: number;
  crc32?: number;
  compressedSize?: number;
  uncompressedSize?: number;
  versionMadeBy?: number;
  externalAttrs?: number;
  /** Raw extra field bytes (e.g. a ZIP64 0x0001 record). */
  extra?: Uint8Array;
  /**
   * Central-directory-only size overrides; default to the local values.
   * Lets a fixture lie in one place but not the other.
   */
  centralCompressedSize?: number;
  centralUncompressedSize?: number;
}

export interface RawZipOptions {
  /** Overrides the EOCD total-entry count (0xffff marks ZIP64). */
  totalEntries?: number;
  /** Overrides the EOCD disk number to fake a multi-disk archive. */
  diskNumber?: number;
  /** Overrides the EOCD central-directory offset. */
  centralDirectoryOffset?: number;
}

class ByteWriter {
  #chunks: number[] = [];
  u16(value: number): void {
    this.#chunks.push(value & 0xff, (value >>> 8) & 0xff);
  }
  u32(value: number): void {
    this.#chunks.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    );
  }
  bytes(data: Uint8Array): void {
    for (const byte of data) this.#chunks.push(byte);
  }
  get length(): number {
    return this.#chunks.length;
  }
  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.#chunks);
  }
}

function nameBytes(name: string | Uint8Array): Uint8Array {
  return typeof name === "string" ? new TextEncoder().encode(name) : name;
}

/** Builds a single-disk ZIP from fully caller-controlled header fields. */
export function buildRawZip(
  entries: RawZipEntry[],
  options: RawZipOptions = {},
): Uint8Array {
  const writer = new ByteWriter();
  const locals: { entry: RawZipEntry; offset: number }[] = [];

  for (const entry of entries) {
    const name = nameBytes(entry.name);
    const offset = writer.length;
    locals.push({ entry, offset });
    writer.u32(0x04034b50);
    writer.u16(20);
    writer.u16(entry.flags ?? 0);
    writer.u16(entry.method ?? 0);
    writer.u16(0); // mod time
    writer.u16(0x21); // mod date (1980-01-01)
    writer.u32(entry.crc32 ?? 0);
    writer.u32(entry.compressedSize ?? entry.data.length);
    writer.u32(entry.uncompressedSize ?? entry.data.length);
    writer.u16(name.length);
    writer.u16(0);
    writer.bytes(name);
    writer.bytes(entry.data);
  }

  const centralStart = writer.length;
  for (const { entry, offset } of locals) {
    const name = nameBytes(entry.name);
    const extra = entry.extra ?? new Uint8Array(0);
    writer.u32(0x02014b50);
    writer.u16(entry.versionMadeBy ?? 20);
    writer.u16(20);
    writer.u16(entry.flags ?? 0);
    writer.u16(entry.method ?? 0);
    writer.u16(0);
    writer.u16(0x21);
    writer.u32(entry.crc32 ?? 0);
    writer.u32(
      entry.centralCompressedSize ?? entry.compressedSize ?? entry.data.length,
    );
    writer.u32(
      entry.centralUncompressedSize ?? entry.uncompressedSize ??
        entry.data.length,
    );
    writer.u16(name.length);
    writer.u16(extra.length);
    writer.u16(0); // comment length
    writer.u16(0); // disk number start
    writer.u16(0); // internal attrs
    writer.u32(entry.externalAttrs ?? 0);
    writer.u32(offset);
    writer.bytes(name);
    writer.bytes(extra);
  }
  const centralSize = writer.length - centralStart;

  writer.u32(0x06054b50);
  writer.u16(options.diskNumber ?? 0);
  writer.u16(0);
  writer.u16(options.totalEntries ?? entries.length);
  writer.u16(options.totalEntries ?? entries.length);
  writer.u32(centralSize);
  writer.u32(options.centralDirectoryOffset ?? centralStart);
  writer.u16(0);
  return writer.toUint8Array();
}

/** A ZIP64 extended-information extra field (header id 0x0001). */
export function zip64ExtraField(): Uint8Array {
  const writer = new ByteWriter();
  writer.u16(0x0001);
  writer.u16(16);
  writer.u32(0);
  writer.u32(0);
  writer.u32(0);
  writer.u32(0);
  return writer.toUint8Array();
}
