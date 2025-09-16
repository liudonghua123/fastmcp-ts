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

// Metadata keys for storing decorator information
const TOOL_METADATA_KEY = Symbol('tool');
const PROMPT_METADATA_KEY = Symbol('prompt');
const RESOURCE_METADATA_KEY = Symbol('resource');

// Type definitions
export interface ToolOptions {
  name: string;
  description: string;
  parameters: z.ZodSchema<any>;
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

interface ToolMetadata extends ToolOptions {
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
export function tool(options: ToolOptions) {
  return function (target: any, propertyKey: string, _descriptor: PropertyDescriptor) {
    const metadata: ToolMetadata = {
      ...options,
      methodName: propertyKey,
      target: target.constructor
    };
    
    const tools = getOrCreateMetadata(toolsMetadata, target.constructor);
    tools.push(metadata);
    
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
          // Parse and validate parameters using the zod schema
          const parsedArgs = toolMeta.parameters.parse(request.params.arguments || {});
          
          // Call the decorated method
          const result = await instance[toolMeta.methodName](parsedArgs);
          
          return {
            content: [
              {
                type: "text",
                text: typeof result === 'string' ? result : JSON.stringify(result),
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
