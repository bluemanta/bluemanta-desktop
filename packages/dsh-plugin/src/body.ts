/** 读到 maxBytes + 1 就停，避免把超限文件整段放进内存。 */
export async function readLimitedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; reason: 'empty' | 'too_large' }> {
  if (!body) return { ok: false, reason: 'empty' };
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      const value = step.value;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) return { ok: false, reason: 'empty' };
  return { ok: true, bytes: Buffer.concat(chunks, total) };
}
