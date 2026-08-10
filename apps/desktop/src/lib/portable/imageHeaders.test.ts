import { describe, expect, it } from "vitest";
import { zlibSync } from "fflate";
import { readImageHeader } from "./imageHeaders.ts";
import { crc32 } from "./zip.ts";
import { bmpBytes, gifBytes, jpegBytes } from "./fixtures/images.ts";

function chunk(type: string, data: number[]): number[] {
  const length = data.length;
  const body = Uint8Array.from([
    ...[...type].map((char) => char.charCodeAt(0)),
    ...data,
  ]);
  const checksum = crc32(body);
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...body,
    (checksum >>> 24) & 0xff,
    (checksum >>> 16) & 0xff,
    (checksum >>> 8) & 0xff,
    checksum & 0xff,
  ];
}

function animatedPng(
  frames: number,
  imageData: number[] = [...zlibSync(new Uint8Array(24 * (1 + 32 * 4)))],
): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", [0, 0, 0, 32, 0, 0, 0, 24, 8, 6, 0, 0, 0]),
    ...chunk("acTL", [
      (frames >>> 24) & 0xff,
      (frames >>> 16) & 0xff,
      (frames >>> 8) & 0xff,
      frames & 0xff,
      0,
      0,
      0,
      0,
    ]),
    ...chunk("IDAT", imageData),
    ...chunk("IEND", []),
  ]);
}

describe("readImageHeader APNG", () => {
  it("reports the declared animation frame count", () => {
    expect(readImageHeader(animatedPng(250), "png", 100).frames).toBe(250);
  });

  it("rejects a zero-frame animation control chunk", () => {
    expect(() => readImageHeader(animatedPng(0), "png", 100)).toThrow();
  });

  it("rejects a PNG that ends after IHDR without image data or IEND", () => {
    const ihdrOnly = animatedPng(1).slice(0, 33);
    expect(() => readImageHeader(ihdrOnly, "png", 100)).toThrow();
  });

  it("rejects a PNG whose IDAT chunks contain no encoded bytes", () => {
    expect(() => readImageHeader(animatedPng(1, []), "png", 100)).toThrow();
  });

  it("rejects a PNG whose nonempty IDAT is not a valid zlib stream", () => {
    expect(() => readImageHeader(animatedPng(1, [1]), "png", 100)).toThrow();
  });

  it("rejects a PNG with a corrupt chunk checksum", () => {
    const bytes = animatedPng(1);
    bytes[29] ^= 0xff;
    expect(() => readImageHeader(bytes, "png", 100)).toThrow();
  });
});

describe("readImageHeader JPEG", () => {
  it("rejects a JPEG that ends after SOF without scan data or EOI", () => {
    const sofOnly = jpegBytes(32, 24).slice(0, 39);
    expect(() => readImageHeader(sofOnly, "jpg", 1)).toThrow();
  });
});

describe("readImageHeader GIF", () => {
  it("rejects a frame descriptor outside the logical screen", () => {
    const bytes = gifBytes(4, 4);
    bytes[18] = 32;
    bytes[19] = 0;
    expect(() => readImageHeader(bytes, "gif", 100)).toThrow();
  });
});

describe("readImageHeader BMP", () => {
  it("rejects a truncated DIB header with no pixel data", () => {
    expect(() => readImageHeader(bmpBytes(4, 4).slice(0, 26), "bmp", 1))
      .toThrow();
  });
});
