# FastMCP-TS

A TypeScript framework for building Model Context Protocol (MCP) servers with decorator-based syntax. This package simplifies the creation of MCP servers by providing intuitive decorators for defining tools, prompts, and resources.

## Features

- 🎯 **Decorator-based API** - Use simple decorators to define MCP tools, prompts, and resources
- 🚀 **Multiple Transport Types** - Support for stdio, SSE, and streamable HTTP transports
- 📝 **TypeScript First** - Built with TypeScript for excellent type safety and IntelliSense
- 🔧 **Zod Integration** - Built-in parameter validation using Zod schemas
- 🌐 **Express Integration** - Easy integration with Express.js for HTTP-based servers

## Installation

```bash
npm install fastmcp-ts
```

## Quick Start

### 1. Basic Tool Server

```typescript
import { FastMCP, tool } from 'fastmcp-ts';
import { z } from 'zod';

class MathTools {
  @tool({
    name: "add",
    description: "Add two numbers",
    parameters: z.object({
      a: z.number().describe("First number"),
      b: z.number().describe("Second number"),
    }),
  })
  async add({ a, b }: { a: number; b: number }) {
    return a + b;
  }

  @tool({
    name: "multiply",
    description: "Multiply two numbers", 
    parameters: z.object({
      a: z.number(),
      b: z.number(),
    }),
  })
  async multiply({ a, b }: { a: number; b: number }) {
    return a * b;
  }
}

// Create server instance
const server = new FastMCP({
  name: "math-server",
  version: "1.0.0"
});

// Register your tools class
server.register(new MathTools());

// Start with stdio transport (default)
await server.serve();
```

### 2. HTTP Server with Express

```typescript
import express from 'express';
import { FastMCP, tool } from 'fastmcp-ts';
import { z } from 'zod';

class MyTools {
  @tool({
    name: "greet",
    description: "Greet someone",
    parameters: z.object({
      name: z.string(),
    }),
  })
  async greet({ name }: { name: string }) {
    return `Hello, ${name}!`;
  }
}

const server = new FastMCP({
  name: "greeting-server", 
  version: "1.0.0"
});

server.register(new MyTools());

// Configure for HTTP transport
const transportConfig = FastMCP.createStreamableHTTPConfig({
  sessionIdGenerator: undefined
});

await server.serve(transportConfig);

// Set up Express app
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

## API Reference

### Decorators

#### `@tool(options: ToolOptions)`

Define a method as an MCP tool.

```typescript
interface ToolOptions {
  name: string;           // Tool name
  description: string;    // Tool description  
  parameters: z.ZodSchema<any>; // Zod schema for parameters
}
```

**Example:**
```typescript
@tool({
  name: "file_read",
  description: "Read contents of a file",
  parameters: z.object({
    path: z.string().describe("File path to read"),
    encoding: z.string().optional().describe("File encoding (default: utf-8)"),
  }),
})
async readFile({ path, encoding = 'utf-8' }: { path: string; encoding?: string }) {
  // Implementation here
  return fs.readFileSync(path, encoding);
}
```

#### `@prompt(options: PromptOptions)`

Define a method as an MCP prompt.

```typescript
interface PromptOptions {
  name: string;           // Prompt name
  description?: string;   // Prompt description
  arguments?: z.ZodSchema<any>; // Zod schema for arguments
}
```

**Example:**
```typescript
@prompt({
  name: "code_review",
  description: "Generate a code review prompt",
  arguments: z.object({
    language: z.string(),
    code: z.string(),
  }),
})
async codeReviewPrompt({ language, code }: { language: string; code: string }) {
  return `Please review this ${language} code:\n\n${code}`;
}
```

#### `@resource(options: ResourceOptions)`

Define a method as an MCP resource.

```typescript
interface ResourceOptions {
  uri: string | RegExp;   // Resource URI or pattern
  name?: string;          // Resource name
  description?: string;   // Resource description
  mimeType?: string;      // MIME type (default: text/plain)
}
```

**Example:**
```typescript
@resource({
  uri: /^file:\/\/(.+)$/,
  name: "file_system",
  description: "File system resource",
  mimeType: "text/plain",
})
async readResource({ uri }: { uri: string }) {
  const match = uri.match(/^file:\/\/(.+)$/);
  if (match) {
    return fs.readFileSync(match[1], 'utf-8');
  }
  throw new Error('Invalid file URI');
}
```

### FastMCP Class

#### Constructor

```typescript
new FastMCP(options: { name: string; version: string })
```

#### Methods

##### `register(instance: any)`
Register a class instance containing decorated methods.

##### `serve(transportConfig?: TransportConfig)`
Start the server with the specified transport configuration.

##### `close()`
Close the server and transport.

##### Static Transport Configuration Helpers

```typescript
FastMCP.createStdioConfig(): StdioTransportConfig
FastMCP.createSSEConfig(endpoint: string, response: ServerResponse, options?: SSEServerTransportOptions): SSETransportConfig  
FastMCP.createStreamableHTTPConfig(options: StreamableHTTPServerTransportOptions): StreamableHTTPTransportConfig
```

## Transport Types

### 1. Stdio Transport (Default)

```typescript
await server.serve(); // Uses stdio by default
// or explicitly:
await server.serve(FastMCP.createStdioConfig());
```

### 2. SSE (Server-Sent Events) Transport

```typescript
import type { ServerResponse } from 'node:http';

const config = FastMCP.createSSEConfig('/sse', response, {
  // SSE options
});
await server.serve(config);
```

### 3. Streamable HTTP Transport

```typescript
const config = FastMCP.createStreamableHTTPConfig({
  sessionIdGenerator: undefined
});
await server.serve(config);
```

## Advanced Examples

### File Operations Server

```typescript
import { FastMCP, tool, resource } from 'fastmcp-ts';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

class FileOperations {
  @tool({
    name: "list_directory",
    description: "List contents of a directory",
    parameters: z.object({
      path: z.string().describe("Directory path"),
    }),
  })
  async listDirectory({ path: dirPath }: { path: string }) {
    const files = fs.readdirSync(dirPath);
    return files.map(file => ({
      name: file,
      isDirectory: fs.statSync(path.join(dirPath, file)).isDirectory()
    }));
  }

  @tool({
    name: "write_file",
    description: "Write content to a file", 
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
    description: "Read file contents as resource",
    mimeType: "text/plain",
  })
  async readFileResource({ uri }: { uri: string }) {
    const match = uri.match(/^file:\/\/(.+)$/);
    if (!match) throw new Error('Invalid file URI');
    
    const filePath = match[1];
    return fs.readFileSync(filePath, 'utf-8');
  }
}

const server = new FastMCP({
  name: "file-operations-server",
  version: "1.0.0"
});

server.register(new FileOperations());
await server.serve();
```

## Building and Running

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run in development mode with watch
npm run dev

# Run tests
npm test

# Start the demo server
npm start
```

## Requirements

- Node.js 18+ 
- TypeScript 5.0+

## Dependencies

- `@modelcontextprotocol/sdk` - Core MCP SDK
- `zod` - Schema validation
- `reflect-metadata` - Decorator metadata support
- `express` - HTTP server framework (for HTTP transport)

## License

ISC

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.