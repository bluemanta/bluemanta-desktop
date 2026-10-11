export function htmlPreviewFrameName(embed: string, tabId?: string): string;

export function htmlPreviewFrameAttrs(
  embed: string,
  tabId?: string,
): { 'data-html-preview': string; name: string };
