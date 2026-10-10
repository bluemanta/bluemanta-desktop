/**
 * T6 的执行逻辑在 `@bluemanta/cli` 的 `src/idea-tools.ts`，命令行和 MCP 共用。
 * 这里只转发。失败结果上的 `code` 给命令行映射错误码；dsh 工具 schema 只有 `error`，所以去掉 `code`。
 * 不传 `source` 时仍是 `{ kind: 'agent', name: 'dsh-agent' }`，也不传 `rawInput`。
 */
import {
  captureIdea as captureIdeaWithCode,
  getIdea as getIdeaWithCode,
  searchIdeas as searchIdeasWithCode,
  type CaptureIdeaInput,
  type CaptureIdeaResult,
  type GetIdeaResult,
  type IdeaToolCore,
  type SearchIdeaInput,
  type SearchIdeaResult,
} from '@bluemanta/cli/idea-tools';

export type {
  CaptureIdeaInput,
  CaptureIdeaResult,
  GetIdeaResult,
  IdeaExtensionView,
  IdeaRawView,
  IdeaSearchItem,
  IdeaToolCore,
  IdeaToolFailure,
  SearchIdeaInput,
  SearchIdeaResult,
} from '@bluemanta/cli/idea-tools';

export {
  AGENT_LIMITATION,
  AGENT_SOURCE,
  CAPTURE_DESCRIPTION,
  CATEGORY_LABELS,
  GET_DESCRIPTION,
  IDEA_CAPTURE_TOOL,
  IDEA_CATEGORY_VALUES,
  IDEA_GET_TOOL,
  IDEA_SEARCH_TOOL,
  SEARCH_DESCRIPTION,
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  ideaRequestId,
  renderCapture,
  renderGet,
  renderSearch,
} from '@bluemanta/cli/idea-tools';

function withoutCode<T extends { ok: boolean; error?: string }>(result: T): T {
  if (result.ok) return result;
  const failure = result as { ok: false; error: string };
  return { ok: false, error: failure.error } as T;
}

export function captureIdea(core: IdeaToolCore, input: CaptureIdeaInput): CaptureIdeaResult {
  return withoutCode(captureIdeaWithCode(core, input));
}

export function searchIdeas(core: IdeaToolCore, input: SearchIdeaInput): SearchIdeaResult {
  return withoutCode(searchIdeasWithCode(core, input));
}

export function getIdea(core: IdeaToolCore, input: { id: string }): GetIdeaResult {
  return withoutCode(getIdeaWithCode(core, input));
}
