export function messageOrigin(baseUrl: string): string;

export function isOwnFrameMessage(
  frames: Iterable<{ contentWindow?: unknown } | null> | null | undefined,
  event: { origin?: string; source?: unknown } | null | undefined,
  baseUrl: string,
): boolean;

export function embedFrameUrl(
  baseUrl: string,
  token: string,
  parentOrigin: string,
  embed: string,
  id: string,
): string;

export function quoteText(id: string, title: string): string;

export function appendQuote(draft: string, text: string): string;
