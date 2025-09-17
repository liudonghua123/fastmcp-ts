import 'reflect-metadata';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { SSEServerTransportOptions } from '@modelcontextprotocol/sdk/server/sse.js';
import type { StreamableHTTPServerTransportOptions } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { 
  ListToolsRequestSchema, 
  CallToolRequestSchema, 
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { parseRawDocComment, extractDocCommentAbove } from './doc-utils.js';

// Metadata keys for storing decorator information
const TOOL_METADATA_KEY = Symbol('tool');
const PROMPT_METADATA_KEY = Symbol('prompt');
const RESOURCE_METADATA_KEY = Symbol('resource');

// Type definitions
export interface ToolOptions {
  name?: string;
  description?: string;
  parameters?: z.ZodSchema<any>;
}

export interface PromptOptions {
  name: string;
  description?: string;
  arguments?: z.ZodSchema<any>;
}

export interface ResourceOptions {
  uri: string | RegExp;
  name?: string;
  description?: string;
  mimeType?: string;
}

// Transport configuration types
export type TransportType = 'stdio' | 'sse' | 'streamableHttp';

export interface StdioTransportConfig {
  type: 'stdio';
}

export interface SSETransportConfig {
  type: 'sse';
  endpoint: string;
  response: ServerResponse;
  options?: SSEServerTransportOptions | undefined;
}

export interface StreamableHTTPTransportConfig {
  type: 'streamableHttp';
  options: StreamableHTTPServerTransportOptions;
}

export type TransportConfig = StdioTransportConfig | SSETransportConfig | StreamableHTTPTransportConfig;

interface ToolMetadata {
  name: string;
  description: string;
  parameters: z.ZodSchema<any>;
  methodName: string;
  target: any;
}

interface PromptMetadata extends PromptOptions {
  methodName: string;
  target: any;
}

interface ResourceMetadata extends ResourceOptions {
  methodName: string;
  target: any;
}

// Storage for metadata
const toolsMetadata = new Map<any, ToolMetadata[]>();
const promptsMetadata = new Map<any, PromptMetadata[]>();
const resourcesMetadata = new Map<any, ResourceMetadata[]>();

// Cache file lines to avoid repeated disk reads for multiple decorators
const fileLinesCache = new Map<string, string[]>();

const pinoOptions: pino.LoggerOptions = {
  level: process.env['FASTMCP_LOG_LEVEL'] || process.env['LOG_LEVEL'] || 'info',
};
if (process.env['PINO_PRETTY']) {
  (pinoOptions as any).transport = { target: 'pino-pretty', options: { colorize: true } };
}
console.info(pinoOptions)
const logger = pino(pinoOptions);

function normalizePath(p: string): string {
  // convert file:///D:/... to D:\... on Windows
  if (p.startsWith('file:///')) {
    const url = new URL(p);
    return path.normalize(url.pathname.replace(/^\//, ''));
  }
  return path.normalize(p);
}

function remapJsToTs(filePath: string): string {
  // Heuristic: dist/*.js -> src/*.ts
  if (filePath.endsWith('.js')) {
    const tsPath = filePath
      .replace(/(^|[\\/])dist([\\/])/, '$1src$2')
      .replace(/\.js$/, '.ts');
    if (fs.existsSync(tsPath)) return tsPath;
  }
  return filePath;
}

function getFileLines(filePath: string): string[] | undefined {
  const key = path.normalize(filePath);
  if (fileLinesCache.has(key)) return fileLinesCache.get(key);
  try {
    const text = fs.readFileSync(key, 'utf8');
    const lines = text.split(/\r?\n/);
    fileLinesCache.set(key, lines);
    logger.debug({ filePath: key, lineCount: lines.length }, 'Loaded file lines');
    return lines;
  } catch {
    logger.debug({ filePath: key }, 'Failed to read file for lines');
    return undefined;
  }
}

function getCallsiteFileFromStack(): string | undefined {
  const old = Error.prepareStackTrace;
  try {
    Error.prepareStackTrace = (_err: any, stack: any[]) => stack;
    const err = new Error();
    const stack = (err as any).stack as any[];
    if (Array.isArray(stack)) {
      logger.debug({ frames: stack.length }, 'Captured stack frames');
      for (const frame of stack) {
        const fileName: string | undefined = frame && typeof frame.getFileName === 'function' ? frame.getFileName() : undefined;
        if (!fileName) continue;
        const norm = normalizePath(fileName);
        if (
          !norm.includes(`${path.sep}node_modules${path.sep}`) &&
          !norm.endsWith(`${path.sep}src${path.sep}index.ts`) &&
          !norm.endsWith(`${path.sep}dist${path.sep}index.js`)
        ) {
          const mapped = remapJsToTs(norm);
          logger.debug({ fileName, norm, mapped }, 'Selected callsite file');
          return mapped;
        }
      }
    }
  } catch {
    // ignore
  } finally {
    Error.prepareStackTrace = old as any;
  }
  return undefined;
}

// Helper function to get or create metadata array
function getOrCreateMetadata<T>(map: Map<any, T[]>, target: any): T[] {
  if (!map.has(target)) {
    map.set(target, []);
  }
  return map.get(target)!;
}

/**
 * Tool decorator for marking methods as MCP tools
 */
export function tool(options: ToolOptions = {}) {
  return function (target: any, propertyKey: string, _descriptor: PropertyDescriptor) {
    logger.debug({ class: target?.constructor?.name, method: propertyKey, options }, 'tool decorator invoked');
    const metadata: ToolMetadata = {
      name: options.name || propertyKey,
      description: options.description || '',
      parameters: options.parameters || z.any(),
      methodName: propertyKey,
      target: target.constructor
    };

    // Parse doc comments if either description or parameters may be inferred
    const needDocForDescription = options.description === undefined;
    const needDocForParams = options.parameters === undefined;
    if (needDocForDescription || needDocForParams) {
      try {
        const frameFile = getCallsiteFileFromStack();
  logger.debug({ env: process.env['NODE_ENV'], argv: process.argv, execPath: process.execPath }, 'Environment snapshot');
        if (frameFile) {
          const lines = getFileLines(frameFile);
          if (lines) {
            // Find the method definition line first
            let methodLineIndex = -1;
            const methodRe = new RegExp(`(^|\\b)(async\\s+)?${propertyKey}\\s*\\(`);
            for (let i = 0; i < lines.length; i++) {
              const l = lines[i] || '';
              if (methodRe.test(l)) { methodLineIndex = i; break; }
            }
            // Walk upward to the nearest @tool( before the method
            let decoratorIndex = -1;
            if (methodLineIndex >= 0) {
              for (let i = methodLineIndex - 1; i >= 0; i--) {
                const l = lines[i] || '';
                if (l.includes('@tool(')) { decoratorIndex = i; break; }
                if (/^(\s*(public|private|protected)\s+)?(async\s+)?\w+\s*\(/.test(l)) break;
              }
            }
            logger.debug({ frameFile, methodLineIndex, decoratorIndex }, 'Decorator scan result');
            if (decoratorIndex >= 0) {
              const docRaw = extractDocCommentAbove(lines, decoratorIndex + 1);
              logger.debug({ hasDoc: !!docRaw }, 'Doc comment presence');
              if (docRaw) {
                const parsed = parseRawDocComment(docRaw);
                logger.debug({ parsed }, 'Parsed doc comment');
                if (needDocForDescription && parsed.description) metadata.description = parsed.description;
                // Infer parameters if not provided
                if (needDocForParams && parsed.params) {
                  const shape: Record<string, z.ZodTypeAny> = {};
                  for (const [param, desc] of Object.entries(parsed.params)) {
                    if (/number/i.test(desc)) shape[param] = z.number();
                    else if (/boolean|true|false/i.test(desc)) shape[param] = z.boolean();
                    else if (/array|list|items/i.test(desc)) shape[param] = z.array(z.any());
                    else shape[param] = z.string();
                  }
                  if (Object.keys(shape).length) {
                    metadata.parameters = z.object(shape);
                  }
                }
              }
            }
          }
        }
      } catch {
        // best effort; ignore failures
      }
    }
    
  const tools = getOrCreateMetadata(toolsMetadata, target.constructor);
    tools.push(metadata);
  logger.debug({ metadata }, 'Registered tool metadata');
    
    // Store metadata using reflect-metadata as well for additional access
    Reflect.defineMetadata(TOOL_METADATA_KEY, metadata, target, propertyKey);
  };
}

/**
 * Prompt decorator for marking methods as MCP prompts
 */
export function prompt(options: PromptOptions) {
  return function (target: any, propertyKey: string, _descriptor: PropertyDescriptor) {
    const metadata: PromptMetadata = {
      ...options,
      methodName: propertyKey,
      target: target.constructor
    };
    
    const prompts = getOrCreateMetadata(promptsMetadata, target.constructor);
    prompts.push(metadata);
    
    Reflect.defineMetadata(PROMPT_METADATA_KEY, metadata, target, propertyKey);
  };
}

/**
 * Resource decorator for marking methods as MCP resources
 */
export function resource(options: ResourceOptions) {
  return function (target: any, propertyKey: string, _descriptor: PropertyDescriptor) {
    const metadata: ResourceMetadata = {
      ...options,
      methodName: propertyKey,
      target: target.constructor
    };
    
    const resources = getOrCreateMetadata(resourcesMetadata, target.constructor);
    resources.push(metadata);
    
    Reflect.defineMetadata(RESOURCE_METADATA_KEY, metadata, target, propertyKey);
  };
}

/**
 * FastMCP Server class that provides decorator-based MCP server functionality
 */
export class FastMCP {
  private server: Server;
  private transport: any;
  private instances: Map<any, any> = new Map();

  constructor(options: { name: string; version: string }) {
    this.server = new Server(
      {
        name: options.name,
        version: options.version,
      },
      {
        capabilities: {
          tools: {},
          prompts: {},
          resources: {},
        },
      }
    );

    this.setupHandlers();
  }

  /**
   * Register a class instance containing decorated methods
   */
  register(instance: any) {
    const constructor = instance.constructor;
    this.instances.set(constructor, instance);
    
    // Register tools from this instance
    const tools = toolsMetadata.get(constructor) || [];
    for (const toolMeta of tools) {
      this.registerTool(toolMeta, instance);
    }
    
    // Register prompts from this instance
    const prompts = promptsMetadata.get(constructor) || [];
    for (const promptMeta of prompts) {
      this.registerPrompt(promptMeta, instance);
    }
    
    // Register resources from this instance
    const resources = resourcesMetadata.get(constructor) || [];
    for (const resourceMeta of resources) {
      this.registerResource(resourceMeta, instance);
    }
  }

  private registerTool(toolMeta: ToolMetadata, instance: any) {
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === toolMeta.name) {
        try {
          let rawArgs = request.params.arguments || {};
          // Fallback: if arguments missing but other params exist (excluding reserved keys), use them
          if (!rawArgs || (typeof rawArgs === 'object' && Object.keys(rawArgs).length === 0)) {
            const { name, ...rest } = (request.params as any) || {};
            if (rest && Object.keys(rest).length) rawArgs = rest;
          }
          let parsedArgs: any;
          if (toolMeta.parameters instanceof z.ZodObject && Object.keys(toolMeta.parameters.shape).length === 0) {
            // Empty object schema - pass through raw args
            parsedArgs = rawArgs;
          } else if (toolMeta.parameters instanceof z.ZodAny) {
            parsedArgs = rawArgs;
          } else {
            parsedArgs = toolMeta.parameters.parse(rawArgs);
          }
          logger.debug({ name: toolMeta.name, rawArgs, parsedArgs }, 'Tool call args');
          
          // Call the decorated method
          const result = await instance[toolMeta.methodName](parsedArgs);
          logger.debug({ name: toolMeta.name, resultType: typeof result }, 'Tool call result');
          
          return {
            content: [
              {
                type: "text",
                text: (() => {
                  if (typeof result === 'string') return result;
                  if (typeof result === 'number') return Number.isNaN(result) ? 'NaN' : result.toString();
                  if (result === null) return 'null';
                  if (typeof result === 'undefined') return 'undefined';
                  try { return JSON.stringify(result); } catch { return String(result); }
                })(),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }
      throw new Error(`Tool ${request.params.name} not found`);
    });
  }

  private registerPrompt(promptMeta: PromptMetadata, instance: any) {
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      if (request.params.name === promptMeta.name) {
        try {
          let parsedArgs = {};
          if (promptMeta.arguments && request.params.arguments) {
            parsedArgs = promptMeta.arguments.parse(request.params.arguments);
          }
          
          const result = await instance[promptMeta.methodName](parsedArgs);
          
          return {
            description: promptMeta.description || '',
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: typeof result === 'string' ? result : JSON.stringify(result),
                },
              },
            ],
          };
        } catch (error) {
          throw new Error(`Error in prompt ${promptMeta.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      throw new Error(`Prompt ${request.params.name} not found`);
    });
  }

  private registerResource(resourceMeta: ResourceMetadata, instance: any) {
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      let matches = false;
      
      if (typeof resourceMeta.uri === 'string') {
        matches = uri === resourceMeta.uri;
      } else {
        matches = resourceMeta.uri.test(uri);
      }
      
      if (matches) {
        try {
          const result = await instance[resourceMeta.methodName]({ uri });
          
          return {
            contents: [
              {
                uri,
                mimeType: resourceMeta.mimeType || "text/plain",
                text: typeof result === 'string' ? result : JSON.stringify(result),
              },
            ],
          };
        } catch (error) {
          throw new Error(`Error reading resource ${uri}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      throw new Error(`Resource ${uri} not found`);
    });
  }

  private setupHandlers() {
    // List tools handler
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: any[] = [];
      
      for (const [, toolsArray] of toolsMetadata) {
        for (const tool of toolsArray) {
          tools.push({
            name: tool.name,
            description: tool.description,
            inputSchema: zodToJsonSchema(tool.parameters),
          });
        }
      }
      
      return { tools };
    });

    // List prompts handler
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      const prompts: any[] = [];
      
      for (const [, promptsArray] of promptsMetadata) {
        for (const prompt of promptsArray) {
          prompts.push({
            name: prompt.name,
            description: prompt.description || '',
            arguments: prompt.arguments ? zodToJsonSchema(prompt.arguments) : undefined,
          });
        }
      }
      
      return { prompts };
    });

    // List resources handler
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources: any[] = [];
      
      for (const [, resourcesArray] of resourcesMetadata) {
        for (const resource of resourcesArray) {
          resources.push({
            uri: typeof resource.uri === 'string' ? resource.uri : resource.uri.source,
            name: resource.name,
            description: resource.description,
            mimeType: resource.mimeType,
          });
        }
      }
      
      return { resources };
    });
  }

  /**
   * Start the server with specified transport
   * @param transportConfig Transport configuration or defaults to stdio
   */
  async serve(transportConfig?: TransportConfig) {
    const config = transportConfig || { type: 'stdio' };
    this.transport = this.createTransport(config);
    await this.server.connect(this.transport);
  }

  /**
   * Close the server and transport
   */
  async close() {
    if (this.transport && typeof this.transport.close === 'function') {
      await this.transport.close();
    }
  }

  /**
   * Create transport based on configuration
   */
  public createTransport(config: TransportConfig) {
    switch (config.type) {
      case 'stdio':
        return new StdioServerTransport();
      
      case 'sse':
        return new SSEServerTransport(config.endpoint, config.response, config.options);
      
      case 'streamableHttp':
        return new StreamableHTTPServerTransport(config.options);
      
      default:
        throw new Error(`Unsupported transport type: ${(config as any).type}`);
    }
  }

  /**
   * Helper method to create SSE transport configuration
   */
  static createSSEConfig(endpoint: string, response: ServerResponse, options?: SSEServerTransportOptions | undefined): SSETransportConfig {
    return {
      type: 'sse',
      endpoint,
      response,
      options,
    };
  }

  /**
   * Helper method to create StreamableHTTP transport configuration
   */
  static createStreamableHTTPConfig(options: StreamableHTTPServerTransportOptions): StreamableHTTPTransportConfig {
    return {
      type: 'streamableHttp',
      options,
    };
  }

  /**
   * Helper method to create Stdio transport configuration
   */
  static createStdioConfig(): StdioTransportConfig {
    return {
      type: 'stdio',
    };
  }

  /**
   * Get the underlying MCP server instance
   */
  getServer(): Server {
    return this.server;
  }

  /**
   * Get the underlying transport instance
   */
  getTransport(): any {
    return this.transport;
  }
}

/**
 * Helper function to convert Zod schema to JSON schema
 */
function zodToJsonSchema(schema: z.ZodSchema<any>): any {
  // Simple conversion - in a production environment you might want to use a library like zod-to-json-schema
  if (schema instanceof z.ZodAny) {
    return { type: 'object', additionalProperties: true };
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: any = {};
    const required: string[] = [];
    
    for (const [key, value] of Object.entries(shape)) {
      if (value instanceof z.ZodNumber) {
        properties[key] = { type: 'number' };
      } else if (value instanceof z.ZodString) {
        properties[key] = { type: 'string' };
      } else if (value instanceof z.ZodBoolean) {
        properties[key] = { type: 'boolean' };
      } else if (value instanceof z.ZodArray) {
        properties[key] = { type: 'array' };
      } else {
        properties[key] = { type: 'object' };
      }
      
      // Check if the field is required (not optional)
      if (!(value instanceof z.ZodOptional)) {
        required.push(key);
      }
    }
    
    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }
  
  // Fallback for other schema types
  return { type: 'object' };
}

// Re-export for convenience
export default FastMCP;
