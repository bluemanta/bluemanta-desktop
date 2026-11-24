/** Minimal XML property-list reader (spec personalos-sources 3.1): dict, array, string, integer, real, true, false, date, data. */
export type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text: string): string => text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, code: string) =>
  code[0] === '#' ? String.fromCodePoint(code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))) : ENTITIES[code.toLowerCase()]!);

export function parsePlist(input: string | Buffer): PlistValue {
  const text = typeof input === 'string' ? input : input.toString('utf8');
  if (text.startsWith('bplist')) throw new Error('binary plist');
  const tokens = [...text.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>|([^<]+)/g)];
  let index = 0;
  const skipText = (): void => { while (index < tokens.length && tokens[index]![4] !== undefined && tokens[index]![4]!.trim() === '') index += 1; };
  const textUntil = (name: string): string => {
    let value = '';
    while (index < tokens.length) {
      const token = tokens[index]!; index += 1;
      if (token[4] !== undefined) value += token[4];
      else if (token[1] === '/' && token[2] === name) return decode(value);
      else throw new Error(`unexpected <${token[2]}> in <${name}>`);
    }
    throw new Error(`unclosed <${name}>`);
  };
  const value = (): PlistValue => {
    skipText(); const token = tokens[index]; if (!token || token[4] !== undefined || token[1] === '/') throw new Error('expected a value');
    index += 1; const name = token[2]!; const selfClosing = token[3] === '/';
    switch (name) {
      case 'true': if (!selfClosing) textUntil('true'); return true;
      case 'false': if (!selfClosing) textUntil('false'); return false;
      case 'string': return selfClosing ? '' : textUntil('string');
      case 'date': case 'data': return selfClosing ? '' : textUntil(name).trim();
      case 'integer': case 'real': { const raw = selfClosing ? '0' : textUntil(name).trim(); const number = Number(raw); if (Number.isNaN(number)) throw new Error(`bad ${name}`); return number; }
      case 'array': {
        const items: PlistValue[] = []; if (selfClosing) return items;
        for (;;) { skipText(); const next = tokens[index]; if (!next) throw new Error('unclosed <array>'); if (next[1] === '/' && next[2] === 'array') { index += 1; return items; } items.push(value()); }
      }
      case 'dict': {
        const result: { [key: string]: PlistValue } = {}; if (selfClosing) return result;
        for (;;) {
          skipText(); const next = tokens[index]; if (!next) throw new Error('unclosed <dict>');
          if (next[1] === '/' && next[2] === 'dict') { index += 1; return result; }
          if (next[2] !== 'key' || next[1] === '/') throw new Error('expected <key>');
          index += 1; const key = next[3] === '/' ? '' : textUntil('key'); result[key] = value();
        }
      }
      default: throw new Error(`unsupported <${name}>`);
    }
  };
  // Skip prolog and doctype until <plist>.
  while (index < tokens.length && tokens[index]![2] !== 'plist') index += 1;
  if (index >= tokens.length) throw new Error('no <plist>');
  index += 1; const result = value();
  return result;
}
