export type ImageSlot = {
  key: string;
  requestId: string;
  phase: 'uploading' | 'failed' | 'ready';
  progress: number;
  message: string | null;
  file: File | null;
  attachmentId: string | null;
  previewUrl: string | null;
  remoteUrl: string | null;
};

export const MAX_IMAGES = 4;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export function isImageFile(file: File): boolean {
  if (IMAGE_TYPES.has(file.type)) return true;
  return /\.(jpe?g|png|gif|webp)$/i.test(file.name);
}

export function slotsFromRecord(record: { attachments: { id: string; url: string }[] }): ImageSlot[] {
  return record.attachments.map((image) => ({
    key: image.id,
    requestId: '',
    phase: 'ready' as const,
    progress: 1,
    message: null,
    file: null,
    attachmentId: image.id,
    previewUrl: null,
    remoteUrl: image.url,
  }));
}
