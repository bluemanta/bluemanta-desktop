import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type Registration = { name?: string; id?: string; key?: string; label?: string; order?: number };

/**
 * 在假宿主里真的执行一遍 client.js：工厂函数和 apply 不抛错，各个入口都注册上了。
 * React 换成只记录元素的替身，hooks 返回初始值，不需要浏览器。
 */
function loadClient() {
  const source = readFileSync(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8');
  type Definition = { id: string; factory: (require: (name: string) => unknown) => { inject: string[]; apply: (ctx: unknown) => void } };
  const holder: { definition: Definition | null } = { definition: null };
  const element = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({ type, props: props ?? {}, children: children.flat() });
  const React = {
    createElement: element,
    useState: (initial: unknown) => [typeof initial === 'function' ? (initial as () => unknown)() : initial, () => undefined],
    useEffect: () => undefined,
    useLayoutEffect: () => undefined,
    useRef: (value: unknown) => ({ current: value ?? null }),
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
  };
  const sandbox = {
    window: { __ModuleLoader__: { load: (value: Definition) => { holder.definition = value; } }, addEventListener: () => undefined, removeEventListener: () => undefined },
    document: { body: {} },
    location: { origin: 'dsh-app://app' },
    MutationObserver: class { observe() {} disconnect() {} },
    URL,
    console,
  };
  runInNewContext(source, sandbox);
  const loaded = holder.definition;
  if (!loaded) throw new Error('client.js 没有调用 __ModuleLoader__.load');
  const plugin = loaded.factory((name: string) => {
    if (name === 'react') return React;
    throw new Error(`未预期的依赖 ${name}`);
  });
  return { id: loaded.id, plugin, element };
}

function fakeContext() {
  const slots: Registration[] = [];
  const tabs: Array<Registration & { kind?: string }> = [];
  const components = new Map<string, unknown>();
  const ctx = {
    slots: {
      inject: (_name: string, register: () => unknown) => {
        const result = register() as { next?: unknown } | null | undefined;
        // 品牌槽位用生成器一次注册两个组件，要迭代一遍才会真正注册。
        if (result && typeof result.next === 'function') {
          for (const _ of result as unknown as Iterable<unknown>) void _;
        }
        return () => undefined;
      },
      register: (registration: Registration, component: unknown) => {
        slots.push(registration);
        components.set(`${registration.name}:${registration.key ?? registration.id ?? ''}`, component);
        return () => undefined;
      },
    },
    sidebarRightTabs: { register: (registration: Registration & { kind?: string }) => { tabs.push(registration); return () => undefined; } },
    sidebarRight: { mounted: { getSnapshot: () => 'session-1', subscribe: () => () => undefined }, openTabs: { subscribe: () => () => undefined, getSnapshot: () => [] }, registerCloseHandler: () => () => undefined },
    sessions: {},
    effect: (enter: () => unknown) => {
      enter();
    },
  };
  return { ctx, slots, tabs, components };
}

describe('client.js 在假宿主里执行', () => {
  it('工厂和 apply 不报错，灵感台与知识台的入口、右侧栏页、工具卡片都注册了', () => {
    const { id, plugin } = loadClient();
    expect(id).toBe('@bluemanta/dsh-plugin');
    const { ctx, slots, tabs } = fakeContext();
    expect(() => plugin.apply(ctx)).not.toThrow();
    const panels = slots.filter((item) => item.name === 'sidebar.panellist').map((item) => [item.id, item.label, item.order]);
    expect(panels).toEqual([
      ['bluemanta.ideas', '灵感台', 10],
      ['bluemanta.knowledge', '知识台', 11],
    ]);
    expect(slots.filter((item) => item.name === 'main').map((item) => item.key)).toEqual(['bluemanta.ideas', 'bluemanta.knowledge']);
    expect(tabs.map((item) => item.kind)).toEqual(['bluemanta.idea', 'bluemanta.knowledge']);
    const toolViews = slots.filter((item) => item.name === 'tool.call.toolview').map((item) => item.key);
    expect(toolViews).toEqual([
      'bluemanta_idea_capture',
      'bluemanta_idea_search',
      'bluemanta_idea_get',
      'bluemanta_knowledge_route',
      'bluemanta_knowledge_search',
      'bluemanta_knowledge_read',
    ]);
  });

  it('知识工具卡片能渲染搜索结果，并为库内结果和灵感分别放打开按钮', () => {
    const { plugin } = loadClient();
    const { ctx, components } = fakeContext();
    plugin.apply(ctx);
    const view = components.get('tool.call.toolview:bluemanta_knowledge_search') as (props: unknown) => { props: Record<string, unknown>; children: unknown[] };
    const text = [
      '找到 2 条（关键词：会员）：',
      '1. 会员体系 Topic Knowledge › 核心观点',
      '   库：arsenal　路径：01_业务主题/会员体系/Topic_Knowledge.md　主题：会员体系',
      '   摘录：会员等级按成长值划分',
      '2. 会员分层的新想法',
      '   灵感 id：card_1',
      '   摘录：按最近消费',
    ].join('\n');
    const tree = view({ phase: 'result', toolName: 'bluemanta_knowledge_search', block: { call: { argsRaw: '{"query":"会员"}' }, content: [{ type: 'text', text }] } });
    expect(tree.props['data-bluemanta-tool']).toBe('bluemanta_knowledge_search');
    const serialized = JSON.stringify(tree, (_key, value) => (typeof value === 'function' ? value.name || 'fn' : value));
    expect(serialized).toContain('会员体系 Topic Knowledge › 核心观点');
    expect(serialized).toContain('Arsenal · 会员等级按成长值划分');
    expect(serialized).toContain('OpenKnowledgeButton');
    expect(serialized).toContain('OpenIdeaButton');
  });
});
