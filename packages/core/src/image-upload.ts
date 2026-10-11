import { createHash } from 'node:crypto';
import { readLimitedBody } from './body.js';
import { MAX_IMAGE_BYTES, MAX_IMAGE_EDGE, type ImageMime } from './commands/attachment.js';
import { imageWithinLimits, parseImage } from './images.js';

const EXTENSION_MIME: Record<string, ImageMime> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export type ImageUploadMeta = {
  /** 文件名，只用来核对扩展名。 */
  name?: string | null;
  /** 请求头里的 Content-Type。 */
  contentType?: string | null;
};

export type CheckedImageUpload = {
  ok: true;
  bytes: Buffer;
  mime: ImageMime;
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
};

export type RejectedImageUpload = {
  ok: false;
  message: string;
};

function extensionOf(name: string): string | null {
  const base = name.split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot).toLowerCase();
}

function declaredMime(contentType: string | null | undefined): string | null {
  if (!contentType) return null;
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (mediaType === '' || mediaType === 'application/octet-stream') return null;
  return mediaType;
}

/**
 * 校验已读到内存的图片字节。类型只看文件头；扩展名或 Content-Type 与文件头不一致时拒绝。
 * 规则见 idea-rules.md 第 8 节。
 */
export function checkImageBytes(bytes: Buffer, meta: ImageUploadMeta = {}): CheckedImageUpload | RejectedImageUpload {
  const parsed = parseImage(bytes);
  if (!parsed) return { ok: false, message: '只接受 jpeg、png、gif、webp 图片' };
  if (!imageWithinLimits(parsed) || parsed.width > MAX_IMAGE_EDGE || parsed.height > MAX_IMAGE_EDGE) {
    return { ok: false, message: '图片宽高不能超过 16384 像素' };
  }

  if (meta.name) {
    const extension = extensionOf(meta.name);
    if (extension !== null && EXTENSION_MIME[extension] !== parsed.mime) {
      return { ok: false, message: '文件内容与扩展名不符' };
    }
  }
  const headerMime = declaredMime(meta.contentType);
  if (headerMime !== null && headerMime !== parsed.mime) {
    return { ok: false, message: '文件内容与声明的类型不符' };
  }

  return {
    ok: true,
    bytes,
    mime: parsed.mime,
    byteSize: bytes.byteLength,
    width: parsed.width,
    height: parsed.height,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

/** 读取上传的请求体（不超过 8 MB）并校验。 */
export async function readImageUpload(
  body: ReadableStream<Uint8Array> | null,
  meta: ImageUploadMeta = {},
): Promise<CheckedImageUpload | RejectedImageUpload> {
  const limited = await readLimitedBody(body, MAX_IMAGE_BYTES);
  if (!limited.ok) {
    return { ok: false, message: limited.reason === 'too_large' ? '单张图片不能超过 8 MB' : '没有收到图片' };
  }
  return checkImageBytes(limited.bytes, meta);
}
