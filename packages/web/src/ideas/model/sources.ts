import type { ApiSource } from '@bluemanta/server/api-types';

/**
 * 列表和详情里的来源徽标。名字来自写入方：Grok Bot 经命令行写入时默认 `bot`，
 * dsh 里的 agent 是 `dsh-agent`，MCP 没报客户端名时是 `mcp`，网页是 `desktop`，
 * workbench 导入时缺来源的记录是 `legacy_unknown`。其他名字原样显示。
 */
export function sourceLabel(source: ApiSource): string {
  const name = source.name.trim();
  const lower = name.toLowerCase();
  if (lower === 'bot' || lower.includes('grok')) return 'Grok Bot';
  if (lower === 'dsh-agent') return '对话 agent';
  if (lower === 'mcp') return 'MCP';
  if (source.kind === 'human' && lower === 'desktop') return '灵感台';
  if (lower === 'legacy_unknown' || lower === 'workbench') return '导入';
  return name === '' ? '未知' : name;
}
