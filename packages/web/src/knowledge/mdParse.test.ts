import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Markdown, InlineMarkdown, outline, headingAnchor } from './Markdown';
import { PersonalOsDomainDetail } from './PersonalOsDomainDetail';
import { FileReader } from './FileReader';
import { knowledgeKeys, personalOsKeys } from './api';
import type { PersonalOsDomainResponse, PersonalOsFileResponse } from '@bluemanta/server/api-types';
import { inlineText, parseInline, parseMarkdown, resolveLink, type Block } from './mdParse';

describe('行内', () => {
  it('代码、加粗、斜体、链接，HTML 原样当文字', () => {
    expect(parseInline('用 `topic_id` 和 **重点** 与 *强调*，见 [说明](a.md) <b>x</b>')).toEqual([
      { type: 'text', text: '用 ' },
      { type: 'code', text: 'topic_id' },
      { type: 'text', text: ' 和 ' },
      { type: 'strong', children: [{ type: 'text', text: '重点' }] },
      { type: 'text', text: ' 与 ' },
      { type: 'em', children: [{ type: 'text', text: '强调' }] },
      { type: 'text', text: '，见 ' },
      { type: 'link', href: 'a.md', children: [{ type: 'text', text: '说明' }] },
      { type: 'text', text: ' <b>x</b>' },
    ]);
  });

  it('下划线在词中间不算斜体；转义字符原样输出；裸网址成链接', () => {
    expect(inlineText(parseInline('Topic_Knowledge_Template'))).toBe('Topic_Knowledge_Template');
    expect(parseInline('Topic_Knowledge_Template')).toEqual([{ type: 'text', text: 'Topic_Knowledge_Template' }]);
    expect(parseInline('\\*不是强调\\*')).toEqual([{ type: 'text', text: '*不是强调*' }]);
    expect(parseInline('见 https://example.com/a，然后')).toEqual([
      { type: 'text', text: '见 ' },
      { type: 'link', href: 'https://example.com/a', children: [{ type: 'text', text: 'https://example.com/a' }] },
      { type: 'text', text: '，然后' },
    ]);
  });

  it('图片按链接显示，不加载', () => {
    expect(parseInline('![截图](img/a.png)')).toEqual([{ type: 'link', href: 'img/a.png', children: [{ type: 'text', text: '截图' }] }]);
  });
});

describe('块', () => {
  it('标题、段落、分隔线、引用、代码块（代码里的 # 不是标题）', () => {
    const blocks = parseMarkdown('---\ntitle: x\n---\n# 标题\n\n第一行\n第二行\n\n---\n\n> 引用\n> 第二行\n\n```ts\n# 不是标题\nconst a = 1;\n```\n');
    expect(blocks.map((block) => block.type)).toEqual(['heading', 'paragraph', 'rule', 'quote', 'code']);
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 1, text: '标题' });
    expect(blocks[1]).toEqual({ type: 'paragraph', children: [{ type: 'text', text: '第一行\n第二行' }] });
    expect(blocks[4]).toEqual({ type: 'code', lang: 'ts', text: '# 不是标题\nconst a = 1;' });
  });

  it('表格：按表头补齐单元格，竖线转义和代码里的竖线不拆列', () => {
    const [table] = parseMarkdown('| Topic | Path | Notes |\n| --- | --- | --- |\n| 会员 | `a|b` | x \\| y |\n| 只有一格 |\n');
    expect(table?.type).toBe('table');
    if (table?.type !== 'table') return;
    expect(table.header.map(inlineText)).toEqual(['Topic', 'Path', 'Notes']);
    expect(table.rows.map((row) => row.map(inlineText))).toEqual([
      ['会员', 'a|b', 'x | y'],
      ['只有一格', '', ''],
    ]);
  });

  it('列表：有序、无序、任务、嵌套和续行', () => {
    const blocks = parseMarkdown('- 第一项\n  续行\n  - 子项\n- [x] 已完成\n- [ ] 未完成\n\n1. 甲\n2. 乙\n');
    expect(blocks.map((block) => block.type)).toEqual(['list', 'list']);
    const bullet = blocks[0] as Extract<Block, { type: 'list' }>;
    expect(bullet.ordered).toBe(false);
    expect(bullet.items.map((item) => [inlineText(item.children), item.checked])).toEqual([
      ['第一项 续行', null],
      ['已完成', true],
      ['未完成', false],
    ]);
    expect(bullet.items[0]?.nested[0]).toMatchObject({ type: 'list' });
    expect((blocks[1] as Extract<Block, { type: 'list' }>).ordered).toBe(true);
  });
});

describe('链接解析', () => {
  it('库内相对路径按当前文件所在目录解析', () => {
    expect(resolveLink('../../03_AI与技术/AI关注/README.md', '02_职业与业务/售前方法/README.md')).toEqual({
      kind: 'library',
      path: '03_AI与技术/AI关注/README.md',
      anchor: null,
    });
    expect(resolveLink('客户研究清单.md#会前准备', '02_职业与业务/售前方法/README.md')).toEqual({
      kind: 'library',
      path: '02_职业与业务/售前方法/客户研究清单.md',
      anchor: '会前准备',
    });
    expect(resolveLink('%E8%AF%B4%E6%98%8E.md', 'a/b.md')).toMatchObject({ path: 'a/说明.md' });
  });

  it('越出库根、绝对路径、~ 开头和危险协议都不跳', () => {
    expect(resolveLink('../../x.md', 'a/b.md')).toEqual({ kind: 'none' });
    expect(resolveLink('/etc/passwd', 'a/b.md')).toEqual({ kind: 'none' });
    expect(resolveLink('~/Documents/x.md', 'a/b.md')).toEqual({ kind: 'none' });
    expect(resolveLink('javascript:alert(1)', 'a/b.md')).toEqual({ kind: 'none' });
    expect(resolveLink('https://example.com', 'a/b.md')).toEqual({ kind: 'external', href: 'https://example.com' });
  });
});


describe('PersonalOS 的 Markdown 显示', () => {
  it('本页锚点和跨文件锚点解码，危险或损坏的链接不跳转', () => {
    expect(resolveLink('#%E7%8E%B0%E7%8A%B6', '领域/工作/状态.md')).toEqual({ kind: 'anchor', anchor: '现状' });
    expect(resolveLink('../写作/状态.md#当前重点', '领域/工作/状态.md')).toEqual({ kind: 'library', path: '领域/写作/状态.md', anchor: '当前重点' });
    expect(resolveLink('#%ZZ', '领域/工作/状态.md')).toEqual({ kind: 'none' });
    expect(resolveLink('%ZZ.md', '领域/工作/状态.md')).toEqual({ kind: 'none' });
    expect(headingAnchor('Hello，世界！ Next Step')).toBe('hello世界-next-step');
  });

  it('只高亮文本节点，不改代码、链接目标，不注入 HTML', () => {
    const html = renderToStaticMarkup(createElement(Markdown, {
      source: '**待补充** （推断） [未核验](https://example.org/未核验) `待补充`\n\n```text\n未核验\n```\n\n<img src=x onerror=alert(1)>',
      basePath: '领域/工作/状态.md', onOpen: () => {}, highlightTerms: ['待补充', '（推断）', '未核验'],
    }));
    expect(html.match(/<mark>/g)).toHaveLength(3);
    expect(html).toContain('<code>待补充</code>');
    expect(html).toContain('<code>未核验</code>');
    expect(html).toContain('href="https://example.org/未核验"');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
    expect(html).toContain('rel="noreferrer noopener"');
    const inline = renderToStaticMarkup(createElement(InlineMarkdown, { source: '[原文](资料.md)', basePath: '领域/工作/状态.md', onOpen: () => {} }));
    expect(inline).toContain('<a href="#">原文</a>');
  });

  it('各 Markdown 实例标题 ID 不冲突，保留阅读器目录索引', () => {
    const source = '# 正文\n\n## 现状\n\n### 小节';
    const html = renderToStaticMarkup(createElement('div', null, ...[0, 1].map((key) => createElement(Markdown, { key, source, basePath: '状态.md', onOpen: () => {} }))));
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(6);
    expect(outline(source)).toEqual([{ id: 'kb-h-1', text: '现状', level: 2 }, { id: 'kb-h-2', text: '小节', level: 3 }]);
    expect(html.match(/data-outline-id="kb-h-1"/g)).toHaveLength(2);
  });

  it('领域详情结构化行与未知文字按原节序共存；等待不推算、未知标签保留', () => {
    const file = '领域/演示/状态.md';
    const markdown = '# 特别的开头\n## 未结事项\n开头备注\n- [ ] 检查待补充 @wait(协作者) @every(1w) @custom(x)\n### 未识别小节\n后续解释\n## 近期变化\n- 2026-11-20 一个变化\n日期行后的说明\n## 去哪查\n[跳到事项](#未结事项)\n### 外部资料\n未核验\n## 空节\n暂无';
    const data: PersonalOsDomainResponse = {
      ok: true, id: '演示', name: '演示', path: '领域/演示', aliases: [], keywords: [], typicalQuestions: [], registered: true,
      exists: true, updatedAt: null, stale: true, staleDays: null, openCount: 1, overdueCount: 0, gapCount: 1, latestChange: null, availability: 'available', warnings: [], file, markdown,
      sections: [
        { title: '', kind: 'other', line: 1, markdown: '# 特别的开头', empty: false },
        { title: '未结事项', kind: 'todos', line: 2, markdown: '开头备注\n- [ ] 检查待补充 @wait(协作者) @every(1w) @custom(x)\n### 未识别小节\n后续解释', empty: false },
        { title: '近期变化', kind: 'changes', line: 7, markdown: '- 2026-11-20 一个变化\n日期行后的说明', empty: false },
        { title: '去哪查', kind: 'references', line: 10, markdown: '[跳到事项](#未结事项)\n### 外部资料\n未核验', empty: false },
        { title: '空节', kind: 'other', line: 14, markdown: '暂无', empty: true },
      ],
      todos: [{ id: `${file}:4`, domain: '演示', file, line: 4, text: '检查待补充', done: false, doneAt: null, due: null, wait: '协作者', every: '1w', tags: ['@custom(x)'], bucket: 'waiting', warnings: [], raw: '- [ ] 检查待补充 @wait(协作者) @every(1w) @custom(x)', hash: '' }],
      changes: [{ date: '2026-11-20', text: '一个变化', line: 8 }], links: '[跳到事项](#未结事项)', mounts: [{ title: '外部资料', markdown: '未核验' }], registry: [], matters: [], knowledge: [], files: [],
    };
    const client = new QueryClient();
    client.setQueryData(personalOsKeys.domain('演示'), data);
    client.setQueryData(personalOsKeys.overview, { today: '2026-11-21', root: '~/Documents/PersonalOS' });
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(PersonalOsDomainDetail, { id: '演示', onOpen: () => {} })));
    for (const text of ['特别的开头', '开头备注', '未识别小节', '后续解释', '一个变化', '日期行后的说明', '外部资料', '暂无']) expect(html).toContain(text);
    expect(html.indexOf('后续解释')).toBeLessThan(html.indexOf('日期行后的说明'));
    expect(html).toContain(`data-todo-id="${file}:4"`);
    expect(html).toContain('title="等了多久：未记录"');
    expect(html).toContain('等待：协作者');
    expect(html).toContain('每 1w');
    expect(html).toContain('@custom(x)');
    expect(html).toContain('data-testid="personalos-mount"');
    expect(html).toContain('外部 · 只读');
    expect(html).not.toContain('type="checkbox"');
    client.clear();
  });

  it('iCloud 阅读器显示占位提示，保留 PersonalOS 面包屑且不当成空正文', () => {
    const path = '领域/演示/待下载.md';
    const data: PersonalOsFileResponse = {
      ok: true, library: { id: 'personalos', name: 'PersonalOS', root: '~/Documents/PersonalOS', writable: false, exists: true, indexFile: 'AGENTS.md', topicCount: 0, inboxCount: 0 },
      file: { path, name: '待下载.md', kind: 'markdown', size: 0, modifiedAt: null, availability: 'icloud' }, displayPath: `~/Documents/PersonalOS/${path}`,
    };
    const client = new QueryClient();
    client.setQueryData(knowledgeKeys.file('personalos', path), data);
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(FileReader, { library: 'personalos', path, onOpen: () => {} })));
    expect(html).toContain('data-testid="personalos-reader"');
    expect(html).toContain('尚未从 iCloud 下载');
    expect(html).toContain('重新读取');
    expect(html).toContain('PersonalOS');
    expect(html).toContain('演示');
    expect(html).not.toContain('修改于');
    expect(html).not.toContain('>0 B<');
    client.clear();
  });
});
