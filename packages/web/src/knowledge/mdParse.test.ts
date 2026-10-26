import { describe, expect, it } from 'vitest';
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
