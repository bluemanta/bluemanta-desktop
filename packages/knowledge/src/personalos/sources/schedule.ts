/** Chinese schedule text and next-run times (spec personalos-sources 3.1, 3.3). All times are local. */
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const pad = (value: number): string => String(value).padStart(2, '0');
const clock = (hour: number, minute: number): string => `${hour}:${pad(minute)}`;
const startOfDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date: Date, days: number): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const SEARCH_DAYS = 800;

export interface CalendarEntry { Minute?: number; Hour?: number; Day?: number; Weekday?: number; Month?: number }
export function calendarEntries(raw: unknown): CalendarEntry[] | null {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : null;
  if (!list) return null;
  return list.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)).map((item) => {
    const entry: CalendarEntry = {};
    for (const key of ['Minute', 'Hour', 'Day', 'Weekday', 'Month'] as const) if (typeof item[key] === 'number') entry[key] = item[key] as number;
    return entry;
  });
}
export function describeCalendarEntry(entry: CalendarEntry): string {
  const minute = entry.Minute; const hour = entry.Hour;
  const time = hour !== undefined ? clock(hour, minute ?? 0) : minute !== undefined ? `每小时第 ${minute} 分` : '每分钟';
  const weekday = entry.Weekday !== undefined ? `周${WEEKDAYS[entry.Weekday % 7]}` : null;
  const parts: string[] = [];
  if (entry.Month !== undefined) parts.push(`每年 ${entry.Month} 月${entry.Day !== undefined ? ` ${entry.Day} 日` : ''}`);
  else if (entry.Day !== undefined) parts.push(`每月 ${entry.Day} 日`);
  if (weekday) parts.push(entry.Day !== undefined || entry.Month !== undefined ? `或${weekday}` : `每${weekday}`);
  if (parts.length === 0) return hour !== undefined ? `每天 ${time}` : time;
  return `${parts.join('')} ${time}`;
}
export function describeCalendar(entries: CalendarEntry[]): string { return entries.map(describeCalendarEntry).join('；'); }

function nextForEntry(entry: CalendarEntry, now: Date): Date | null {
  const today = startOfDay(now);
  for (let offset = 0; offset < SEARCH_DAYS; offset += 1) {
    const day = addDays(today, offset);
    if (entry.Month !== undefined && day.getMonth() + 1 !== entry.Month) continue;
    // launchd, like cron, fires when either Day or Weekday matches if both are set.
    const dayOk = entry.Day === undefined || day.getDate() === entry.Day; const weekOk = entry.Weekday === undefined || day.getDay() === entry.Weekday % 7;
    if (entry.Day !== undefined && entry.Weekday !== undefined ? !(dayOk || weekOk) : !(dayOk && weekOk)) continue;
    const hours = entry.Hour !== undefined ? [entry.Hour] : [...Array(24).keys()];
    const minutes = entry.Minute !== undefined ? [entry.Minute] : [...Array(60).keys()];
    for (const hour of hours) for (const minute of minutes) {
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
      if (at > now) return at;
    }
  }
  return null;
}
export function nextCalendarRun(entries: CalendarEntry[], now: Date): Date | null {
  return entries.map((entry) => nextForEntry(entry, now)).filter((item): item is Date => item !== null).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
}
export function describeInterval(seconds: number): string {
  if (seconds % 3600 === 0) return `每 ${seconds / 3600} 小时`;
  if (seconds % 60 === 0) return `每 ${seconds / 60} 分钟`;
  return `每 ${seconds} 秒`;
}

/** RRULE subset: FREQ HOURLY/DAILY/WEEKLY/MONTHLY, INTERVAL, BYDAY, BYMONTHDAY, BYHOUR, BYMINUTE, UNTIL, COUNT, optional DTSTART line. */
export interface Rrule { freq: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY'; interval: number; byDay: number[] | null; byMonthDay: number[] | null; byHour: number[] | null; byMinute: number[] | null; until: Date | null; count: number | null; start: Date | null; tzid: string | null }
const DAY_CODES: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
function rruleDate(text: string): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(text.trim()); if (!match) return null;
  const [y, mo, d, h = '0', mi = '0', s = '0'] = match.slice(1, 7).map((part) => part ?? '0') as string[];
  return match[7] ? new Date(Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +s)) : new Date(+y!, +mo! - 1, +d!, +h, +mi, +s);
}
const numbers = (text: string): number[] | null => { const list = text.split(',').map((item) => Number(item)); return list.every((item) => Number.isInteger(item)) ? list : null; };
export function parseRrule(text: string): Rrule | null {
  let start: Date | null = null; let tzid: string | null = null; let ruleText = '';
  for (const line of text.split(/\r?\n|\\n/).map((item) => item.trim()).filter(Boolean)) {
    const dtstart = /^DTSTART(?:;TZID=([^:]+))?:(.+)$/.exec(line);
    if (dtstart) { tzid = dtstart[1] ?? null; start = rruleDate(dtstart[2]!); if (!start) return null; continue; }
    ruleText = line.replace(/^RRULE:/, '');
  }
  const fields = new Map(ruleText.split(';').filter(Boolean).map((part) => { const [key, value = ''] = part.split('=', 2); return [key!.toUpperCase(), value] as const; }));
  const freq = fields.get('FREQ');
  if (freq !== 'HOURLY' && freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') return null;
  for (const key of fields.keys()) if (!['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'BYHOUR', 'BYMINUTE', 'BYSECOND', 'UNTIL', 'COUNT', 'WKST'].includes(key)) return null;
  const rule: Rrule = { freq, interval: 1, byDay: null, byMonthDay: null, byHour: null, byMinute: null, until: null, count: null, start, tzid };
  if (fields.has('INTERVAL')) { const value = Number(fields.get('INTERVAL')); if (!Number.isInteger(value) || value < 1) return null; rule.interval = value; }
  if (fields.has('BYDAY')) { const days = fields.get('BYDAY')!.split(','); if (!days.every((day) => day in DAY_CODES)) return null; rule.byDay = days.map((day) => DAY_CODES[day]!); }
  for (const [key, prop] of [['BYMONTHDAY', 'byMonthDay'], ['BYHOUR', 'byHour'], ['BYMINUTE', 'byMinute']] as const) {
    if (fields.has(key)) { const list = numbers(fields.get(key)!); if (!list) return null; rule[prop] = list; }
  }
  if (fields.has('UNTIL')) { rule.until = rruleDate(fields.get('UNTIL')!); if (!rule.until) return null; }
  if (fields.has('COUNT')) { const value = Number(fields.get('COUNT')); if (!Number.isInteger(value) || value < 1) return null; rule.count = value; }
  return rule;
}
const list = (values: number[], format: (value: number) => string): string => values.map(format).join('、');
export function describeRrule(rule: Rrule): string {
  const minute = rule.byMinute?.[0] ?? rule.start?.getMinutes() ?? 0;
  const times = (rule.byHour ?? [rule.start?.getHours() ?? 0]).map((hour) => clock(hour, minute)).join('、');
  if (rule.count === 1 && rule.start) return `一次：${rule.start.getFullYear()}-${pad(rule.start.getMonth() + 1)}-${pad(rule.start.getDate())} ${clock(rule.start.getHours(), rule.start.getMinutes())}`;
  const every = (unit: string): string => rule.interval === 1 ? `每${unit}` : `每 ${rule.interval} ${unit}`;
  switch (rule.freq) {
    case 'HOURLY': return `${every('小时')}第 ${minute} 分`;
    case 'DAILY': return `${rule.interval === 1 ? '每天' : `每 ${rule.interval} 天`} ${times}`;
    case 'WEEKLY': {
      const days = rule.byDay ?? (rule.start ? [rule.start.getDay()] : []);
      return `${rule.interval === 1 ? '每' : `每 ${rule.interval} 周的`}${list(days, (day) => `周${WEEKDAYS[day]}`)} ${times}`;
    }
    case 'MONTHLY': return `${every('月')} ${list(rule.byMonthDay ?? [rule.start?.getDate() ?? 1], (day) => `${day} 日`)} ${times}`;
  }
}
const monday = (date: Date): Date => addDays(startOfDay(date), -((date.getDay() + 6) % 7));
const weeksBetween = (later: Date, earlier: Date): number => Math.round((monday(later).getTime() - monday(earlier).getTime()) / 604_800_000);
/**
 * Next occurrence after `now`. Returns `null` when it cannot be known: INTERVAL > 1 or COUNT without DTSTART (the runner's
 * anchor is not in the file), or nothing within the search window. `ended` is true when UNTIL or COUNT has passed.
 */
export function nextRruleRun(rule: Rrule, now: Date): { next: Date | null; ended: boolean } {
  if ((rule.interval > 1 || rule.count !== null) && !rule.start) return { next: null, ended: rule.until !== null && rule.until < now };
  const anchor = rule.start ?? now; let seen = 0;
  const from = rule.start && rule.start < now ? startOfDay(rule.start) : startOfDay(now);
  const span = Math.max(SEARCH_DAYS, Math.ceil((now.getTime() - from.getTime()) / 86_400_000) + SEARCH_DAYS);
  for (let offset = 0; offset < span; offset += 1) {
    const day = addDays(from, offset);
    const dayDiff = Math.round((startOfDay(day).getTime() - startOfDay(anchor).getTime()) / 86_400_000);
    if (rule.freq === 'DAILY' && ((dayDiff % rule.interval) + rule.interval) % rule.interval !== 0) continue;
    if (rule.freq === 'WEEKLY') {
      const days = rule.byDay ?? [anchor.getDay()];
      if (!days.includes(day.getDay())) continue;
      if ((weeksBetween(day, anchor) % rule.interval + rule.interval) % rule.interval !== 0) continue;
    } else if (rule.byDay && !rule.byDay.includes(day.getDay())) continue;
    if (rule.freq === 'MONTHLY') {
      if (!(rule.byMonthDay ?? [anchor.getDate()]).includes(day.getDate())) continue;
      const months = (day.getFullYear() - anchor.getFullYear()) * 12 + day.getMonth() - anchor.getMonth();
      if ((months % rule.interval + rule.interval) % rule.interval !== 0) continue;
    } else if (rule.byMonthDay && !rule.byMonthDay.includes(day.getDate())) continue;
    let hours = rule.byHour ?? (rule.freq === 'HOURLY' ? [...Array(24).keys()] : [anchor.getHours()]);
    if (rule.freq === 'HOURLY' && !rule.byHour && rule.interval > 1) hours = hours.filter((hour) => (((dayDiff * 24 + hour - anchor.getHours()) % rule.interval) + rule.interval) % rule.interval === 0);
    const minutes = rule.byMinute ?? [rule.start ? anchor.getMinutes() : 0];
    for (const hour of [...hours].sort((a, b) => a - b)) for (const minute of [...minutes].sort((a, b) => a - b)) {
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
      if (rule.start && at < rule.start) continue;
      if (rule.until && at > rule.until) return { next: null, ended: true };
      seen += 1;
      if (rule.count !== null && seen > rule.count) return { next: null, ended: true };
      if (at > now) return { next: at, ended: false };
    }
  }
  return { next: null, ended: false };
}
