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

function pngHeader(bytes: Uint8Array, maxFrames: number): ImageHeader {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || sig.some((b, i) => bytes[i] !== b)) fail("png");
  // First chunk must be IHDR.
  if (
    u32be(bytes, 8) !== 13 ||
    bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  ) fail("png/ihdr");
  let frames = 1;
  let sawImageData = false;
  let sawEnd = false;
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = u32be(bytes, at);
    const end = at + 12 + length;
    if (end > bytes.length || end < at) fail("png/chunk");
    const type = String.fromCharCode(
      bytes[at + 4],
      bytes[at + 5],
      bytes[at + 6],
      bytes[at + 7],
    );
    if (type === "acTL") {
      if (length !== 8) fail("png/actl");
      frames = u32be(bytes, at + 8);
      if (frames === 0) fail("png/frames");
      if (frames > maxFrames) {
        return {
          kind: "png",
          width: u32be(bytes, 16),
          height: u32be(bytes, 20),
          frames,
        };
      }
    }
    if (type === "IDAT" && length > 0) sawImageData = true;
    if (type === "IEND") {
      if (length !== 0) fail("png/iend");
      sawEnd = true;
      break;
    }
    at = end;
  }
  if (!sawImageData || !sawEnd) fail("png/incomplete");
  return {
    kind: "png",
    width: u32be(bytes, 16),
    height: u32be(bytes, 20),
    frames,
  };
}

function jpegHeader(bytes: Uint8Array): ImageHeader {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail("jpg");
  let at = 2;
  let dimensions: { width: number; height: number } | undefined;
  let sawScanData = false;
  // Bounded marker scan: each iteration advances by the declared segment
  // length, and the loop is capped by the byte length itself.
  while (at + 2 <= bytes.length) {
    if (bytes[at] !== 0xff) fail("jpg/marker");
    let markerPrefix = at;
    while (
      markerPrefix + 1 < bytes.length && bytes[markerPrefix + 1] === 0xff
    ) markerPrefix += 1;
    if (markerPrefix + 1 >= bytes.length) fail("jpg/marker");
    const marker = bytes[markerPrefix + 1];
    const markerEnd = markerPrefix + 2;
    if (marker === 0xd9) {
      if (dimensions === undefined || !sawScanData) fail("jpg/incomplete");
      return { kind: "jpg", ...dimensions, frames: 1 };
    }
    if (
      marker === 0xd8 || marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      at = markerEnd;
      continue;
    }
    if (markerEnd + 2 > bytes.length) fail("jpg/segment");
    const length = u16be(bytes, markerEnd);
    const segmentEnd = markerEnd + length;
    if (length < 2 || segmentEnd > bytes.length) fail("jpg/segment");
    const isSof = (marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 &&
      marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (length < 8) fail("jpg/sof");
      dimensions = {
        width: u16be(bytes, markerEnd + 5),
        height: u16be(bytes, markerEnd + 3),
      };
    }
    if (marker === 0xda) {
      if (length < 6 || dimensions === undefined) fail("jpg/sos");
      let scanAt = segmentEnd;
      let currentScanHasData = false;
      while (scanAt < bytes.length) {
        if (bytes[scanAt] !== 0xff) {
          currentScanHasData = true;
          scanAt += 1;
          continue;
        }
        if (scanAt + 1 >= bytes.length) fail("jpg/scan");
        const next = bytes[scanAt + 1];
        if (next === 0x00) {
          currentScanHasData = true;
          scanAt += 2;
          continue;
        }
        if (next >= 0xd0 && next <= 0xd7) {
          scanAt += 2;
          continue;
        }
        sawScanData ||= currentScanHasData;
        at = scanAt;
        break;
      }
      if (scanAt >= bytes.length) fail("jpg/no-eoi");
      continue;
    }
    at = segmentEnd;
  }
  fail("jpg/incomplete");
}

function gifHeader(bytes: Uint8Array, maxFrames: number): ImageHeader {
  const sig = [0x47, 0x49, 0x46, 0x38];
  if (
    bytes.length < 13 || sig.some((b, i) => bytes[i] !== b) ||
    (bytes[4] !== 0x37 && bytes[4] !== 0x39) || bytes[5] !== 0x61
  ) fail("gif");
  const width = u16le(bytes, 6);
  const height = u16le(bytes, 8);
  if (width === 0 || height === 0) fail("gif/dimensions");
  const globalTable = bytes[10] & 0x80
    ? 3 * (1 << ((bytes[10] & 0x07) + 1))
    : 0;
  let at = 13 + globalTable;
  if (at > bytes.length) fail("gif/global-table");
  let frames = 0;
  let sawTrailer = false;
  while (at < bytes.length) {
    const block = bytes[at];
    if (block === 0x3b) {
      sawTrailer = true;
      break;
    }
    if (block === 0x21) {
      // extension: label + sub-blocks
      if (at + 2 > bytes.length) fail("gif/extension");
      at += 2;
      while (at < bytes.length && bytes[at] !== 0) {
        const end = at + bytes[at] + 1;
        if (end > bytes.length) fail("gif/extension-data");
        at = end;
      }
      if (at >= bytes.length) fail("gif/extension-end");
      at += 1;
    } else if (block === 0x2c) {
      if (at + 10 > bytes.length) fail("gif/descriptor");
      const left = u16le(bytes, at + 1);
      const top = u16le(bytes, at + 3);
      const frameWidth = u16le(bytes, at + 5);
      const frameHeight = u16le(bytes, at + 7);
      if (
        frameWidth === 0 || frameHeight === 0 ||
        left + frameWidth > width || top + frameHeight > height
      ) fail("gif/frame-bounds");
      frames += 1;
      if (frames > maxFrames) {
        // Caller maps this to its limit error; stop scanning immediately.
        return { kind: "gif", width, height, frames };
      }
      const localTable = bytes[at + 9] & 0x80
        ? 3 * (1 << ((bytes[at + 9] & 0x07) + 1))
        : 0;
      at += 10 + localTable + 1; // descriptor + table + LZW code size
      if (at > bytes.length) fail("gif/image-data");
      while (at < bytes.length && bytes[at] !== 0) {
        const end = at + bytes[at] + 1;
        if (end > bytes.length) fail("gif/image-data");
        at = end;
      }
      if (at >= bytes.length) fail("gif/image-end");
      at += 1;
    } else {
      fail("gif/block");
    }
  }
  if (frames === 0 || !sawTrailer) fail("gif/incomplete");
  return { kind: "gif", width, height, frames };
}

function bmpHeader(bytes: Uint8Array): ImageHeader {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) fail("bmp");
  const fileSize = u32le(bytes, 2);
  const pixelOffset = u32le(bytes, 10);
  const dibSize = u32le(bytes, 14);
  if (
    dibSize < 40 || 14 + dibSize > bytes.length ||
    fileSize !== bytes.length || pixelOffset < 14 + dibSize ||
    pixelOffset >= fileSize
  ) fail("bmp/dib");
  const width = u32le(bytes, 18);
  // Height may be negative (top-down); magnitude is the pixel height.
  const rawHeight = u32le(bytes, 22) | 0;
  if (width === 0 || rawHeight === 0 || u16le(bytes, 26) !== 1) {
    fail("bmp/dimensions");
  }
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
      return pngHeader(bytes, maxFrames);
    case "jpg":
      return jpegHeader(bytes);
    case "gif":
      return gifHeader(bytes, maxFrames);
    case "bmp":
      return bmpHeader(bytes);
  }
}
