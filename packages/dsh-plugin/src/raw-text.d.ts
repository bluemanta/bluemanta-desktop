export function foldSpace(value: unknown): string;

export interface RawPresent {
  status: 'present';
  channel?: string;
  text?: string;
}

export interface RawLegacy {
  status: 'legacy';
}

export function shouldShowRaw(
  body: string | null | undefined,
  rawInput: RawPresent | RawLegacy | null | undefined,
): boolean;
