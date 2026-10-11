import {
  DESKTOP_SOURCE,
  IMAGE_EXTENSION,
  readImageUpload,
  readStoredFile,
  statusForCommandCode,
  writeStoredFile,
  type Attachment,
  type AttachmentCreateInput,
  type CommandResult,
  type ImageMime,
} from '@bluemanta/core';

export const ATTACHMENTS_PATH = '/api/bluemanta/attachments';
export const ATTACHMENT_PATH = '/api/bluemanta/attachment';

const JSON_HEADERS = { 'cache-control': 'no-store' };

export type UploadGateway = {
  dataDir: string;
  attachment: {
    create: (input: AttachmentCreateInput) => CommandResult<Attachment>;
  };
};

export type AttachmentReadGateway = {
  dataDir: string;
  getAttachment: (id: string) => Attachment | null;
};

function failure(status: number, message: string, code = 'invalid_input'): Response {
  return Response.json({ ok: false, code, message }, { status, headers: JSON_HEADERS });
}

function singleParam(params: URLSearchParams, key: string): { ok: true; value: string | null } | { ok: false } {
  const values = params.getAll(key);
  if (values.length > 1) return { ok: false };
  return { ok: true, value: values[0] ?? null };
}

/**
 * `POST /api/bluemanta/attachments?requestId=&name=`
 * 请求体是图片字节。类型只看文件头；扩展名或 Content-Type 与文件头不一致时拒绝。
 */
export async function handleAttachmentUpload(core: UploadGateway, request: Request): Promise<Response> {
  if (request.method !== 'POST') return failure(405, '只接受 POST');

  const params = new URL(request.url).searchParams;
  const requestId = singleParam(params, 'requestId');
  if (!requestId.ok) return failure(400, 'requestId 只能出现一次');
  const name = singleParam(params, 'name');
  if (!name.ok) return failure(400, 'name 只能出现一次');
  if (requestId.value === null || requestId.value.trim() === '') return failure(400, 'requestId 不能为空');

  const checked = await readImageUpload(request.body, {
    name: name.value,
    contentType: request.headers.get('content-type'),
  });
  if (!checked.ok) return failure(400, checked.message);

  const created = core.attachment.create({
    requestId: requestId.value,
    source: DESKTOP_SOURCE,
    mime: checked.mime,
    byteSize: checked.byteSize,
    width: checked.width,
    height: checked.height,
    sha256: checked.sha256,
  });
  if (!created.ok) return failure(statusForCommandCode(created.code), created.message, created.code);

  try {
    writeStoredFile(core.dataDir, created.record.path, checked.bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : '图片没有写入';
    return failure(500, message, 'invalid_input');
  }
  return Response.json(created, { headers: JSON_HEADERS });
}

/** `GET /api/bluemanta/attachment?id=` */
export function handleAttachmentRead(core: AttachmentReadGateway, request: Request): Response {
  if (request.method !== 'GET') return failure(405, '只接受 GET');
  const params = new URL(request.url).searchParams;
  const id = singleParam(params, 'id');
  if (!id.ok) return failure(400, 'id 只能出现一次');
  if (id.value === null || id.value.trim() === '') return failure(400, 'id 不能为空');

  const attachment = core.getAttachment(id.value);
  if (!attachment) return failure(404, '附件不存在', 'not_found');
  const bytes = readStoredFile(core.dataDir, attachment.path);
  if (!bytes) return failure(404, '附件不存在', 'not_found');
  if (IMAGE_EXTENSION[attachment.mime as ImageMime] === undefined && !attachment.mime.startsWith('image/')) {
    return failure(404, '附件不存在', 'not_found');
  }
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': attachment.mime,
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
