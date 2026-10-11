/** 所有日期按上海时区（idea-ui 第 2 节）。 */
export const SHANGHAI = 'Asia/Shanghai';

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: SHANGHAI,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

export function shanghaiParts(ms: number): Parts {
  const bag: Record<string, string> = {};
  for (const part of PARTS.formatToParts(new Date(ms))) bag[part.type] = part.value;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 上海自然日的序号，用于比较「相差几天」。 */
export function shanghaiDayNumber(ms: number): number {
  const { year, month, day } = shanghaiParts(ms);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export type DayGroup = 'today' | 'yesterday' | 'week' | 'earlier';

export const DAY_GROUP_LABEL: Record<DayGroup, string> = {
  today: '今天',
  yesterday: '昨天',
  week: '本周',
  earlier: '更早',
};

/** 今天、昨天、本周（7 天内）、更早。未来的时间（时钟偏差）算今天。 */
export function dayGroup(iso: string, nowMs: number): DayGroup {
  const diff = shanghaiDayNumber(nowMs) - shanghaiDayNumber(Date.parse(iso));
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 7) return 'week';
  return 'earlier';
}

export function formatClock(ms: number): string {
  const { hour, minute } = shanghaiParts(ms);
  return `${pad(hour)}:${pad(minute)}`;
}

/** 列表时间：今天和昨天显示「14:05」，更早显示「10月3日」，不是今年的加年份。 */
export function formatListTime(iso: string, nowMs: number): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const group = dayGroup(iso, nowMs);
  if (group === 'today' || group === 'yesterday') return formatClock(ms);
  const { year, month, day } = shanghaiParts(ms);
  const text = `${month}月${day}日`;
  return year === shanghaiParts(nowMs).year ? text : `${year}年${text}`;
}

/** 上海自然日序号还原成「10月9日」；不是今年的加年份。 */
export function formatDayNumber(day: number, nowMs: number): string {
  const ms = day * 86_400_000;
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const dayOfMonth = date.getUTCDate();
  const text = `${month}月${dayOfMonth}日`;
  return year === shanghaiParts(nowMs).year ? text : `${year}年${text}`;
}

/** 详情里的完整时间「2026-10-11 09:42」。 */
export function formatFullTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const { year, month, day } = shanghaiParts(ms);
  return `${year}-${pad(month)}-${pad(day)} ${formatClock(ms)}`;
}
