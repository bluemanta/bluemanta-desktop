import type { DatabaseSync } from 'node:sqlite';
import type { ZodError, ZodType } from 'zod';
import {
  commandFailure,
  type CommandFailure,
  type CommandResult,
  type CommandSuccess,
} from './errors.js';
import { hashCommandInput } from './hash.js';
import { getRow } from './sql.js';
import type { Source } from './types.js';
import { formatZodError } from './validation.js';

export type Applied<T> = {
  ok: true;
  record: T;
  objectId: string;
  revBefore: number | null;
  revAfter: number | null;
};

export type ApplyOutcome<T> = Applied<T> | CommandFailure;

type CommandSpec<TInput extends { requestId: string; source: Source }, TRecord> = {
  name: string;
  schema: ZodType<TInput>;
  humanOnly?: boolean;
  apply: (db: DatabaseSync, input: TInput, now: string) => ApplyOutcome<TRecord>;
};

type HistoryHit = {
  input_hash: string;
  result_json: string;
};

export function applied<T extends { id: string; rev: number }>(
  record: T,
  revBefore: number | null,
): Applied<T> {
  return {
    ok: true,
    record,
    objectId: record.id,
    revBefore,
    revAfter: record.rev,
  };
}

export function appliedPurge(id: string, revBefore: number): Applied<{ id: string }> {
  return {
    ok: true,
    record: { id },
    objectId: id,
    revBefore,
    revAfter: null,
  };
}

function isFailure<T>(outcome: ApplyOutcome<T>): outcome is CommandFailure {
  return outcome.ok === false;
}

export function execute<TInput extends { requestId: string; source: Source }, TRecord>(
  db: DatabaseSync,
  spec: CommandSpec<TInput, TRecord>,
  raw: unknown,
): CommandResult<TRecord> {
  const parsed = spec.schema.safeParse(raw);
  if (!parsed.success) {
    return commandFailure('invalid_input', formatZodError(parsed.error as ZodError));
  }

  const input = parsed.data;
  const inputHash = hashCommandInput(spec.name, input);
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = getRow<HistoryHit>(
      db,
      'SELECT input_hash, result_json FROM history WHERE request_id = ?',
      [input.requestId],
    );
    if (existing) {
      db.exec('ROLLBACK');
      if (existing.input_hash !== inputHash) {
        return commandFailure('duplicate_request_mismatch', '相同 requestId 的内容与首次请求不一致');
      }
      return JSON.parse(existing.result_json) as CommandSuccess<TRecord>;
    }

    if (spec.humanOnly && input.source.kind === 'agent') {
      db.exec('ROLLBACK');
      return commandFailure('forbidden_source', '该命令只能由人执行');
    }

    const now = new Date().toISOString();
    const outcome = spec.apply(db, input, now);
    if (isFailure(outcome)) {
      db.exec('ROLLBACK');
      return outcome;
    }

    const result: CommandSuccess<TRecord> = { ok: true, record: outcome.record };
    db.prepare(
      `INSERT INTO history (
        request_id, command, source, object_id, rev_before, rev_after, at, input_hash, result_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.requestId,
      spec.name,
      JSON.stringify(input.source),
      outcome.objectId,
      outcome.revBefore,
      outcome.revAfter,
      now,
      inputHash,
      JSON.stringify(result),
    );
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 事务可能已经结束。
    }
    throw error;
  }
}
