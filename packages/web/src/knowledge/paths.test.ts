import { describe, expect, it } from 'vitest';
import { filePath, inboxPath, libraryTarget, parseKnowledgePath, searchPath, topicPath, topicsPath } from './paths';

describe('知识台路径', () => {
  it('生成的路径按段编码，再解析回来不变', () => {
    const topic = topicPath('arsenal', '01_业务主题/会员体系');
    expect(topic).toBe('/knowledge/lib/arsenal/topic/01_%E4%B8%9A%E5%8A%A1%E4%B8%BB%E9%A2%98/%E4%BC%9A%E5%91%98%E4%BD%93%E7%B3%BB');
    expect(parseKnowledgePath(topic)).toEqual({ view: 'topics', library: 'arsenal', topic: '01_业务主题/会员体系', file: null });
    expect(parseKnowledgePath(filePath('personal', 'a b/c#d.md'))).toEqual({ view: 'topics', library: 'personal', topic: null, file: 'a b/c#d.md' });
    expect(parseKnowledgePath(searchPath('会员 积分'))).toEqual({ view: 'search', query: '会员 积分' });
    expect(parseKnowledgePath(inboxPath('_Inbox/草稿.md'))).toEqual({ view: 'inbox', file: '_Inbox/草稿.md' });
  });

  it('默认库的主题页是 /knowledge；其他库带 lib', () => {
    expect(topicsPath()).toBe('/knowledge');
    expect(topicsPath('arsenal')).toBe('/knowledge/lib/arsenal');
    expect(parseKnowledgePath('/knowledge')).toEqual({ view: 'topics', library: 'personal', topic: null, file: null });
    expect(parseKnowledgePath('/knowledge/lib/arsenal')).toEqual({ view: 'topics', library: 'arsenal', topic: null, file: null });
    expect(parseKnowledgePath('/knowledge/search')).toEqual({ view: 'search', query: '' });
  });

  it('坏的编码和不认识的路径回到主题页', () => {
    expect(parseKnowledgePath('/knowledge/whatever')).toEqual({ view: 'topics', library: 'personal', topic: null, file: null });
    expect(parseKnowledgePath('/knowledge/lib/arsenal/file/%E0%A4%A')).toEqual({ view: 'topics', library: 'arsenal', topic: null, file: null });
  });

  it('带扩展名的链接当文件，否则当主题目录', () => {
    expect(libraryTarget('personal', '02_a/b/README.md')).toBe(filePath('personal', '02_a/b/README.md'));
    expect(libraryTarget('arsenal', '02_产品能力/AgentOS/agent-os-prototype')).toBe(topicPath('arsenal', '02_产品能力/AgentOS/agent-os-prototype'));
  });
});
