import { createHash } from 'node:crypto';

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    const sorted: Record<string, unknown> = {};
    for (const [key, child] of entries) {
      sorted[key] = sortValue(child);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function hashCommandInput(command: string, input: unknown): string {
  return createHash('sha256').update(`${command}\n${canonicalJson(input)}`).digest('hex');
}
