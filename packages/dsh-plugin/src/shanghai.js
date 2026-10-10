export const SHANGHAI = 'Asia/Shanghai';

const WEEKDAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export function pad(value) {
  return value < 10 ? '0' + value : String(value);
}

export function shanghaiParts(ms) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: SHANGHAI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const bag = {};
  for (const part of fmt.formatToParts(new Date(ms))) bag[part.type] = part.value;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    weekday: bag.weekday,
  };
}

export function dayKey(ms) {
  const parts = shanghaiParts(ms);
  return parts.year + '-' + pad(parts.month) + '-' + pad(parts.day);
}

export function shiftDay(key, delta) {
  const [year, month, day] = key.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + delta);
  return utc.getUTCFullYear() + '-' + pad(utc.getUTCMonth() + 1) + '-' + pad(utc.getUTCDate());
}

export function formatDayLabel(key, nowMs) {
  const [year, month, day] = key.split('-').map(Number);
  const text = month + '月' + day + '日';
  return year === shanghaiParts(nowMs).year ? text : year + '年' + text;
}

export function relativeTime(iso, nowMs) {
  const created = Date.parse(iso);
  if (!Number.isFinite(created)) return '';
  const key = dayKey(created);
  const today = dayKey(nowMs);
  if (key === today) {
    const diff = Math.max(0, nowMs - created);
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    return Math.floor(diff / 3600000) + ' 小时前';
  }
  if (key === shiftDay(today, -1)) return '昨天';
  return formatDayLabel(key, nowMs);
}

export function mondayKey(nowMs) {
  const weekday = WEEKDAY_INDEX[shanghaiParts(nowMs).weekday] ?? 0;
  return shiftDay(dayKey(nowMs), -weekday);
}

export function summarizeCounts(cards, nowMs) {
  const today = dayKey(nowMs);
  const monday = mondayKey(nowMs);
  const monthPrefix = today.slice(0, 7);
  let week = 0;
  let month = 0;
  let starred = 0;
  for (const card of cards) {
    const key = dayKey(Date.parse(card.createdAt));
    if (key >= monday && key <= today) week += 1;
    if (key.startsWith(monthPrefix)) month += 1;
    if (card.starred) starred += 1;
  }
  return { all: cards.length, week, month, starred };
}

export function heatmapWeeks(cards, columns, nowMs) {
  const today = dayKey(nowMs);
  const weekday = WEEKDAY_INDEX[shanghaiParts(nowMs).weekday] ?? 0;
  const end = shiftDay(today, 6 - weekday);
  const start = shiftDay(end, -(columns * 7 - 1));
  const counts = new Map();
  for (const card of cards) {
    const key = dayKey(Date.parse(card.createdAt));
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const weeks = [];
  for (let column = 0; column < columns; column += 1) {
    const days = [];
    for (let row = 0; row < 7; row += 1) {
      const key = shiftDay(start, column * 7 + row);
      const future = key > today;
      days.push({ key, count: future ? 0 : counts.get(key) || 0, future });
    }
    weeks.push(days);
  }
  return weeks;
}
