export const DSH_REFERENCE_VERSION: '0.2.2-rc.1';

export const DSH_ENGINE_RANGE: '>=0.2.1-rc.2 <0.3.0-0';

export const DEFAULT_DSH_SMOKE_BIN: '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh';

export const RESERVED_SMOKE_PORTS: readonly number[];

export const INCOMPATIBLE_MARK: 'is incompatible with dsh';

export const WEB_READY_TIMEOUT_MS: number;

export const FRAME_READY_TIMEOUT_MS: number;

export const SMOKE_PROFILE: 'bluemanta-smoke';

export type SmokePanel = {
  label: string;
  frameName: string;
  readyRole: string;
  readyName: string;
};

export const SMOKE_PANELS: readonly SmokePanel[];

export function parseSmokeArgs(argv: readonly string[] | null | undefined): { keep: boolean; unknown: string[] };

export function resolveSmokeBin(envValue: string | null | undefined): string;

export function missingBinMessage(bin: string): string;

export function pnpmMissingMessage(): string;

export function hasIncompatibleWarning(text: string | null | undefined): boolean;

export function incompatibleExcerpt(text: string | null | undefined): string;

export function parseHostVersion(text: string | null | undefined): string;

export function parseWebUrls(text: string | null | undefined): string[];

export function webUrlForPort(text: string | null | undefined, port: number): string;

export function iframeTargetsServer(src: string | null | undefined, serverPort: number): boolean;

export function assessFrame(frame: {
  preview?: boolean;
  name?: string;
  src?: string;
  serverPort?: number;
} | null | undefined): { ok: boolean; reason: string };

export function choosePort(candidates: readonly number[] | null | undefined, taken: readonly number[] | null | undefined): number | null;

export function formatCheck(index: number, ok: boolean, reason?: string): string;

export function allChecksPassed(results: readonly { ok?: boolean }[] | null | undefined): boolean;

export function knowledgeFixtureHome(repoRoot: string): string;

export function smokeEnv(
  base: NodeJS.ProcessEnv | null | undefined,
  paths: { dshHome: string; dataDir: string; knowledgeHome: string },
  ports: { serverPort: number },
): NodeJS.ProcessEnv;

export function profileCreateArgs(profile?: string): string[];

export function pluginAddArgs(profile?: string): string[];

export function serveArgs(profile: string, port: number): string[];

export function seedArgs(dataDir: string): string[];
