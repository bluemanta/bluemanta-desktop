import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  DEFAULT_AREAS,
  openCore,
  readImportLedger,
  validateImportEntry,
  validateImportIdea,
  validateImportProject,
  type Core,
  type ImportSourceRecord,
  type ImportSourceType,
} from '@bluemanta/core';
import { emptyReport, type ImportReport, type ReportLine } from './report.js';
import {
  loadConfig,
  mapEntry,
  mapIdea,
  mapProject,
  parseWorkbench,
  planAttachment,
  type PlannedAttachment,
  type ProjectAreaConfig,
  type WorkbenchStore,
} from './source.js';

const IDEA_ATTACHMENT_LIMIT = 4;

export type RunImportOptions = {
  sourcePath: string;
  dataDir: string;
  configPath?: string;
  dryRun: boolean;
};

type LedgerHit = {
  sourceUpdatedAt: string;
  targetId: string;
};

type Ledger = Map<string, LedgerHit>;

type Outcome = 'created' | 'skipped' | 'changed' | 'failed';

function ledgerKey(sourceType: ImportSourceType, sourceId: string): string {
  return `${sourceType}\0${sourceId}`;
}

function indexLedger(rows: readonly ImportSourceRecord[]): Ledger {
  const ledger: Ledger = new Map();
  for (const row of rows) {
    if (row.sourceSystem !== 'bluemanta-workbench') continue;
    ledger.set(ledgerKey(row.sourceType, row.sourceId), {
      sourceUpdatedAt: row.sourceUpdatedAt,
      targetId: row.targetId,
    });
  }
  return ledger;
}

function isSourceNewer(sourceUpdatedAt: string, ledgerUpdatedAt: string): boolean {
  const left = Date.parse(sourceUpdatedAt);
  const right = Date.parse(ledgerUpdatedAt);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return sourceUpdatedAt > ledgerUpdatedAt;
  return left > right;
}

function disposition(ledger: Ledger, sourceType: ImportSourceType, sourceId: string, updatedAt: string): Outcome | 'create' {
  const existing = ledger.get(ledgerKey(sourceType, sourceId));
  if (!existing) return 'create';
  if (isSourceNewer(updatedAt, existing.sourceUpdatedAt)) return 'changed';
  return 'skipped';
}

function loadAreaIds(dbPath: string): Set<string> {
  const defaults = DEFAULT_AREAS.map((area) => area.id);
  if (!existsSync(dbPath)) return new Set(defaults);
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 });
  try {
    db.exec('PRAGMA query_only = ON');
    const table = db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'areas'")
      .get();
    if (table === undefined) return new Set(defaults);
    const rows = db.prepare('SELECT id FROM areas').all() as Array<{ id: string }>;
    return new Set(rows.map((row) => row.id));
  } finally {
    db.close();
  }
}

function line(sourceId: string, title: string, reason?: string): ReportLine {
  return reason === undefined ? { sourceId, title } : { sourceId, title, reason };
}

export function runImport(options: RunImportOptions): ImportReport {
  const before = readFileSync(options.sourcePath);
  const beforeStat = statSync(options.sourcePath);
  const store = parseWorkbench(before.toString('utf8'));
  const config = options.configPath
    ? loadConfig(readFileSync(options.configPath, 'utf8'))
    : { projectArea: {} };
  const storeDir = dirname(options.sourcePath);
  const dbPath = join(options.dataDir, 'store.sqlite');
  const report = emptyReport({
    dryRun: options.dryRun,
    sourcePath: options.sourcePath,
    dataDir: options.dataDir,
  });
  const ledger = indexLedger(readImportLedger(dbPath));
  const areaIds = loadAreaIds(dbPath);
  let core: Core | undefined;
  let backupDir: string | null = null;

  const writer = (): Core => {
    if (options.dryRun) throw new Error('dry-run 不能写入');
    if (!core) {
      core = openCore({ dataDir: options.dataDir });
      backupDir = core.backupBeforeImport();
      report.backupDir = backupDir;
    }
    return core;
  };

  try {
    importAll({
      store,
      config,
      storeDir,
      areaIds,
      ledger,
      report,
      dryRun: options.dryRun,
      writer,
    });
    return report;
  } finally {
    core?.close();
    const after = readFileSync(options.sourcePath);
    const afterStat = statSync(options.sourcePath);
    if (!before.equals(after) || beforeStat.mtimeMs !== afterStat.mtimeMs) {
      throw new Error('来源 store.json 在导入过程中被改动');
    }
  }
}

function importAll(env: {
  store: WorkbenchStore;
  config: ProjectAreaConfig;
  storeDir: string;
  areaIds: ReadonlySet<string>;
  ledger: Ledger;
  report: ImportReport;
  dryRun: boolean;
  writer: () => Core;
}): void {
  const projectIds = new Map<string, string>();
  const demos = new Set<string>();

  for (const raw of env.store.projects) {
    const mapped = mapProject(raw, env.config, env.areaIds);
    if (mapped.kind === 'demo') {
      demos.add(mapped.sourceId);
      env.report.sections.project.skipped.push(line(mapped.sourceId, mapped.reportTitle, 'demo'));
      continue;
    }
    if (mapped.kind === 'invalid') {
      env.report.sections.project.failed.push(line(mapped.sourceId, mapped.reportTitle, mapped.reason));
      continue;
    }
    const action = disposition(env.ledger, 'project', mapped.sourceId, mapped.updatedAt);
    if (action !== 'create') {
      const existing = env.ledger.get(ledgerKey('project', mapped.sourceId));
      if (existing) projectIds.set(mapped.sourceId, existing.targetId);
      env.report.sections.project[action].push(line(mapped.sourceId, mapped.reportTitle));
      continue;
    }
    const validation = validateImportProject(mapped.input);
    if (validation) {
      env.report.sections.project.failed.push(line(mapped.sourceId, mapped.reportTitle, validation.message));
      continue;
    }
    if (env.dryRun) {
      projectIds.set(mapped.sourceId, `pending:${mapped.sourceId}`);
      env.report.sections.project.created.push(line(mapped.sourceId, mapped.reportTitle));
      continue;
    }
    try {
      const result = env.writer().importer.importProject(mapped.input);
      if (!result.ok) {
        env.report.sections.project.failed.push(line(mapped.sourceId, mapped.reportTitle, result.message));
        continue;
      }
      env.ledger.set(ledgerKey('project', mapped.sourceId), {
        sourceUpdatedAt: mapped.updatedAt,
        targetId: result.record.id,
      });
      projectIds.set(mapped.sourceId, result.record.id);
      env.report.sections.project.created.push(line(mapped.sourceId, mapped.reportTitle));
    } catch (error) {
      env.report.sections.project.failed.push(line(mapped.sourceId, mapped.reportTitle, messageOf(error)));
    }
  }

  for (const raw of env.store.entries) {
    const mapped = mapEntry(raw);
    if (mapped.kind === 'demo') {
      env.report.sections.entry.skipped.push(line(mapped.sourceId, mapped.reportTitle, 'demo'));
      continue;
    }
    if (mapped.kind === 'invalid') {
      env.report.sections.entry.failed.push(line(mapped.sourceId, mapped.reportTitle, mapped.reason));
      continue;
    }
    if (demos.has(mapped.projectSourceId)) {
      env.report.sections.entry.skipped.push(line(mapped.sourceId, mapped.reportTitle, 'demo'));
      continue;
    }
    const action = disposition(env.ledger, 'entry', mapped.sourceId, mapped.updatedAt);
    if (action !== 'create') {
      env.report.sections.entry[action].push(line(mapped.sourceId, mapped.reportTitle));
      continue;
    }
    const projectId = projectIds.get(mapped.projectSourceId);
    if (!projectId) {
      env.report.sections.entry.failed.push(line(mapped.sourceId, mapped.reportTitle, '所属档案未导入'));
      continue;
    }
    const input = { ...mapped.input, projectId };
    const validation = validateImportEntry(input);
    if (validation) {
      env.report.sections.entry.failed.push(line(mapped.sourceId, mapped.reportTitle, validation.message));
      continue;
    }
    if (env.dryRun) {
      env.report.sections.entry.created.push(line(mapped.sourceId, mapped.reportTitle));
      continue;
    }
    try {
      const result = env.writer().importer.importEntry(input);
      if (!result.ok) {
        env.report.sections.entry.failed.push(line(mapped.sourceId, mapped.reportTitle, result.message));
        continue;
      }
      env.ledger.set(ledgerKey('entry', mapped.sourceId), {
        sourceUpdatedAt: mapped.updatedAt,
        targetId: result.record.id,
      });
      env.report.sections.entry.created.push(line(mapped.sourceId, mapped.reportTitle));
    } catch (error) {
      env.report.sections.entry.failed.push(line(mapped.sourceId, mapped.reportTitle, messageOf(error)));
    }
  }

  for (const raw of env.store.ideas) {
    importIdeaRecord(env, raw);
  }
}

function importIdeaRecord(
  env: {
    storeDir: string;
    ledger: Ledger;
    report: ImportReport;
    dryRun: boolean;
    writer: () => Core;
  },
  raw: Record<string, unknown>,
): void {
  const mapped = mapIdea(raw);
  if (mapped.kind === 'demo') return;
  if (mapped.kind === 'invalid') {
    env.report.sections.idea.failed.push(line(mapped.sourceId, mapped.reportTitle, mapped.reason));
    return;
  }
  const action = disposition(env.ledger, 'idea', mapped.sourceId, mapped.updatedAt);
  if (action !== 'create') {
    // 灵感入账后不再改写。没记入台账的附件（例如 sha256 不一致）也不重试。
    env.report.sections.idea[action].push(line(mapped.sourceId, mapped.reportTitle));
    rememberExistingAttachments(env, mapped.attachments);
    return;
  }

  const accepted: string[] = [];
  const fresh: PlannedAttachment[] = [];
  let kept = 0;
  for (const attachment of mapped.attachments) {
    const sourceId = attachmentSourceId(attachment);
    const existing = sourceId ? env.ledger.get(ledgerKey('attachment', sourceId)) : undefined;
    if (existing && sourceId) {
      env.report.sections.attachment.skipped.push(line(sourceId, sourceId));
      if (kept < IDEA_ATTACHMENT_LIMIT) {
        accepted.push(existing.targetId);
        kept += 1;
      }
      continue;
    }
    if (kept >= IDEA_ATTACHMENT_LIMIT) {
      env.report.sections.attachment.failed.push(
        line(sourceId ?? '（缺少 id）', sourceId ?? '（缺少 id）', '灵感最多 4 个附件'),
      );
      continue;
    }
    const planned = planAttachment(
      env.storeDir,
      attachment,
      {
        createdAt: mapped.input.createdAt,
        updatedAt: mapped.input.updatedAt,
        sourceUpdatedAt: mapped.updatedAt,
      },
      { createdBy: mapped.input.createdBy, updatedBy: mapped.input.updatedBy },
    );
    if (!planned.ok) {
      env.report.sections.attachment.failed.push(line(planned.sourceId, planned.reportTitle, planned.reason));
      continue;
    }
    fresh.push(planned.plan);
    accepted.push(env.dryRun ? `pending:${planned.plan.sourceId}` : '');
    kept += 1;
  }

  const previewIds = accepted.filter((id) => id !== '');
  const preview = validateImportIdea({ ...mapped.input, attachmentIds: env.dryRun ? previewIds : placeholderIds(fresh, previewIds) });
  if (preview) {
    env.report.sections.idea.failed.push(line(mapped.sourceId, mapped.reportTitle, preview.message));
    return;
  }
  if (env.dryRun) {
    for (const attachment of fresh) {
      env.report.sections.attachment.created.push(line(attachment.sourceId, attachment.reportTitle));
    }
    env.report.sections.idea.created.push(line(mapped.sourceId, mapped.reportTitle));
    return;
  }

  const attachmentIds: string[] = [];
  for (const id of accepted) {
    if (id !== '') attachmentIds.push(id);
  }
  for (const attachment of fresh) {
    try {
      const result = env.writer().importer.importAttachment(attachment.input, attachment.sourceFile);
      if (!result.ok) {
        env.report.sections.attachment.failed.push(line(attachment.sourceId, attachment.reportTitle, result.message));
        continue;
      }
      env.ledger.set(ledgerKey('attachment', attachment.sourceId), {
        sourceUpdatedAt: attachment.input.sourceUpdatedAt,
        targetId: result.record.id,
      });
      env.report.sections.attachment.created.push(line(attachment.sourceId, attachment.reportTitle));
      attachmentIds.push(result.record.id);
    } catch (error) {
      env.report.sections.attachment.failed.push(line(attachment.sourceId, attachment.reportTitle, messageOf(error)));
    }
  }

  const input = { ...mapped.input, attachmentIds };
  const validation = validateImportIdea(input);
  if (validation) {
    env.report.sections.idea.failed.push(line(mapped.sourceId, mapped.reportTitle, validation.message));
    return;
  }
  try {
    const result = env.writer().importer.importIdea(input);
    if (!result.ok) {
      env.report.sections.idea.failed.push(line(mapped.sourceId, mapped.reportTitle, result.message));
      return;
    }
    env.ledger.set(ledgerKey('idea', mapped.sourceId), {
      sourceUpdatedAt: mapped.updatedAt,
      targetId: result.record.id,
    });
    env.report.sections.idea.created.push(line(mapped.sourceId, mapped.reportTitle));
  } catch (error) {
    env.report.sections.idea.failed.push(line(mapped.sourceId, mapped.reportTitle, messageOf(error)));
  }
}

function placeholderIds(fresh: readonly PlannedAttachment[], existingIds: readonly string[]): string[] {
  return [...existingIds, ...fresh.map((attachment) => `pending:${attachment.sourceId}`)];
}

function rememberExistingAttachments(
  env: { ledger: Ledger; report: ImportReport },
  attachments: readonly unknown[],
): void {
  for (const attachment of attachments) {
    const sourceId = attachmentSourceId(attachment);
    if (!sourceId) continue;
    if (!env.ledger.has(ledgerKey('attachment', sourceId))) continue;
    env.report.sections.attachment.skipped.push(line(sourceId, sourceId));
  }
}

function attachmentSourceId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : '导入失败';
}
