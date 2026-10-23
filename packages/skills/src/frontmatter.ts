import { LineCounter, parseDocument } from 'yaml';
import type { ContentIssue, Frontmatter } from './types.js';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BOOLEAN_TEXT: Readonly<Record<string, boolean>> = {
  true: true, yes: true, on: true, '1': true,
  false: false, no: false, off: false, '0': false,
};

export interface ParsedSkillFile {
  frontmatter?: Frontmatter;
  body: string;
  issues: readonly ContentIssue[];
}

function invocation(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && (value === 0 || value === 1)) return value === 1;
  if (typeof value === 'string') return BOOLEAN_TEXT[value.toLowerCase()];
  return undefined;
}

export function parseSkillFile(text: string, path: string, expectedDirectoryName?: string): ParsedSkillFile {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
    return { body: text, issues: [{ code: 'frontmatter', message: 'SKILL.md must start with YAML frontmatter', path, line: 1 }] };
  }
  const closingMatch = /\r?\n---(?:\r?\n|$)/.exec(text.slice(3));
  if (!closingMatch) {
    return { body: '', issues: [{ code: 'frontmatter', message: 'YAML frontmatter is not closed', path, line: 1 }] };
  }
  const closing = closingMatch.index + 3;
  const header = text.slice(text.indexOf('\n') + 1, closing);
  const bodyStart = closing + closingMatch[0].length;
  const body = text.slice(bodyStart);
  const lineCounter = new LineCounter();
  let document: ReturnType<typeof parseDocument>;
  try {
    document = parseDocument(header, { lineCounter });
  } catch (error) {
    return { body, issues: [{ code: 'frontmatter', message: `Invalid YAML: ${(error as Error).message}`, path }] };
  }
  if (document.errors.length > 0) {
    const error = document.errors[0]!;
    const line = error.linePos?.[0]?.line;
    return { body, issues: [{ code: 'frontmatter', message: `Invalid YAML: ${error.message}`, path, line: line === undefined ? undefined : line + 1 }] };
  }
  let value: unknown;
  try {
    value = document.toJS();
  } catch (error) {
    return { body, issues: [{ code: 'frontmatter', message: `Invalid YAML: ${(error as Error).message}`, path }] };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { body, issues: [{ code: 'frontmatter', message: 'Frontmatter must be a mapping', path, line: 2 }] };
  }
  const raw = value as Record<string, unknown>;
  const issues: ContentIssue[] = [];
  if (typeof raw.name !== 'string' || !NAME.test(raw.name)) {
    issues.push({ code: 'frontmatter', message: 'name is required and must be kebab-case', path });
  }
  if (typeof raw.description !== 'string' || raw.description.trim() === '') {
    issues.push({ code: 'frontmatter', message: 'description is required', path });
  }
  const model = raw['disable-model-invocation'] === undefined ? false : invocation(raw['disable-model-invocation']);
  const user = raw['user-invocable'] === undefined ? true : invocation(raw['user-invocable']);
  if (model === undefined) issues.push({ code: 'frontmatter', message: 'disable-model-invocation must be a boolean', path });
  if (user === undefined) issues.push({ code: 'frontmatter', message: 'user-invocable must be a boolean', path });
  if (typeof raw.name === 'string' && expectedDirectoryName !== undefined && raw.name !== expectedDirectoryName) {
    issues.push({ code: 'name-mismatch', message: `frontmatter name "${raw.name}" does not match directory "${expectedDirectoryName}"`, path });
  }
  if (issues.some((issue) => issue.code === 'frontmatter')) return { body, issues };
  return {
    body,
    issues,
    frontmatter: {
      name: raw.name as string,
      description: raw.description as string,
      whenToUse: typeof raw.whenToUse === 'string' ? raw.whenToUse : undefined,
      metadata: raw.metadata,
      disableModelInvocation: model!,
      userInvocable: user!,
      raw,
    },
  };
}
