# FastMCP-TS

一个用于构建 Model Context Protocol（MCP）服务端的 TypeScript 框架，使用装饰器的语法让你以更直观的方式定义工具（tools）、提示（prompts）与资源（resources）。

## 功能特性

- 🎯 **装饰器 API**：通过简洁的装饰器定义 MCP 的工具、提示与资源
- 🚀 **多种传输方式**：支持 stdio、SSE、可流式 HTTP（streamable HTTP）
- 📝 **TypeScript 优先**：完善的类型提示与类型安全
- 🔧 **Zod 集成**：使用 Zod 做参数校验
- 🌐 **HTTP 集成**：可与 Express、Koa v3、hapi、AdonisJS、NestJS 集成
- 📝 **文档驱动的元信息（类 TSDoc）**：当装饰器选项缺省时，可从方法上方的注释推断描述与参数
- ⚖️ **装饰器优先级**：装饰器中的字段优先于注释推断值
- 🧪 **良好的开发/测试体验**：通过 tsx 直接运行 TS 源码，src 与 tests 编译到同一 `dist/`
- 📒 **结构化日志**：内置 Pino 日志（开发环境可美化输出）

## 安装

```bash
npm install fastmcp-ts
```

## 快速上手

### 1. 基础工具服务

```typescript
import { FastMCP, tool } from 'fastmcp-ts';
import { z } from 'zod';

class MathTools {
  /**
   * 两数相加。
   * @param a 第一个数
   * @param b 第二个数
   * @returns a 与 b 的和
   */
  @tool() // 名称默认取方法名；描述/参数可从注释推断
  async add({ a, b }: { a: number; b: number }) {
    return a + b;
  }

  /**
   * 两数相乘。
   * @param a 第一个数
   * @param b 第二个数
   * @returns a 与 b 的积
   */
  @tool({
    name: 'product',              // 装饰器覆盖注释中的名称
    parameters: z.object({        // 装饰器覆盖注释推断的参数
      a: z.number(),
      b: z.number(),
    }),
  })
  async multiply({ a, b }: { a: number; b: number }) {
    return a * b;
  }
}

const server = new FastMCP({ name: 'math-server', version: '1.0.0' });
server.register(new MathTools());
await server.serve(); // 默认使用 stdio
```

### 2. 使用 Express 的 HTTP 服务器（可选）

```typescript
import express from 'express'; // 可选，仅用于 HTTP 示例
import { FastMCP, tool } from 'fastmcp-ts';
import { z } from 'zod';

class MyTools {
  @tool({
    name: 'greet',
    description: '打招呼',
    parameters: z.object({ name: z.string() }),
  })
  async greet({ name }: { name: string }) {
    return `Hello, ${name}!`;
  }
}

const server = new FastMCP({ name: 'greeting-server', version: '1.0.0' });
server.register(new MyTools());

// 配置为可流式 HTTP 传输
const transportConfig = FastMCP.createStreamableHTTPConfig({
  sessionIdGenerator: undefined,
});
await server.serve(transportConfig);

// 创建 Express 应用
const app = express();
app.use(express.json());

app.post('/mcp', async (req, res) => {
  const transport = server.getTransport();
  await transport.handleRequest(req, res, req.body);
});

app.listen(3000, () => {
  console.log('MCP server running on port 3000');
});
```

### 3. 使用 Koa v3 的 HTTP 服务器（可选）

```typescript
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import Router from '@koa/router';
import { FastMCP, tool } from 'fastmcp-ts';
import { z } from 'zod';

class MyTools {
  @tool({ name: 'greet', parameters: z.object({ name: z.string() }) })
  async greet({ name }: { name: string }) { return `Hello, ${name}!`; }
}

const server = new FastMCP({ name: 'greeting-server', version: '1.0.0' });
server.register(new MyTools());
await server.serve(FastMCP.createStreamableHTTPConfig({ sessionIdGenerator: undefined }));
const transport = server.getTransport();

const app = new Koa();
const router = new Router();
app.use(bodyParser());

router.post('/mcp', async (ctx) => {
  await transport.handleRequest(
    ctx.req as any,
    ctx.res as any,
    ctx.request.body,
  );
  ctx.respond = false; // 由 transport 直接写入响应
});

app.use(router.routes());
app.use(router.allowedMethods());
app.listen(3000);
```

### 4. 使用 hapi 的 HTTP 服务器（可选）

```typescript
import Hapi from '@hapi/hapi';
import { FastMCP, tool } from 'fastmcp-ts';
import { z } from 'zod';

class MyTools {
  @tool({ name: 'greet', parameters: z.object({ name: z.string() }) })
  async greet({ name }: { name: string }) { return `Hello, ${name}!`; }
}

const server = new FastMCP({ name: 'greeting-server', version: '1.0.0' });
server.register(new MyTools());
await server.serve(FastMCP.createStreamableHTTPConfig({ sessionIdGenerator: undefined }));
const transport = server.getTransport();

const app = Hapi.server({ port: 3000, host: 'localhost' });
app.route({
  method: 'POST',
  path: '/mcp',
  options: { payload: { parse: true, output: 'data' } },
  handler: async (request, h) => {
    const res = request.raw.res;
    await transport.handleRequest(request.raw.req as any, res as any, request.payload);
    return h.abandon; // 响应已写入
  },
});

await app.start();
```

### 5. 使用 AdonisJS 的 HTTP 路由（可选）

```typescript
// start/routes.ts
import Route from '@ioc:Adonis/Core/Route';
import { FastMCP, tool } from 'fastmcp-ts';
import { z } from 'zod';

class MyTools {
  @tool({ name: 'greet', parameters: z.object({ name: z.string() }) })
  async greet({ name }: { name: string }) { return `Hello, ${name}!`; }
}

const mcp = new FastMCP({ name: 'greeting-server', version: '1.0.0' });
mcp.register(new MyTools());
await mcp.serve(FastMCP.createStreamableHTTPConfig({ sessionIdGenerator: undefined }));
const transport = mcp.getTransport();

Route.post('/mcp', async ({ request, response }) => {
  await transport.handleRequest(request.request as any, response.response as any, request.body());
});
```

### 6. 使用 NestJS 的 HTTP 控制器（可选）

```typescript
import { Controller, Post, Req, Res } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { FastMCP, tool } from 'fastmcp-ts';
import { z } from 'zod';

class MyTools {
  @tool({ name: 'greet', parameters: z.object({ name: z.string() }) })
  async greet({ name }: { name: string }) { return `Hello, ${name}!`; }
}

const mcp = new FastMCP({ name: 'greeting-server', version: '1.0.0' });
mcp.register(new MyTools());
await mcp.serve(FastMCP.createStreamableHTTPConfig({ sessionIdGenerator: undefined }));
const transport = mcp.getTransport();

@Controller()
class AppController {
  @Post('mcp')
  async mcp(@Req() req: any, @Res() res: any) {
    await transport.handleRequest(req, res, req.body);
  }
}

@Module({ controllers: [AppController] })
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}

bootstrap();
```

## API 参考

### 装饰器

#### `@tool(options: ToolOptions)`

将方法声明为 MCP 工具。

```typescript
interface ToolOptions {
  name?: string;                 // 工具名称；默认使用方法名
  description?: string;          // 描述；若缺省则尝试从注释推断
  parameters?: z.ZodSchema<any>; // Zod 模式；若缺省则尝试从 @param 注释推断
}
```

示例：
```typescript
@tool({
  name: 'file_read',
  description: '读取文件内容',
  parameters: z.object({
    path: z.string().describe('文件路径'),
    encoding: z.string().optional().describe('文件编码（默认：utf-8）'),
  }),
})
async readFile({ path, encoding = 'utf-8' }: { path: string; encoding?: string }) {
  return fs.readFileSync(path, encoding);
}
```

注意：
- MCP 协议的调用参数是一个对象。即便是“两数相加”，也应使用 `async fn({ a, b }: { a:number; b:number })`。
- 注释推断支持：摘要行、`@param 名称 描述`、`@returns 描述`。
- 装饰器优先级更高：当装饰器提供了字段，注释不会覆盖它。

#### `@prompt(options: PromptOptions)`

将方法声明为 MCP 提示。

```typescript
interface PromptOptions {
  name: string;           // 提示名称
  description?: string;   // 提示描述
  arguments?: z.ZodSchema<any>; // 参数模式
}
```

示例：
```typescript
@prompt({
  name: 'code_review',
  description: '生成代码评审提示',
  arguments: z.object({
    language: z.string(),
    code: z.string(),
  }),
})
async codeReviewPrompt({ language, code }: { language: string; code: string }) {
  return `请评审以下 ${language} 代码：\n\n${code}`;
}
```

#### `@resource(options: ResourceOptions)`

将方法声明为 MCP 资源。

```typescript
interface ResourceOptions {
  uri: string | RegExp;   // 资源 URI 或正则
  name?: string;          // 资源名称
  description?: string;   // 资源描述
  mimeType?: string;      // MIME 类型（默认：text/plain）
}
```

示例：
```typescript
@resource({
  uri: /^file:\/\/(.+)$/,
  name: 'file_system',
  description: '文件系统资源',
  mimeType: 'text/plain',
})
async readResource({ uri }: { uri: string }) {
  const match = uri.match(/^file:\/\/(.+)$/);
  if (match) return fs.readFileSync(match[1], 'utf-8');
  throw new Error('无效的文件 URI');
}
```

### FastMCP 类

#### 构造函数

```typescript
new FastMCP(options: { name: string; version: string })
```

#### 方法

- `register(instance: any)`: 注册包含装饰器方法的实例。
- `serve(transportConfig?: TransportConfig)`: 按给定传输配置启动服务。
- `close()`: 关闭服务与传输。

#### 传输配置助手（静态方法）

```typescript
FastMCP.createStdioConfig(): StdioTransportConfig
FastMCP.createSSEConfig(endpoint: string, response: ServerResponse, options?: SSEServerTransportOptions): SSETransportConfig
FastMCP.createStreamableHTTPConfig(options: StreamableHTTPServerTransportOptions): StreamableHTTPTransportConfig
```

## 传输方式

### 1. Stdio（默认）

```typescript
await server.serve();
// 或显式：
await server.serve(FastMCP.createStdioConfig());
```

### 2. SSE（服务端推送事件）

```typescript
import type { ServerResponse } from 'node:http';

const config = FastMCP.createSSEConfig('/sse', response, {
  // SSE 选项
});
await server.serve(config);
```

### 3. 可流式 HTTP（Streamable HTTP）

```typescript
const config = FastMCP.createStreamableHTTPConfig({
  sessionIdGenerator: undefined,
});
await server.serve(config);
```

## 文档驱动元信息

当在 `@tool` 中省略 `description` 或 `parameters` 时，FastMCP-TS 会尝试读取装饰器上方的注释并推断：
- 描述：来自摘要文本；
- 参数：来自 `@param` 标注。简单的启发式会将“number/boolean/array”等关键词映射为对应的 Zod 类型；其他情况默认为 string。

装饰器字段优先。例如：

```ts
/**
 * 两数相乘
 * @param a 第一个数
 * @param b 第二个数
 * @returns 积
 */
@tool({
  name: 'multiply1',
  parameters: z.object({ a: z.number(), b: z.number() })
})
async multiply({ a, b }: { a: number; b: number }) { /* ... */ }
// 结果：name=multiply1，description 来自注释，parameters 来自装饰器
```

## 开发与构建

本仓库会将 `src/` 与 `tests/` 编译到同一个扁平的 `dist/`：
- `tsconfig.src.json`：编译 `src → dist`（生成 d.ts）
- `tsconfig.tests.json`：编译 `tests → dist`（不生成 d.ts）
- `npm run build`：顺序运行两者

使用 tsx 的无构建开发方式：
- 通过 `package.json` 的 `imports` 别名实现：
  - 开发：`#fastmcp` → `./src/index.ts`
  - 默认：`#fastmcp` → `./dist/index.js`
- 测试文件示例：`import { FastMCP, tool } from '#fastmcp'`
- 运行：

```bash
tsx tests/simple-demo.ts
```

构建并运行已编译的 JS：

```bash
npm run build
node dist/simple-demo.js
```

命名冲突说明：若 `src/foo.ts` 与 `tests/foo.ts` 同名，都会输出为 `dist/foo.js`，会互相覆盖。请重命名或将 tests 的 outDir 调整为 `dist/tests`。

## 日志

FastMCP-TS 使用 `pino` 进行结构化日志。
- 日志级别：设置 `FASTMCP_LOG_LEVEL=debug`（或 `LOG_LEVEL`）。
- 美化输出：设置 `PINO_PRETTY=1`。

PowerShell 示例：

```powershell
$env:FASTMCP_LOG_LEVEL = 'debug'
$env:PINO_PRETTY = '1'
tsx tests/simple-demo.ts
```

## 进阶示例

### 文件操作服务

```typescript
import { FastMCP, tool, resource } from 'fastmcp-ts';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

class FileOperations {
  @tool({
    name: 'list_directory',
    description: '列出目录内容',
    parameters: z.object({
      path: z.string().describe('目录路径'),
    }),
  })
  async listDirectory({ path: dirPath }: { path: string }) {
    const files = fs.readdirSync(dirPath);
    return files.map((file) => ({
      name: file,
      isDirectory: fs.statSync(path.join(dirPath, file)).isDirectory(),
    }));
  }

  @tool({
    name: 'write_file',
    description: '写入文件内容',
    parameters: z.object({
      path: z.string(),
      content: z.string(),
    }),
  })
  async writeFile({ path: filePath, content }: { path: string; content: string }) {
    fs.writeFileSync(filePath, content, 'utf-8');
    return `File written to ${filePath}`;
  }

  @resource({
    uri: /^file:\/\/(.+)$/,
    description: '以资源形式读取文件内容',
    mimeType: 'text/plain',
  })
  async readFileResource({ uri }: { uri: string }) {
    const match = uri.match(/^file:\/\/(.+)$/);
    if (!match) throw new Error('无效的文件 URI');
    const filePath = match[1];
    return fs.readFileSync(filePath, 'utf-8');
  }
}

const server = new FastMCP({ name: 'file-operations-server', version: '1.0.0' });
server.register(new FileOperations());
await server.serve();
```

## 构建与运行

```bash
# 安装依赖
npm install

# 构建项目
npm run build

# 开发模式（watch）
npm run dev

# 运行测试
npm test

# 启动演示服务器
npm start
```

## 需求

- Node.js 18+
- TypeScript 5.0+

## 依赖

- `@modelcontextprotocol/sdk` - 核心 MCP SDK
- `zod` - 模式校验
- `reflect-metadata` - 支持装饰器元数据

HTTP 框架为可选项（仅示例/测试需要）：
- `express`、`koa`、`@koa/router`、`koa-bodyparser`
- `@hapi/hapi`
- `@adonisjs/*`（按你的应用需要）
- `@nestjs/common`、`@nestjs/core`（如使用 NestJS）

## 许可证

ISC

## 贡献

欢迎贡献！欢迎提交 Pull Request。
