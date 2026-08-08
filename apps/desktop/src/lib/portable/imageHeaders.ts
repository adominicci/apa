/**
 * Bounded image header inspection (design §4): signature, dimensions, and
 * frame counts read from headers only — nothing is ever decoded. Supported
 * kinds mirror persist/assets.ts (png, jpg, gif, bmp).
 */

export interface ImageHeader {
  kind: "png" | "jpg" | "gif" | "bmp";
  width: number;
  height: number;
  frames: number;
}

export class ImageHeaderError extends Error {
  readonly code: string;
  readonly detail?: string;
  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = "ImageHeaderError";
    this.code = code;
    this.detail = detail;
  }
}

export const SUPPORTED_IMAGE_EXTENSIONS: Record<string, ImageHeader["kind"]> = {
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
  gif: "gif",
  bmp: "bmp",
};

export const IMAGE_MEDIA_TYPES: Record<ImageHeader["kind"], string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
};

function u32be(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) |
      bytes[at + 3]) >>> 0
  );
}

function u16be(bytes: Uint8Array, at: number): number {
  return (bytes[at] << 8) | bytes[at + 1];
}

function u16le(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}

function u32le(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) |
      (bytes[at + 3] << 24)) >>> 0
  );
}

function fail(detail: string): never {
  throw new ImageHeaderError(
    "image/signature",
    "image bytes do not match a supported format",
    detail,
  );
}

function pngHeader(bytes: Uint8Array): ImageHeader {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || sig.some((b, i) => bytes[i] !== b)) fail("png");
  // First chunk must be IHDR.
  if (
    bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  ) fail("png/ihdr");
  return {
    kind: "png",
    width: u32be(bytes, 16),
    height: u32be(bytes, 20),
    frames: 1,
  };
}

function jpegHeader(bytes: Uint8Array): ImageHeader {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail("jpg");
  let at = 2;
  // Bounded marker scan: each iteration advances by the declared segment
  // length, and the loop is capped by the byte length itself.
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) fail("jpg/marker");
    const marker = bytes[at + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = u16be(bytes, at + 2);
    if (length < 2) fail("jpg/segment");
    const isSof = (marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 &&
      marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (at + 9 > bytes.length) fail("jpg/sof");
      return {
        kind: "jpg",
        width: u16be(bytes, at + 7),
        height: u16be(bytes, at + 5),
        frames: 1,
      };
    }
    if (marker === 0xd9 || marker === 0xda) break;
    at += 2 + length;
  }
  fail("jpg/no-sof");
}

function gifHeader(bytes: Uint8Array, maxFrames: number): ImageHeader {
  const sig = [0x47, 0x49, 0x46, 0x38];
  if (bytes.length < 13 || sig.some((b, i) => bytes[i] !== b)) fail("gif");
  const width = u16le(bytes, 6);
  const height = u16le(bytes, 8);
  const globalTable = bytes[10] & 0x80
    ? 3 * (1 << ((bytes[10] & 0x07) + 1))
    : 0;
  let at = 13 + globalTable;
  let frames = 0;
  while (at < bytes.length) {
    const block = bytes[at];
    if (block === 0x3b) break; // trailer
    if (block === 0x21) {
      // extension: label + sub-blocks
      at += 2;
      while (at < bytes.length && bytes[at] !== 0) at += bytes[at] + 1;
      at += 1;
    } else if (block === 0x2c) {
      frames += 1;
      if (frames > maxFrames) {
        // Caller maps this to its limit error; stop scanning immediately.
        return { kind: "gif", width, height, frames };
      }
      const localTable = bytes[at + 9] & 0x80
        ? 3 * (1 << ((bytes[at + 9] & 0x07) + 1))
        : 0;
      at += 10 + localTable + 1; // descriptor + table + LZW code size
      while (at < bytes.length && bytes[at] !== 0) at += bytes[at] + 1;
      at += 1;
    } else {
      fail("gif/block");
    }
  }
  if (frames === 0) fail("gif/no-frames");
  return { kind: "gif", width, height, frames };
}

function bmpHeader(bytes: Uint8Array): ImageHeader {
  if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) fail("bmp");
  const dibSize = u32le(bytes, 14);
  if (dibSize < 40 || bytes.length < 14 + 12) fail("bmp/dib");
  const width = u32le(bytes, 18);
  // Height may be negative (top-down); magnitude is the pixel height.
  const rawHeight = u32le(bytes, 22) | 0;
  return {
    kind: "bmp",
    width,
    height: Math.abs(rawHeight),
    frames: 1,
  };
}

/** Reads the header for the declared extension; rejects any mismatch. */
export function readImageHeader(
  bytes: Uint8Array,
  extension: string,
  maxFrames: number,
): ImageHeader {
  const kind = SUPPORTED_IMAGE_EXTENSIONS[extension];
  if (!kind) {
    throw new ImageHeaderError(
      "image/extension",
      "unsupported figure extension",
      extension,
    );
  }
  switch (kind) {
    case "png":
      return pngHeader(bytes);
    case "jpg":
      return jpegHeader(bytes);
    case "gif":
      return gifHeader(bytes, maxFrames);
    case "bmp":
      return bmpHeader(bytes);
  }
}
