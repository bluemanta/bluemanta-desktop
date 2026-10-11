import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PALETTE_KEY_LABEL,
  hasOtherOverlay,
  headerPaletteButton,
  isTypingTarget,
  paletteOpenAfterKey,
  showHeaderPaletteButton,
  shouldTogglePalette,
  type PaletteKeyEvent,
} from './paletteAccess';

const quiet = { querySelector: () => null };
const pressP: PaletteKeyEvent = { key: 'p' };

describe('单键 P 开关命令面板', () => {
  it('关闭时打开，打开时再按关上', () => {
    expect(paletteOpenAfterKey(false, pressP, null, quiet)).toBe(true);
    expect(paletteOpenAfterKey(true, { key: 'P' }, null, quiet)).toBe(false);
    expect(PALETTE_KEY_LABEL).toBe('P');
  });

  it('焦点在输入框或可编辑区域时不触发', () => {
    const input = { tagName: 'INPUT', isContentEditable: false };
    const area = { tagName: 'TEXTAREA', isContentEditable: false };
    const select = { tagName: 'SELECT', isContentEditable: false };
    const editable = { tagName: 'DIV', isContentEditable: true };
    expect(isTypingTarget(input as unknown as EventTarget)).toBe(true);
    expect(paletteOpenAfterKey(false, pressP, input as unknown as EventTarget, quiet)).toBe(false);
    expect(shouldTogglePalette(pressP, area as unknown as EventTarget, quiet)).toBe(false);
    expect(shouldTogglePalette(pressP, select as unknown as EventTarget, quiet)).toBe(false);
    expect(shouldTogglePalette(pressP, editable as unknown as EventTarget, quiet)).toBe(false);
    expect(paletteOpenAfterKey(true, pressP, input as unknown as EventTarget, quiet)).toBe(true);
  });

  it('带修饰键时不触发', () => {
    for (const event of [
      { key: 'p', metaKey: true },
      { key: 'p', ctrlKey: true },
      { key: 'p', altKey: true },
      { key: 'p', shiftKey: true },
    ]) {
      expect(shouldTogglePalette(event, null, quiet)).toBe(false);
      expect(paletteOpenAfterKey(false, event, null, quiet)).toBe(false);
    }
  });

  it('确认框等其他浮层开着时不触发，命令面板自己不挡住再按一次', () => {
    const confirm = {
      querySelector: (selector: string) => (selector.includes('alertdialog') ? {} : null),
    };
    const lightbox = {
      querySelector: (selector: string) => (selector.includes('dialog') && selector.includes('not') ? {} : null),
    };
    expect(hasOtherOverlay(confirm)).toBe(true);
    expect(shouldTogglePalette(pressP, null, confirm)).toBe(false);
    expect(shouldTogglePalette(pressP, null, lightbox)).toBe(false);
    expect(hasOtherOverlay(quiet)).toBe(false);
  });

  it('焦点在按钮上、或按键已经被处理时不触发', () => {
    const button = { tagName: 'BUTTON', closest: () => ({}) };
    expect(shouldTogglePalette(pressP, button as unknown as EventTarget, quiet)).toBe(false);
    expect(shouldTogglePalette({ key: 'p', defaultPrevented: true }, null, quiet)).toBe(false);
    expect(shouldTogglePalette({ key: 'p', isComposing: true }, null, quiet)).toBe(false);
    expect(shouldTogglePalette({ key: 'n' }, null, quiet)).toBe(false);
  });
});

describe('页头命令面板按钮', () => {
  it('嵌入时显示，按钮能打开面板', () => {
    expect(showHeaderPaletteButton('main', 'wide')).toBe(true);
    expect(showHeaderPaletteButton('sidebar', 'wide')).toBe(true);
    expect(showHeaderPaletteButton('sidebar', 'narrow')).toBe(true);
    let opened = false;
    const button = headerPaletteButton(() => {
      opened = true;
    });
    expect(button.label).toBe('搜索或执行');
    expect(button.kbd).toBe('P');
    expect(button.tooltip).toContain('P');
    button.onClick();
    expect(opened).toBe(true);
  });

  it('非嵌入宽屏和中屏不显示；窄屏侧栏隐藏时显示', () => {
    expect(showHeaderPaletteButton(null, 'wide')).toBe(false);
    expect(showHeaderPaletteButton(null, 'mid')).toBe(false);
    expect(showHeaderPaletteButton(null, 'narrow')).toBe(true);
  });
});

describe('网页不改 frame 名', () => {
  it('源码里不给 window.name 赋值', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const files = listSources(root);
    const assigned = files.filter((file) => /window\.name\s*=/.test(readFileSync(file, 'utf8')));
    expect(assigned).toEqual([]);
  });
});

function listSources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...listSources(path));
    else if (/\.(ts|tsx|js|css)$/.test(entry)) found.push(path);
  }
  return found;
}
