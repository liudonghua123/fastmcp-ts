import { FastMCP, tool } from '#fastmcp';
import { z } from 'zod';
import express from 'express';
import type { Request, Response } from 'express';

class SimpleMcp {
  /**
   * Add two numbers together.
   * @param a First number
   * @param b Second number
   * @returns Sum of a and b
   */
  @tool
  async add({ a, b }: { a: number; b: number }) {
    return a + b;
  }
  
  /**
   * Multiply two numbers together.
   * @param a First number
   * @param b Second number
   * @returns Multiply of a and b
   */
  @tool({
    name: 'product',
    parameters: z.object({
      a: z.number(),
      b: z.number(),
    }),
  })
  async multiply({ a, b }: { a: number; b: number }) {
    return a * b;
  }
}

class OtherMap {

  /**
   * Simple other tool
   * @returns a string
   */
  @tool
  async other() {
    return "other";
  }
}

const server = new FastMCP({
  name: "simple-math-server",
  version: "1.0.0"
});

server.register(new SimpleMcp());
server.register(new OtherMap());

// Create and configure the transport for StreamableHTTP
const transportConfig = FastMCP.createStreamableHTTPConfig({
  sessionIdGenerator: undefined
});
// Serve with the transport configuration
await server.serve(transportConfig);
// Get the transport instance
const transport = server.getTransport();


// -------- Express app to handle HTTP requests --------

const app = express();
app.use(express.json());

console.log("Server configured with decorated tools");

app.post('/mcp', async (req: Request, res: Response) => {
  console.log('Received MCP request');
  try {
    // Handle the HTTP request using the transport's handleRequest method
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

// Start the server
const PORT = 3000;

app.listen(PORT, (error) => {
  if (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
  console.log(`MCP Stateless Streamable HTTP Server listening on port ${PORT}`);
});