import { IMAGE_MIME, MAX_IMAGE_EDGE, type ImageMime } from './commands/attachment.js';

export type ParsedImage = {
  mime: ImageMime;
  width: number;
  height: number;
};

const MIME_SET = new Set<string>(IMAGE_MIME);

export function parseImage(bytes: Uint8Array): ParsedImage | null {
  const png = parsePng(bytes);
  if (png) return { mime: 'image/png', ...png };
  const gif = parseGif(bytes);
  if (gif) return { mime: 'image/gif', ...gif };
  const webp = parseWebp(bytes);
  if (webp) return { mime: 'image/webp', ...webp };
  const jpeg = parseJpeg(bytes);
  if (jpeg) return { mime: 'image/jpeg', ...jpeg };
  return null;
}

export function imageWithinLimits(image: ParsedImage): boolean {
  return image.width <= MAX_IMAGE_EDGE && image.height <= MAX_IMAGE_EDGE && MIME_SET.has(image.mime);
}

function parsePng(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, index) => bytes[index] === byte)) return null;
  if (ascii(bytes, 12, 4) !== 'IHDR') return null;
  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  if (width < 1 || height < 1) return null;
  return { width, height };
}

function parseGif(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 10) return null;
  const signature = ascii(bytes, 0, 6);
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return null;
  const width = u8(bytes, 6) | (u8(bytes, 7) << 8);
  const height = u8(bytes, 8) | (u8(bytes, 9) << 8);
  if (width < 1 || height < 1) return null;
  return { width, height };
}

function parseWebp(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 16) return null;
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const size = readU32LE(bytes, offset + 4);
    const data = offset + 8;
    if (data > bytes.length) return null;
    if (type === 'VP8X' && size >= 10 && data + 10 <= bytes.length) {
      const width = 1 + (u8(bytes, data + 4) | (u8(bytes, data + 5) << 8) | (u8(bytes, data + 6) << 16));
      const height = 1 + (u8(bytes, data + 7) | (u8(bytes, data + 8) << 8) | (u8(bytes, data + 9) << 16));
      if (width < 1 || height < 1) return null;
      return { width, height };
    }
    if (type === 'VP8 ' && size >= 10 && data + 10 <= bytes.length) {
      if (u8(bytes, data + 3) !== 0x9d || u8(bytes, data + 4) !== 0x01 || u8(bytes, data + 5) !== 0x2a) return null;
      const width = (u8(bytes, data + 6) | (u8(bytes, data + 7) << 8)) & 0x3fff;
      const height = (u8(bytes, data + 8) | (u8(bytes, data + 9) << 8)) & 0x3fff;
      if (width < 1 || height < 1) return null;
      return { width, height };
    }
    if (type === 'VP8L' && size >= 5 && data + 5 <= bytes.length) {
      if (u8(bytes, data) !== 0x2f) return null;
      const bits =
        u8(bytes, data + 1) |
        (u8(bytes, data + 2) << 8) |
        (u8(bytes, data + 3) << 16) |
        (u8(bytes, data + 4) << 24);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      if (width < 1 || height < 1) return null;
      return { width, height };
    }
    const padded = size + (size & 1);
    offset = data + padded;
  }
  return null;
}

function parseJpeg(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < bytes.length) {
    if (u8(bytes, offset) !== 0xff) return null;
    while (offset < bytes.length && u8(bytes, offset) === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = u8(bytes, offset);
    offset += 1;
    if (marker === 0xd8) continue;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) return null;
    const segmentLength = (u8(bytes, offset) << 8) | u8(bytes, offset + 1);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (segmentLength < 7) return null;
      const height = (u8(bytes, offset + 3) << 8) | u8(bytes, offset + 4);
      const width = (u8(bytes, offset + 5) << 8) | u8(bytes, offset + 6);
      if (width < 1 || height < 1) return null;
      return { width, height };
    }
    offset += segmentLength;
  }
  return null;
}

function u8(bytes: Uint8Array, index: number): number {
  return bytes[index] ?? 0;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return text;
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000) +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)
  );
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) +
    ((bytes[offset + 1] ?? 0) << 8) +
    ((bytes[offset + 2] ?? 0) << 16) +
    ((bytes[offset + 3] ?? 0) * 0x1000000)
  );
}
