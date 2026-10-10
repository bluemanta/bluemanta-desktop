import type { ImportSourceType } from '@bluemanta/core';

export type ReportLine = {
  sourceId: string;
  title: string;
  reason?: string;
};

export type ReportBucket = {
  created: ReportLine[];
  skipped: ReportLine[];
  changed: ReportLine[];
  failed: ReportLine[];
};

export type ImportReport = {
  dryRun: boolean;
  sourcePath: string;
  dataDir: string;
  backupDir: string | null;
  sections: Record<ImportSourceType, ReportBucket>;
};

const SECTION_LABEL: Record<ImportSourceType, string> = {
  project: '档案',
  entry: '档案笔记',
  idea: '灵感',
  attachment: '附件',
};

const BUCKET_LABEL = {
  created: '新增',
  skipped: '跳过',
  changed: '来源已变化',
  failed: '失败',
} as const;

const SECTION_ORDER: readonly ImportSourceType[] = ['project', 'entry', 'idea', 'attachment'];

export function emptyBucket(): ReportBucket {
  return { created: [], skipped: [], changed: [], failed: [] };
}

export function emptyReport(options: { dryRun: boolean; sourcePath: string; dataDir: string }): ImportReport {
  return {
    dryRun: options.dryRun,
    sourcePath: options.sourcePath,
    dataDir: options.dataDir,
    backupDir: null,
    sections: {
      project: emptyBucket(),
      entry: emptyBucket(),
      idea: emptyBucket(),
      attachment: emptyBucket(),
    },
  };
}

export function failureCount(report: ImportReport): number {
  return SECTION_ORDER.reduce((sum, type) => sum + report.sections[type].failed.length, 0);
}

/** 明细只有来源 id 和标题，不包含正文。 */
export function formatReport(report: ImportReport): string {
  const lines: string[] = [
    report.dryRun ? 'workbench 导入计划（dry-run，未写入）' : 'workbench 导入报告',
    `来源: ${report.sourcePath}`,
    `数据目录: ${report.dataDir}`,
    `备份: ${report.backupDir ?? '无'}`,
  ];
  for (const type of SECTION_ORDER) {
    lines.push('', SECTION_LABEL[type]);
    const bucket = report.sections[type];
    for (const name of ['created', 'skipped', 'changed', 'failed'] as const) {
      const items = bucket[name];
      lines.push(`  ${BUCKET_LABEL[name]} ${items.length}`);
      for (const item of items) {
        const reason = item.reason ? `  ${item.reason}` : '';
        lines.push(`    - ${item.sourceId}  ${item.title}${reason}`);
      }
    }
  }
  return lines.join('\n');
}
