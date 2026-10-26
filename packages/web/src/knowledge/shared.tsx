import { useCallback } from 'react';
import { useAppNavigate } from '../app/context';
import { useToast } from '../ui/Toast';
import { libraryTarget } from './paths';

export const STATUS_LABEL: Readonly<Record<string, string>> = {
  active: '活跃',
  seed: '种子',
  needs_review: '待审',
};

export function statusLabel(status: string | null): string | null {
  if (status === null) return null;
  return STATUS_LABEL[status] ?? status;
}

export function statusTone(status: string | null): 'accent' | 'warn' | undefined {
  if (status === 'active') return 'accent';
  if (status === 'needs_review') return 'warn';
  return undefined;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Copies a display path (home already shortened to `~`) and confirms with a toast. */
export function useCopyPath(): (path: string) => void {
  const toast = useToast();
  return useCallback(
    (path: string) => {
      void navigator.clipboard?.writeText(path).then(
        () => toast.show('已复制路径'),
        () => toast.show('复制失败，浏览器没有允许访问剪贴板'),
      );
    },
    [toast],
  );
}

/** Opens a library-relative path: files in the reader, folders as topics. */
export function useOpenInLibrary(library: string): (path: string) => void {
  const navigate = useAppNavigate();
  return useCallback((path: string) => navigate(libraryTarget(library, path)), [navigate, library]);
}

/** Display name of a category directory: `02_职业与业务` → `职业与业务`. */
export function categoryName(dir: string): string {
  return /^\d{2}_(.+)$/.exec(dir)?.[1] ?? dir;
}
