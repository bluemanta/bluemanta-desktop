/**
 * 宿主插件用到的 dsh 形状。
 * `tools` 由宿主注入。`defineTool` 来自 peer 依赖 `@deepseek-ai/dsh-tools`，浏览器端不引用该包。
 */

export type FetchHandler = (request: Request) => Response | Promise<Response>;

export type FetchRoute = {
  path: string;
  methods: readonly string[];
  requestBody: 'buffered' | 'streaming';
  fetch: FetchHandler;
};

export type ToolRegistration = {
  name: string;
  description: string;
};

export type HostContext = {
  connection: {
    fetch: {
      register(route: FetchRoute): () => void;
    };
  };
  tools: {
    register(definition: ToolRegistration): () => void;
  };
  effect(enter: () => void | (() => void), label?: string): void;
};
