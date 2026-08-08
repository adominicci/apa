/**
 * Minimal structurally valid image builders for deterministic fixtures and
 * adversarial tests. Each file carries a correct signature and header for the
 * declared dimensions; raster payloads are filler, which is all the bounded
 * validator inspects (signatures, dimensions, frame counts — never decoding).
 */

import { crc32 } from "../zip.ts";

function u32be(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function u16be(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

function u32le(value: number): number[] {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
}

function u16le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function pngChunk(type: string, data: number[]): number[] {
  const typeBytes = [...type].map((c) => c.charCodeAt(0));
  const body = Uint8Array.from([...typeBytes, ...data]);
  return [...u32be(data.length), ...body, ...u32be(crc32(body))];
}

export function pngBytes(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk("IHDR", [
      ...u32be(width),
      ...u32be(height),
      8, // bit depth
      2, // truecolor
      0,
      0,
      0,
    ]),
    ...pngChunk("IDAT", [0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]),
    ...pngChunk("IEND", []),
  ]);
}

export function jpegBytes(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    0x00,
    0x10, // APP0, length 16
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00, // "JFIF\0"
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11, // SOF0, length 17
    0x08, // precision
    ...u16be(height),
    ...u16be(width),
    0x03, // components
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9, // EOI
  ]);
}

export function gifBytes(
  width: number,
  height: number,
  frames = 1,
): Uint8Array {
  const bytes: number[] = [
    0x47,
    0x49,
    0x46,
    0x38,
    0x39,
    0x61, // "GIF89a"
    ...u16le(width),
    ...u16le(height),
    0x00, // no global color table
    0x00,
    0x00,
  ];
  for (let i = 0; i < frames; i += 1) {
    bytes.push(
      0x2c, // image descriptor
      ...u16le(0),
      ...u16le(0),
      ...u16le(width),
      ...u16le(height),
      0x00, // no local color table
      0x02, // LZW minimum code size
      0x01, // one data sub-block
      0x44,
      0x00, // block terminator
    );
  }
  bytes.push(0x3b); // trailer
  return Uint8Array.from(bytes);
}

export function bmpBytes(width: number, height: number): Uint8Array {
  const headerSize = 54;
  return Uint8Array.from([
    0x42,
    0x4d, // "BM"
    ...u32le(headerSize + 4),
    0x00,
    0x00,
    0x00,
    0x00,
    ...u32le(headerSize),
    ...u32le(40), // BITMAPINFOHEADER
    ...u32le(width),
    ...u32le(height),
    ...u16le(1), // planes
    ...u16le(24), // bits per pixel
    ...u32le(0),
    ...u32le(4),
    ...u32le(2835),
    ...u32le(2835),
    ...u32le(0),
    ...u32le(0),
    0x00,
    0x00,
    0x00,
    0x00, // minimal pixel payload
  ]);
}
