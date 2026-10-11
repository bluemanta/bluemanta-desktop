/** 命令面板和侧栏上的 ⌘K / Ctrl+K。设计规范写 ⌘K，Windows 与 Linux 用 Ctrl+K。 */
export function commandShortcut(): string {
  if (typeof navigator === 'undefined') return '⌘K';
  const platform = navigator.platform || '';
  const agent = navigator.userAgent || '';
  const mac = /Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS/i.test(agent);
  return mac ? '⌘K' : 'Ctrl+K';
}
