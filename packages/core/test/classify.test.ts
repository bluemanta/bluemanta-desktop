import { describe, expect, it } from 'vitest';
import { CATEGORY_TIE_ORDER, classifyIdea, IDEA_KEYWORDS } from '../src/classify.js';

describe('自动分类', () => {
  it('关键词表里的每个词单独出现时命中自己的类别', () => {
    for (const keyword of IDEA_KEYWORDS) {
      expect(classifyIdea(keyword.text, ''), keyword.text).toBe(keyword.category);
      expect(classifyIdea('', keyword.text), keyword.text).toBe(keyword.category);
    }
  });

  it('标题命中分乘 2，所以标题里的低权重词可以压过正文里的高权重词', () => {
    // 客户：标题权重 2 × 2 = 4。晚饭：正文权重 4。并列时 work 在 life 之前。
    // 若不乘 2，正文的 life 会以 4 比 2 胜出。
    expect(classifyIdea('客户', '晚饭')).toBe('work');
  });

  it('并列时按 product、learning、work、life 取靠前的', () => {
    expect(CATEGORY_TIE_ORDER).toEqual(['product', 'learning', 'work', 'life']);
    expect(classifyIdea('mvp 学习', '')).toBe('product');
    expect(classifyIdea('deadline 周末', '')).toBe('work');
  });

  it('纯字母数字词整词匹配，mapp 不命中 app', () => {
    expect(classifyIdea('app', '')).toBe('product');
    expect(classifyIdea('mapp', '')).toBe('other');
    expect(classifyIdea('application', '')).toBe('other');
    expect(classifyIdea('推荐 app', '')).toBe('product');
    expect(classifyIdea('APP', '')).toBe('product');
  });

  it('无命中或正文标题都是空白时为 other', () => {
    expect(classifyIdea('hello', 'world')).toBe('other');
    expect(classifyIdea('   ', '\n\t')).toBe('other');
  });

  it('同一个词在同一段里只计一次，高权重词和其中的低权重词分别计分', () => {
    // app 若在正文里算两次，会和标题「散步」打成 4 比 4，product 靠并列顺序胜出。
    expect(classifyIdea('散步', 'app app')).toBe('life');
    // 「产品想法」含权重 4 和权重 2 的「产品」。只算长词时标题分是 8，低于正文 12。
    expect(classifyIdea('产品想法', '论文 方法论 podcast lesson')).toBe('product');
  });
});
