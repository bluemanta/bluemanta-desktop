import { describe, expect, it } from 'vitest';
import { ideasHotkeysEnabled } from './hotkeys';

describe('idea hotkey scope', () => {
  it('enables N and other idea shortcuts only below /ideas', () => {
    expect(ideasHotkeysEnabled('/ideas')).toBe(true);
    expect(ideasHotkeysEnabled('/ideas/stats')).toBe(true);
    expect(ideasHotkeysEnabled('/skills')).toBe(false);
    expect(ideasHotkeysEnabled('/')).toBe(false);
    expect(ideasHotkeysEnabled('/ideas-copy')).toBe(false);
  });
});
