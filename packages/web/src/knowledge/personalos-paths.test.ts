import { describe, expect, it } from 'vitest';
import { domainPath, parsePersonalOsPath, personalOsFilePath, personalOsTarget, TODAY_PATH } from './personalos-paths';

describe('PersonalOS 路由与历史书签', () => {
  it('默认入口、旧个人库和收件箱统一重定向到今天', () => {
    for (const path of ['/knowledge', '/knowledge/', '/knowledge/lib/personal', '/knowledge/lib/personal/topic/旧主题', '/knowledge/inbox', '/knowledge/inbox/file/旧文.md']) {
      expect(parsePersonalOsPath(path)).toEqual({ view: 'redirect', to: TODAY_PATH });
    }
  });
  it('领域名和文件路径编码往返，搜索与 Arsenal 深链保持可用', () => {
    expect(parsePersonalOsPath(domainPath('3.产品'))).toEqual({ view: 'domains', domain: '3.产品' });
    expect(parsePersonalOsPath(domainPath('.隐藏'))).toEqual({ view: 'redirect', to: TODAY_PATH });
    expect(parsePersonalOsPath(domainPath('工作 & 生活'))).toEqual({ view: 'domains', domain: '工作 & 生活' });
    expect(parsePersonalOsPath(personalOsFilePath('领域/工作/含 空格.md'))).toEqual({ view: 'file', file: '领域/工作/含 空格.md' });
    expect(parsePersonalOsPath('/knowledge/lib/arsenal/topic/01_%E4%B8%9A%E5%8A%A1/%E4%BC%9A%E5%91%98')).toEqual({ view: 'arsenal', topic: '01_业务/会员', file: null });
    expect(parsePersonalOsPath('/knowledge/resources/arsenal')).toEqual({ view: 'arsenal', topic: null, file: null });
    expect(parsePersonalOsPath('/knowledge/search/%E6%90%9C%E7%B4%A2%20%E8%AF%8D')).toEqual({ view: 'search', query: '搜索 词' });
    expect(parsePersonalOsPath('/knowledge/today?embed=main')).toEqual({ view: 'today' });
  });
  it('异常编码不抛错，状态文件优先按路由领域名打开，其余文件进阅读器', () => {
    expect(parsePersonalOsPath('/knowledge/domains/%E0%A4%A')).toEqual({ view: 'redirect', to: TODAY_PATH });
    expect(personalOsTarget('领域/工作/状态.md', [{ id: '职业', path: '领域/工作' }])).toBe(domainPath('职业'));
    expect(personalOsTarget('我/状态.md')).toBe(domainPath('我'));
    expect(personalOsTarget('协议/阅读.md')).toBe(personalOsFilePath('协议/阅读.md'));
    expect(personalOsTarget('领域/工作/知识.md')).toBe(personalOsFilePath('领域/工作/知识.md'));
  });
});
