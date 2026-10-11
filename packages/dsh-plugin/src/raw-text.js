/**
 * 详情里是否显示原文。client.js 内嵌同一份文本（测试会核对）。
 * 比较时忽略首尾空白和连续空白的差异。
 */

export function foldSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function shouldShowRaw(body, rawInput) {
  if (!rawInput || rawInput.status === 'legacy') return false;
  const raw = foldSpace(rawInput.text);
  if (raw === '') return false;
  const folded = foldSpace(body);
  if (folded === raw) return false;
  if (folded.includes(raw)) return false;
  return true;
}
