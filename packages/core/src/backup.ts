import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function backupStamp(date: Date): string {
  const iso = date.toISOString();
  const [datePart, timePart] = iso.split('T');
  if (!datePart || !timePart) return iso.replace(/[-:.]/g, '');
  const time = timePart.replace('Z', '').replace('.', '').replace(/:/g, '');
  return `${datePart.replace(/-/g, '')}T${time}Z`;
}

export function uniqueBackupFolder(dataDir: string, name: string): string {
  let folder = join(dataDir, 'backups', name);
  let suffix = 2;
  while (existsSync(folder)) {
    folder = join(dataDir, 'backups', `${name}-${suffix}`);
    suffix += 1;
  }
  return folder;
}

export function copyDatabaseFiles(dbPath: string, folder: string): void {
  mkdirSync(folder, { recursive: true });
  copyFileSync(dbPath, join(folder, 'store.sqlite'));
  for (const extra of ['-wal', '-shm']) {
    const source = `${dbPath}${extra}`;
    if (existsSync(source)) copyFileSync(source, join(folder, `store.sqlite${extra}`));
  }
}
