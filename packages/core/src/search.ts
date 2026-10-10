import { CATEGORY_LABELS } from './classify.js';
import type { Card, CardSearchField, CardSearchHit } from './types.js';

export const EXCERPT_CHARS = 120;

const FIELD_ORDER: readonly CardSearchField[] = ['title', 'body', 'rawInput', 'category'];

function rawText(card: Card): string {
  return card.rawInput.status === 'present' ? card.rawInput.text : '';
}

function categoryText(card: Card): string {
  if (card.cardType !== 'idea') return '';
  return CATEGORY_LABELS[card.fields.category];
}

function fieldText(card: Card, field: CardSearchField): string {
  if (field === 'title') return card.title;
  if (field === 'body') return card.body;
  if (field === 'rawInput') return rawText(card);
  return categoryText(card);
}

export function searchKeywords(query: string): string[] {
  return query.trim().split(/\s+/u).filter((keyword) => keyword !== '');
}

function findFold(haystack: string, needle: string): { index: number; length: number } | null {
  if (needle === '') return null;
  const foldedHaystack = haystack.toLowerCase();
  const foldedNeedle = needle.toLowerCase();
  if (foldedHaystack.length === haystack.length && foldedNeedle.length === needle.length) {
    const index = foldedHaystack.indexOf(foldedNeedle);
    if (index < 0) return null;
    return { index, length: foldedNeedle.length };
  }
  const haystackChars = Array.from(haystack);
  const needleChars = Array.from(foldedNeedle);
  for (let start = 0; start <= haystackChars.length - needleChars.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < needleChars.length; offset += 1) {
      const char = haystackChars[start + offset];
      if (char === undefined || char.toLowerCase() !== needleChars[offset]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    const index = haystackChars.slice(0, start).join('').length;
    const length = haystackChars.slice(start, start + needleChars.length).join('').length;
    return { index, length };
  }
  return null;
}

function excerptAround(text: string, index: number, length: number): string {
  const chars = Array.from(text);
  if (chars.length <= EXCERPT_CHARS) return text;
  const prefix = Array.from(text.slice(0, index));
  const match = Array.from(text.slice(index, index + length));
  const matchStart = prefix.length;
  const matchLength = Math.min(Math.max(match.length, 1), EXCERPT_CHARS);
  const pad = EXCERPT_CHARS - matchLength;
  const before = Math.floor(pad / 2);
  let from = matchStart - before;
  let to = matchStart + matchLength + (pad - before);
  if (from < 0) {
    to -= from;
    from = 0;
  }
  if (to > chars.length) {
    from -= to - chars.length;
    to = chars.length;
  }
  if (from < 0) from = 0;
  if (to - from > EXCERPT_CHARS) to = from + EXCERPT_CHARS;
  return chars.slice(from, to).join('');
}

function hitFor(card: Card, keywords: readonly string[]): CardSearchHit | null {
  const texts = FIELD_ORDER.map((field) => ({ field, text: fieldText(card, field) }));
  for (const keyword of keywords) {
    const found = texts.some((item) => findFold(item.text, keyword) !== null);
    if (!found) return null;
  }

  for (const item of texts) {
    let earliest: { index: number; length: number } | null = null;
    for (const keyword of keywords) {
      const found = findFold(item.text, keyword);
      if (found === null) continue;
      if (earliest === null || found.index < earliest.index) earliest = found;
    }
    if (earliest === null) continue;
    return {
      card,
      field: item.field,
      excerpt: excerptAround(item.text, earliest.index, earliest.length),
    };
  }
  return null;
}

/** 关键词按空白切分，全部命中（AND），不区分大小写。空查询没有关键词，返回空列表。 */
export function searchCardRecords(cards: readonly Card[], query: string): CardSearchHit[] {
  const keywords = searchKeywords(query);
  if (keywords.length === 0) return [];
  const hits: CardSearchHit[] = [];
  for (const card of cards) {
    const hit = hitFor(card, keywords);
    if (hit) hits.push(hit);
  }
  hits.sort((left, right) => {
    if (left.card.createdAt !== right.card.createdAt) {
      return left.card.createdAt < right.card.createdAt ? 1 : -1;
    }
    if (left.card.id === right.card.id) return 0;
    return left.card.id < right.card.id ? 1 : -1;
  });
  return hits;
}
