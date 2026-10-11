import type { CommandErrorCode } from './errors.js';
import type { Source } from './types.js';

/** 桌面端界面（插件旧界面、本地服务的网页）上的操作都记为人。 */
export const DESKTOP_SOURCE: Source = { kind: 'human', name: 'desktop' };

/** core 命令错误码对应的 HTTP 状态码。 */
export function statusForCommandCode(code: CommandErrorCode): number {
  switch (code) {
    case 'invalid_input':
      return 400;
    case 'not_found':
      return 404;
    case 'version_conflict':
    case 'duplicate_request_mismatch':
      return 409;
    case 'forbidden_source':
      return 403;
  }
}
