/** 宿主插件用到的 dsh 形状。运行时不依赖 `@deepseek-ai/*`。 */

export type FetchHandler = (request: Request) => Response | Promise<Response>;

export type FetchRoute = {
  path: string;
  methods: readonly string[];
  requestBody: 'buffered' | 'streaming';
  fetch: FetchHandler;
};

export type HostContext = {
  connection: {
    fetch: {
      register(route: FetchRoute): () => void;
    };
  };
  effect(enter: () => void | (() => void), label?: string): void;
};
