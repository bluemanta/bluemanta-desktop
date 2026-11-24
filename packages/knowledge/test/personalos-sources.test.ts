import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeError } from '../src/types.js';
import {
  SourcesReader, describeCalendar, describeRrule, isSelfBuilt, levelFor, measureFreshness, nextCalendarRun, nextRruleRun,
  parseInterval, parseLaunchctlList, parsePlist, parseRrule, parseRunLog, parseSourcesRegistry, readCodexFields, redactArgument,
} from '../src/personalos/sources/index.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/sources', import.meta.url));
const LIST = readFileSync(join(FIXTURE, 'launchctl-list.txt'), 'utf8');
/** Tuesday 2026-11-24 10:30 local time; every expectation below is built with local Date constructors. */
const NOW = new Date(2026, 10, 24, 10, 30);
const HOUR = 3_600_000;
const temporary: string[] = [];
afterEach(() => { while (temporary.length) rmSync(temporary.pop()!, { recursive: true, force: true }); });

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bm-sources-test-')); temporary.push(dir);
  cpSync(join(FIXTURE, 'home'), dir, { recursive: true });
  // Git does not keep mtimes: the directory probe is two days old, which is 偏旧 for a one-day interval.
  const old = new Date(NOW.getTime() - 48 * HOUR);
  utimesSync(join(dir, 'vault/notes/a.md'), old, old); utimesSync(join(dir, 'vault/notes'), old, old);
  return dir;
}
function reader(home: string, list: string | null = LIST): SourcesReader {
  return new SourcesReader({ home, now: () => NOW, launchctlList: async () => list });
}
function snapshot(dir: string): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else result[full] = `${createHash('sha256').update(readFileSync(full)).digest('hex')}:${statSync(full).mtimeMs}`;
    }
  };
  walk(dir); return result;
}
const iso = (...parts: [number, number, number, number, number]): string => new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4]).toISOString();

describe('登记表（规格 1）', () => {
  const home = '/home/example';
  const markdown = readFileSync(join(FIXTURE, 'home/Documents/PersonalOS/我/数据源.md'), 'utf8');
  const registry = parseSourcesRegistry(markdown, { home, stat: () => false });

  it('按表头找表，列顺序不固定，空名称行跳过', () => {
    expect(registry.sources.map((source) => source.name)).toEqual(['示例聊天', '示例笔记', '示例社区', '示例书签', '示例推送']);
    expect(registry.tasks.map((task) => task.ref)).toContain('codex:weekly-report');
    expect(registry.tasks.find((task) => task.ref === 'launchd:local.example.mirror-refresh')).toMatchObject({ name: '示例副本刷新', logVisible: true, log: '~/vault/logs/refresh.log' });
  });
  it('解析方式、间隔、探针、成功标记和来源卡', () => {
    const chat = registry.sources[0]!;
    expect(chat).toMatchObject({
      method: '副本', taskRefs: ['launchd:local.example.mirror-refresh'], interval: { text: '1 小时', ms: HOUR },
      probe: '~/vault/logs/refresh.log', successMarks: ['成功', '资源告警'], card: { title: '示例聊天', path: '我/状态.md', anchor: '示例聊天' },
    });
    expect(chat.location).toEqual({ kind: 'local', display: '~/vault/copy/', exists: false });
    expect(registry.sources[1]).toMatchObject({ interval: { text: '1 天' }, successMarks: ['成功'], taskRefs: [], card: null });
    expect(registry.sources[2]!.location).toEqual({ kind: 'other', display: 'example-mcp' });
    expect(registry.sources[4]).toMatchObject({ method: '登记', methodRaw: '手动' });
  });
  it('「忽略」和写错的标识', () => {
    expect(registry.tasks.find((task) => task.ref === 'claude:demo-check')?.ignored).toBe(true);
    expect(registry.tasks.find((task) => task.ref === 'example-without-runner')?.runner).toBeNull();
    expect(registry.warnings.map((warning) => warning.code)).toEqual(['task_ref_invalid']);
  });
  it('间隔写法', () => {
    expect(parseInterval('30 分钟')?.ms).toBe(30 * 60_000);
    expect(parseInterval('2周')?.text).toBe('2 周');
    expect(parseInterval('每小时')).toBeNull();
    expect(parseInterval('0 天')).toBeNull();
  });
});

describe('新鲜度（规格 2）', () => {
  it('三档边界', () => {
    const at = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);
    expect(levelFor(at(90), HOUR, NOW)).toBe('ok');
    expect(levelFor(new Date(at(90).getTime() - 1), HOUR, NOW)).toBe('aging');
    expect(levelFor(at(180), HOUR, NOW)).toBe('aging');
    expect(levelFor(new Date(at(180).getTime() - 1), HOUR, NOW)).toBe('stale');
    expect(levelFor(null, HOUR, NOW)).toBe('stale');
    expect(levelFor(at(1), null, NOW)).toBe('none');
  });
  it('运行日志：最后运行和最后成功分开，非记录行忽略', () => {
    const log = parseRunLog('2026-11-24T08:05:02 成功\n杂行\n2026-11-24 09:05 资源告警 说明\n2026-11-24T10:05:01 失败', ['成功', '资源告警']);
    expect(log?.lastRun).toEqual({ at: new Date(2026, 10, 24, 10, 5, 1), status: '失败' });
    expect(log?.lastSuccess).toEqual(new Date(2026, 10, 24, 9, 5));
    expect(parseRunLog('没有时间戳的日志', ['成功'])).toBeNull();
  });
  it('没有成功记录算过期；探针不存在单独标出', () => {
    const dir = sandbox(); const file = join(dir, 'only-failures.log');
    writeFileSync(file, '2026-11-24T10:00:00 失败\n');
    expect(measureFreshness(file, { intervalMs: HOUR, successMarks: ['成功'], now: NOW })).toMatchObject({ level: 'stale', lastSuccessAt: null, mode: 'log' });
    expect(measureFreshness(join(dir, 'nope'), { intervalMs: HOUR, successMarks: ['成功'], now: NOW }).level).toBe('probe_missing');
  });
  it('目录探针取自身和直接子项中最晚的修改时间', () => {
    const dir = sandbox(); const recent = new Date(NOW.getTime() - HOUR);
    utimesSync(join(dir, 'vault/notes/a.md'), recent, recent);
    expect(measureFreshness(join(dir, 'vault/notes'), { intervalMs: 24 * HOUR, successMarks: ['成功'], now: NOW })).toMatchObject({ level: 'ok', mode: 'mtime', lastSuccessAt: recent.toISOString() });
  });
  it('只读日志最后 64 KB', () => {
    const dir = sandbox(); const file = join(dir, 'big.log');
    writeFileSync(file, `2026-11-24T10:00:00 成功\n${'x'.repeat(70 * 1024)}\n2026-11-20T10:00:00 失败\n`);
    expect(measureFreshness(file, { intervalMs: HOUR, successMarks: ['成功'], now: NOW })).toMatchObject({ level: 'stale', lastSuccessAt: null, lastRun: { status: '失败' } });
  });
});

describe('plist 与时间（规格 3.1）', () => {
  it('解析 dict、array、实体、注释、自闭合标签', () => {
    const value = parsePlist(readFileSync(join(FIXTURE, 'home/Library/LaunchAgents/com.apple.example-checkin.plist')));
    expect(value).toMatchObject({ Label: 'com.apple.example-checkin', ProgramArguments: ['/usr/bin/python3', '/opt/example/checkin.py', '--mode', 'primary & verify'] });
    expect(parsePlist('<plist><dict><key>A</key><true/><key>B</key><array/><key>C</key><real>1.5</real><key>D</key><string/></dict></plist>')).toEqual({ A: true, B: [], C: 1.5, D: '' });
    expect(() => parsePlist('bplist00')).toThrow();
    expect(() => parsePlist('<plist><dict><key>A</key></dict></plist>')).toThrow();
  });
  it('中文时间', () => {
    expect(describeCalendar([{ Minute: 5 }])).toBe('每小时第 5 分');
    expect(describeCalendar([{ Hour: 9, Minute: 0 }, { Hour: 19, Minute: 30 }])).toBe('每天 9:00；每天 19:30');
    expect(describeCalendar([{ Weekday: 0, Hour: 8 }])).toBe('每周日 8:00');
    expect(describeCalendar([{ Weekday: 7, Hour: 8 }])).toBe('每周日 8:00');
    expect(describeCalendar([{ Day: 1, Hour: 9, Minute: 0 }])).toBe('每月 1 日 9:00');
    expect(describeCalendar([{ Month: 3, Day: 15, Hour: 6, Minute: 30 }])).toBe('每年 3 月 15 日 6:30');
    expect(describeCalendar([{}])).toBe('每分钟');
  });
  it('下次运行：当天、跨周、跨月、周日 0 和 7', () => {
    expect(nextCalendarRun([{ Minute: 5 }], NOW)?.toISOString()).toBe(iso(2026, 11, 24, 11, 5));
    expect(nextCalendarRun([{ Hour: 9, Minute: 0 }, { Hour: 19, Minute: 30 }], NOW)?.toISOString()).toBe(iso(2026, 11, 24, 19, 30));
    expect(nextCalendarRun([{ Weekday: 7, Hour: 8, Minute: 0 }], NOW)?.toISOString()).toBe(iso(2026, 11, 29, 8, 0));
    expect(nextCalendarRun([{ Weekday: 0, Hour: 8, Minute: 0 }], NOW)?.toISOString()).toBe(iso(2026, 11, 29, 8, 0));
    expect(nextCalendarRun([{ Day: 31, Hour: 9, Minute: 0 }], NOW)?.toISOString()).toBe(iso(2026, 12, 31, 9, 0));
    expect(nextCalendarRun([{ Day: 1, Hour: 9, Minute: 0 }], NOW)?.toISOString()).toBe(iso(2026, 12, 1, 9, 0));
  });
  it('自建判断不看标识前缀', () => {
    const home = '/Users/example';
    expect(isSelfBuilt('/usr/bin/python3', home)).toBe(true);
    expect(isSelfBuilt('/usr/bin/python3.12', home)).toBe(true);
    expect(isSelfBuilt('/bin/zsh', home)).toBe(true);
    expect(isSelfBuilt(`${home}/Developer/tool/run`, home)).toBe(true);
    expect(isSelfBuilt(`${home}/.local/bin/thing`, home)).toBe(true);
    expect(isSelfBuilt(`${home}/Library/Application Support/Vendor/updater`, home)).toBe(false);
    expect(isSelfBuilt('/Applications/Vendor.app/Contents/MacOS/updater', home)).toBe(false);
    expect(isSelfBuilt(undefined, home)).toBe(false);
  });
  it('参数脱敏：只遮看起来像密钥的长串', () => {
    expect(redactArgument('--token=abcDEF1234567890abcdef12345')).toBe('--token=•••');
    expect(redactArgument('local.example-chaohua-checkin-primary')).toBe('local.example-chaohua-checkin-primary');
    expect(redactArgument('/opt/example/refresh.py')).toBe('/opt/example/refresh.py');
  });
  it('launchctl list', () => {
    const rows = parseLaunchctlList(LIST);
    expect(rows.get('local.example.service')).toEqual({ pid: 4321, status: 0, label: 'local.example.service' });
    expect(rows.get('local.example.weekly')).toEqual({ pid: null, status: -9, label: 'local.example.weekly' });
    expect(rows.has('Label')).toBe(false);
  });
});

describe('Codex 与 Claude（规格 3.3–3.4）', () => {
  it('只读白名单字段', () => {
    const fields = readCodexFields(readFileSync(join(FIXTURE, 'home/.codex/automations/weekly-report/automation.toml'), 'utf8'));
    expect(Object.keys(fields).sort()).toEqual(['id', 'kind', 'name', 'rrule', 'status']);
    expect(JSON.stringify(fields)).not.toContain('提示词');
  });
  it('rrule 子集：描述和下次运行', () => {
    const weekly = parseRrule('RRULE:FREQ=WEEKLY;BYDAY=SA;BYHOUR=8;BYMINUTE=30;BYSECOND=0')!;
    expect(describeRrule(weekly)).toBe('每周六 8:30');
    expect(nextRruleRun(weekly, NOW).next?.toISOString()).toBe(iso(2026, 11, 28, 8, 30));
    const monthly = parseRrule('FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0;BYSECOND=0')!;
    expect(describeRrule(monthly)).toBe('每月 1 日 9:00');
    expect(nextRruleRun(monthly, NOW).next?.toISOString()).toBe(iso(2026, 12, 1, 9, 0));
    expect(describeRrule(parseRrule('FREQ=HOURLY;BYMINUTE=46')!)).toBe('每小时第 46 分');
  });
  it('INTERVAL 大于 1：有 DTSTART 才算下次时间', () => {
    const anchored = parseRrule('DTSTART:20261107T100000\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SA;BYHOUR=10;BYMINUTE=0')!;
    expect(describeRrule(anchored)).toBe('每 2 周的周六 10:00');
    expect(nextRruleRun(anchored, NOW).next?.toISOString()).toBe(iso(2026, 12, 5, 10, 0));
    expect(nextRruleRun(parseRrule('FREQ=WEEKLY;INTERVAL=2;BYDAY=SA;BYHOUR=10')!, NOW).next).toBeNull();
  });
  it('UNTIL、COUNT 与超出子集', () => {
    expect(nextRruleRun(parseRrule('RRULE:FREQ=HOURLY;BYMINUTE=46;UNTIL=20260924T144647Z')!, NOW)).toEqual({ next: null, ended: true });
    const once = parseRrule('DTSTART;TZID=Asia/Shanghai:20261201T090000\\nRRULE:FREQ=DAILY;COUNT=1')!;
    expect(describeRrule(once)).toBe('一次：2026-12-01 9:00');
    expect(nextRruleRun(once, NOW).next?.toISOString()).toBe(iso(2026, 12, 1, 9, 0));
    expect(nextRruleRun(once, new Date(2026, 11, 2)).ended).toBe(true);
    expect(parseRrule('FREQ=YEARLY;BYMONTH=1')).toBeNull();
    expect(parseRrule('FREQ=WEEKLY;BYDAY=1MO')).toBeNull();
  });
});

describe('汇总（规格 3–4）', () => {
  it('分组、状态、排序和计数', async () => {
    const home = sandbox(); const result = await reader(home).collect();
    expect(result.registry).toEqual({ exists: true, path: '我/数据源.md' });
    // 失败在前，然后是未加载、找不到，其余按名称（中文按拼音）。
    expect(result.tasks.map((task) => [task.ref, task.state])).toEqual([
      ['launchd:local.example.weekly', 'signaled'],
      ['launchd:local.example.notloaded', 'not_loaded'],
      ['launchd:local.example.gone', 'missing'],
      ['example-without-runner', 'missing'],
      ['launchd:local.example.bookmarks', 'missing'],
      ...[...result.tasks].slice(5).map((task) => [task.ref, task.state]),
    ]);
    const rest = result.tasks.slice(5).map((task) => task.name);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')));
    expect(new Set(result.tasks.slice(5).map((task) => task.ref))).toEqual(new Set(['launchd:local.example.mirror-refresh', 'codex:old-followup', 'codex:one-shot', 'codex:past-watch', 'codex:weekly-report', 'codex:yearly']));
    expect(result.tasks.find((task) => task.ref === 'codex:past-watch')?.state).toBe('ended');
    expect(result.services.map((task) => [task.ref, task.state, task.schedule])).toEqual([['launchd:local.example.service', 'running', '常驻']]);
    expect(result.unregistered.map((task) => task.ref)).toEqual(['launchd:com.apple.example-checkin', 'launchd:local.example.broken', 'launchd:local.example.interval', 'claude:unregistered-check']);
    expect(result.summary).toEqual({ failedTasks: 1, staleSources: 1, unregistered: 4 });
  });
  it('任务详情：时间、结果、关联来源、脱敏', async () => {
    const result = await reader(sandbox()).collect();
    const all = [...result.tasks, ...result.services, ...result.unregistered];
    const get = (ref: string) => all.find((task) => task.ref === ref)!;
    expect(get('launchd:local.example.mirror-refresh')).toMatchObject({
      name: '示例副本刷新', schedule: '每小时第 5 分', nextRun: iso(2026, 11, 24, 11, 5), resultText: '上次正常', registered: true,
      sourceNames: ['示例聊天'], logPath: '~/vault/logs/refresh.log', logVisible: true,
      program: ['/usr/bin/python3', '/opt/example/refresh.py', '--token=•••'],
    });
    expect(get('launchd:local.example.weekly')).toMatchObject({ schedule: '每周日 8:00', resultText: '被信号 9 终止', nextRun: iso(2026, 11, 29, 8, 0) });
    expect(get('launchd:com.apple.example-checkin')).toMatchObject({ state: 'failed', resultText: '失败（退出码 1）', registered: false, selfBuilt: true, schedule: '每天 9:00；每天 19:30' });
    expect(get('launchd:local.example.broken')).toMatchObject({ state: 'unreadable', schedule: '无法读取' });
    expect(get('codex:weekly-report')).toMatchObject({ name: '示例周报', schedule: '每周六 8:30', nextRun: iso(2026, 11, 28, 8, 30), resultText: '运行记录未接入' });
    expect(get('codex:old-followup')).toMatchObject({ nextRun: null, resultText: '已暂停' });
    expect(get('codex:yearly')).toMatchObject({ schedule: 'FREQ=YEARLY;BYMONTH=1', nextRun: null });
    expect(get('launchd:local.example.bookmarks')).toMatchObject({ registered: false, sourceNames: ['示例书签'], resultText: '找不到' });
    expect(all.some((task) => task.ref.includes('vendor') || task.ref.includes('demo-check') || task.ref.includes('Finder'))).toBe(false);
    expect(JSON.stringify(result)).not.toContain('提示词');
  });
  it('来源新鲜度', async () => {
    const result = await reader(sandbox()).collect();
    const get = (name: string) => result.sources.find((source) => source.name === name)!;
    expect(get('示例聊天').freshness).toEqual({ level: 'ok', mode: 'log', lastSuccessAt: new Date(2026, 10, 24, 9, 5, 3).toISOString(), lastRun: { at: new Date(2026, 10, 24, 10, 5, 1).toISOString(), status: '解密命令失败' } });
    expect(get('示例聊天').location.exists).toBe(true);
    expect(get('示例笔记').freshness.level).toBe('aging');
    expect(get('示例书签')).toMatchObject({ probe: { display: '~/vault/bookmarks/sync.log', exists: false }, freshness: { level: 'probe_missing' } });
    expect(get('示例社区').freshness.level).toBe('none');
  });
  it('读不到 launchctl 时状态为未知并给出提示', async () => {
    const result = await reader(sandbox(), null).collect();
    expect(result.tasks.find((task) => task.ref === 'launchd:local.example.weekly')?.state).toBe('unknown');
    expect(result.warnings.map((warning) => warning.code)).toContain('launchctl_unavailable');
    expect(result.summary.failedTasks).toBe(0);
  });
  it('没有登记表：两段为空，自建任务全部算未登记', async () => {
    const home = sandbox(); rmSync(join(home, 'Documents/PersonalOS/我/数据源.md'));
    const result = await reader(home).collect();
    expect(result.registry.exists).toBe(false);
    expect(result.sources).toEqual([]); expect(result.tasks).toEqual([]);
    expect(result.unregistered.map((task) => task.ref)).toContain('codex:weekly-report');
    expect(result.unregistered.map((task) => task.ref)).toContain('claude:demo-check');
  });
  it('只读：运行前后文件内容和修改时间不变', async () => {
    const home = sandbox(); const before = snapshot(home);
    await reader(home).collect(); reader(home).taskLog('launchd:local.example.mirror-refresh');
    expect(snapshot(home)).toEqual(before);
  });
});

describe('日志（规格 4）', () => {
  it('只对登记为可显示的任务开放', () => {
    const home = sandbox(); const sources = reader(home);
    expect(sources.taskLog('launchd:local.example.mirror-refresh').lines).toEqual([
      '2026-11-24T08:05:02 成功', '2026-11-24T09:05:03 资源告警', '这一行不是运行记录', '2026-11-24T10:05:01 解密命令失败',
    ]);
    for (const ref of ['launchd:local.example.weekly', 'launchd:com.apple.example-checkin', 'claude:demo-check']) {
      try { sources.taskLog(ref); expect.unreachable(); } catch (error) { expect(error).toBeInstanceOf(KnowledgeError); expect((error as KnowledgeError).code).toBe('forbidden'); }
    }
  });
  it('只返回最后 20 行', () => {
    const home = sandbox();
    writeFileSync(join(home, 'vault/logs/refresh.log'), Array.from({ length: 30 }, (_, index) => `2026-11-24T10:${String(index).padStart(2, '0')}:00 成功`).join('\n'));
    const lines = reader(home).taskLog('launchd:local.example.mirror-refresh').lines;
    expect(lines).toHaveLength(20); expect(lines[0]).toContain('10:10:00');
  });
});
