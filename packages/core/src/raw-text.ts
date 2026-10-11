import type { RawInput } from './types.js';

/**
 * 详情里是否显示原文，规则见 idea-ui.md 第 3 节。
 * 比较时忽略首尾空白和连续空白的差异。dsh 插件的 client.js 内嵌同一套判断（插件测试会核对）。
 */

export function foldSpace(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

type RawLike = RawInput | { status: 'present'; channel?: string; text?: string } | null | undefined;

export function shouldShowRaw(body: string | null | undefined, rawInput: RawLike): boolean {
  if (!rawInput || rawInput.status === 'legacy') return false;
  const raw = foldSpace(rawInput.text);
  if (raw === '') return false;
  const folded = foldSpace(body);
  if (folded === raw) return false;
  if (folded.includes(raw)) return false;
  return true;
}
