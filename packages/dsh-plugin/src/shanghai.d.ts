export const SHANGHAI: 'Asia/Shanghai';

export function pad(value: number): string;

export interface ShanghaiParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string | undefined;
}

export function shanghaiParts(ms: number): ShanghaiParts;

export function dayKey(ms: number): string;

export function shiftDay(key: string, delta: number): string;

export function formatDayLabel(key: string, nowMs: number): string;

export function relativeTime(iso: string, nowMs: number): string;

export function mondayKey(nowMs: number): string;

export interface CountCard {
  createdAt: string;
  starred: boolean;
}

export interface Counts {
  all: number;
  week: number;
  month: number;
  starred: number;
}

export function summarizeCounts(cards: readonly CountCard[], nowMs: number): Counts;

export interface HeatDay {
  key: string;
  count: number;
  future: boolean;
}

export function heatmapWeeks(
  cards: readonly CountCard[],
  columns: number,
  nowMs: number,
): HeatDay[][];
