import { describe, expect, it } from "vitest";
import { deflateSync } from "fflate";
import {
  buildRawZip,
  type RawZipEntry,
  zip64ExtraField,
} from "./fixtures/rawZip.ts";
import {
  buildZip,
  crc32,
  extractZipEntry,
  readZipEntries,
  ZipError,
} from "./zip.ts";
import { ARCHIVE_LIMITS } from "./limits.ts";

/**
 * Task 1.5 feasibility spike: prove the bounded central-directory parser can
 * observe and reject every ZIP attribute the validator needs — encrypted
 * bits, data descriptors, ZIP64, non-regular Unix modes, unsupported
 * compression, and lying sizes — before any dependency decision is locked in.
 * `fflate` alone cannot expose these fields through its public streaming API,
 * which is why the parser is hand-rolled and fflate is used only to inflate.
 */

const encoder = new TextEncoder();

function textEntry(name: string, text: string): RawZipEntry {
  const data = encoder.encode(text);
  return { name, data, crc32: crc32(data) };
}

function expectRejection(bytes: Uint8Array, code: string): void {
  try {
    const entries = readZipEntries(bytes, ARCHIVE_LIMITS);
    // Some rejections only trigger on extraction.
    for (const entry of entries) {
      extractZipEntry(bytes, entry, ARCHIVE_LIMITS);
    }
    expect.unreachable(`expected rejection ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ZipError);
    expect((error as ZipError).code).toBe(code);
  }
}

describe("bounded ZIP intake feasibility", () => {
  it("round-trips a well-formed archive built by the deterministic writer", () => {
    const bytes = buildZip([
      { path: "manifest.json", bytes: encoder.encode('{"kind":"t"}') },
      { path: "library.json", bytes: encoder.encode("{}") },
    ]);
    const entries = readZipEntries(bytes, ARCHIVE_LIMITS);
    expect(entries.map((e) => e.path)).toEqual([
      "manifest.json",
      "library.json",
    ]);
    const manifest = extractZipEntry(bytes, entries[0], ARCHIVE_LIMITS);
    expect(new TextDecoder().decode(manifest)).toBe('{"kind":"t"}');
  });

  it("rejects an encrypted entry via the general-purpose bit", () => {
    const entry = { ...textEntry("manifest.json", "{}"), flags: 0x0001 };
    expectRejection(buildRawZip([entry]), "zip/encrypted");
  });

  it("rejects a data-descriptor entry (general-purpose bit 3)", () => {
    const entry = { ...textEntry("manifest.json", "{}"), flags: 0x0008 };
    expectRejection(buildRawZip([entry]), "zip/data-descriptor");
  });

  it("rejects a ZIP64 entry count marker in the end record", () => {
    const bytes = buildRawZip([textEntry("manifest.json", "{}")], {
      totalEntries: 0xffff,
    });
    expectRejection(bytes, "zip/zip64-unsupported");
  });

  it("rejects a ZIP64 extended-information extra field", () => {
    const entry = {
      ...textEntry("manifest.json", "{}"),
      extra: zip64ExtraField(),
    };
    expectRejection(buildRawZip([entry]), "zip/zip64-unsupported");
  });

  it("rejects a ZIP64 size marker in a central entry", () => {
    const entry = {
      ...textEntry("manifest.json", "{}"),
      centralUncompressedSize: 0xffffffff,
    };
    expectRejection(buildRawZip([entry]), "zip/zip64-unsupported");
  });

  it("rejects a Unix symlink entry via the external-attribute mode", () => {
    const entry = {
      ...textEntry("assets/00000000-0000-4000-8000-000000000001.png", "target"),
      versionMadeBy: 0x031e, // Unix, version 3.0
      externalAttrs: 0o120777 << 16,
    };
    expectRejection(buildRawZip([entry]), "zip/symlink");
  });

  it("rejects a non-regular Unix entry such as a FIFO", () => {
    const entry = {
      ...textEntry("library.json", "{}"),
      versionMadeBy: 0x031e,
      externalAttrs: 0o010644 << 16,
    };
    expectRejection(buildRawZip([entry]), "zip/non-regular-entry");
  });

  it("rejects a directory entry", () => {
    const entry = { ...textEntry("essays/", ""), externalAttrs: 0x10 };
    expectRejection(buildRawZip([entry]), "zip/directory-entry");
  });

  it("rejects an unsupported compression method", () => {
    const entry = { ...textEntry("library.json", "{}"), method: 12 };
    expectRejection(buildRawZip([entry]), "zip/unsupported-compression");
  });

  it("rejects a multi-disk end record", () => {
    const bytes = buildRawZip([textEntry("manifest.json", "{}")], {
      diskNumber: 1,
    });
    expectRejection(bytes, "zip/multi-disk");
  });

  it("rejects non-ASCII entry-name bytes", () => {
    const entry: RawZipEntry = {
      name: Uint8Array.from([0x6d, 0xc3, 0xa9, 0x2e, 0x6a]), // "mé.j" UTF-8
      data: encoder.encode("{}"),
      crc32: crc32(encoder.encode("{}")),
    };
    expectRejection(buildRawZip([entry]), "zip/path-encoding");
  });

  it("rejects duplicate entry names", () => {
    const bytes = buildRawZip([
      textEntry("library.json", "{}"),
      textEntry("library.json", "{}"),
    ]);
    expectRejection(bytes, "zip/duplicate-entry");
  });

  it("rejects an entry whose declared size exceeds the single-entry limit", () => {
    const entry = {
      ...textEntry("library.json", "{}"),
      centralUncompressedSize: ARCHIVE_LIMITS.maxEntryExpandedBytes + 1,
    };
    expectRejection(buildRawZip([entry]), "zip/expanded-limit");
  });

  it("stops a deflate stream that emits more bytes than it declared", () => {
    const expanded = new Uint8Array(1 << 20); // 1 MiB of zeros compresses tiny
    const compressed = deflateSync(expanded);
    const entry: RawZipEntry = {
      name: "library.json",
      data: compressed,
      method: 8,
      crc32: crc32(expanded),
      compressedSize: compressed.length,
      uncompressedSize: 64, // lie: declares 64 bytes
    };
    expectRejection(buildRawZip([entry]), "zip/size-mismatch");
  });

  it("rejects a corrupted payload via CRC mismatch", () => {
    const data = encoder.encode('{"kind":"tesina-library"}');
    const entry: RawZipEntry = {
      name: "manifest.json",
      data,
      crc32: crc32(data) ^ 0xdeadbeef,
    };
    expectRejection(buildRawZip([entry]), "zip/crc-mismatch");
  });

  it("rejects an archive with more entries than the limit allows", () => {
    const entries = Array.from(
      { length: 40 },
      (_, i) => textEntry(`essays/${i}.json`, "{}"),
    );
    const bytes = buildRawZip(entries);
    try {
      readZipEntries(bytes, { ...ARCHIVE_LIMITS, maxEntryCount: 8 });
      expect.unreachable("expected rejection zip/entry-count");
    } catch (error) {
      expect(error).toBeInstanceOf(ZipError);
      expect((error as ZipError).code).toBe("zip/entry-count");
    }
  });

  it("extracts deflate entries through a bounded streaming inflater", () => {
    const expanded = encoder.encode(
      Array.from({ length: 4096 }, (_, i) => `tesina${i % 997}`).join(" "),
    );
    const compressed = deflateSync(expanded);
    const entry: RawZipEntry = {
      name: "library.json",
      data: compressed,
      method: 8,
      crc32: crc32(expanded),
      compressedSize: compressed.length,
      uncompressedSize: expanded.length,
    };
    const bytes = buildRawZip([entry]);
    const metas = readZipEntries(bytes, ARCHIVE_LIMITS);
    const out = extractZipEntry(bytes, metas[0], ARCHIVE_LIMITS);
    expect(out).toEqual(expanded);
  });
});
