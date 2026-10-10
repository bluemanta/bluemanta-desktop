export type CommandErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'version_conflict'
  | 'duplicate_request_mismatch'
  | 'forbidden_source';

export type CommandFailure = {
  ok: false;
  code: CommandErrorCode;
  message: string;
};

export type CommandSuccess<T> = {
  ok: true;
  record: T;
};

export type CommandResult<T> = CommandSuccess<T> | CommandFailure;

export function commandFailure(code: CommandErrorCode, message: string): CommandFailure {
  return { ok: false, code, message };
}

export class UnsupportedSchemaError extends Error {
  readonly code = 'unsupported_schema_version' as const;

  constructor(
    readonly dbVersion: number,
    readonly supportedVersion: number,
  ) {
    super(`数据库版本 ${dbVersion} 高于当前代码支持的版本 ${supportedVersion}，拒绝打开`);
    this.name = 'UnsupportedSchemaError';
  }
}
