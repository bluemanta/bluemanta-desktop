export type Warning = { code: string; message: string; file?: string; line?: number };
export type Availability = 'available' | 'missing' | 'icloud' | 'unreadable';
export type SectionKind = 'current' | 'todos' | 'changes' | 'references' | 'identity' | 'direction' | 'focus' | 'constraints' | 'preferences' | 'other';
export interface Section { title: string; kind: SectionKind; markdown: string; empty: boolean; line: number }
export interface Mount { title: string; markdown: string }
export interface Change { date: string; text: string; line: number }
export type TodoBucket = 'overdue' | 'dueToday' | 'next7' | 'waiting' | 'undated' | 'later' | 'done';
export interface Todo {
  id: string; domain: string; file: string; line: number; text: string; done: boolean;
  doneAt: string | null; due: string | null; wait: string | null; every: string | null;
  tags: string[]; bucket: TodoBucket; warnings: Warning[];
}
export interface Route { id: string; name: string; path: string; aliases: string[]; keywords: string[]; typicalQuestions: string[]; registered: boolean }
export interface Router { about: string; domains: Route[]; warnings: Warning[] }
export interface ParsedStatus {
  updatedAt: string | null; sections: Section[]; todos: Todo[]; changes: Change[];
  links: string; mounts: Mount[]; focus: string[]; gapCount: number; warnings: Warning[]; markdown: string;
}
export interface DomainSummary extends Route {
  exists: boolean; updatedAt: string | null; stale: boolean; staleDays: number | null;
  openCount: number; overdueCount: number; gapCount: number; latestChange: Change | null;
  availability: Availability; warnings: Warning[];
}
export interface DocumentFile { path: string; name: string; kind: 'markdown' | 'file' | 'directory'; size: number; modifiedAt: string | null; availability: Availability }
export interface FileContent extends DocumentFile { content?: string; message?: string; truncated?: boolean }
export interface Matter { name: string; path: string; entry: string | null; files: DocumentFile[] }
export interface RegistryLocation { kind: 'local' | 'link' | 'other'; display: string; exists?: boolean; url?: string }
export interface RegistryRow { domain: string; topic: string; title: string; location: RegistryLocation; purpose: string; status: string; source: string }
export interface InboxEntry { date: string; text: string; line: number }
export interface LogEntry {
  id: string; kind: 'entry' | 'section'; date: string; domain: string | null; text: string;
  title?: string; markdown?: string; file: string; line: number;
}
export interface LogResult { items: LogEntry[]; hasMore: boolean; warnings: Warning[] }
export interface DomainDetail extends DomainSummary {
  file: string; sections: Section[]; todos: Todo[]; changes: Change[]; links: string; mounts: Mount[];
  registry: RegistryRow[]; matters: Matter[]; knowledge: DocumentFile[]; files: DocumentFile[]; markdown: string;
}
export interface Overview {
  root: string; exists: boolean; today: string; about: string; focus: string[];
  domains: DomainSummary[]; inbox: number; warnings: Warning[];
}
export interface TodayGroups {
  overdue: Todo[]; dueToday: Todo[]; next7: Todo[]; waiting: Todo[];
  undated: { items: Todo[]; total: number }; later: { count: number; items: Todo[] }; staleDomains: DomainSummary[];
}
export interface TodayResult extends TodayGroups { inbox: InboxEntry[]; today: string; warnings: Warning[] }
export interface StatInfo { isFile(): boolean; isDirectory(): boolean; size?: number; mtime?: Date }
/** Used only to check registered external paths; contents are never read. */
export type StatFunction = (path: string) => unknown;
export interface PersonalOsReaderOptions { home: string; root?: string; today?: string; stat?: StatFunction }
export interface LogOptions { domains?: readonly string[]; before?: string; days?: number }
