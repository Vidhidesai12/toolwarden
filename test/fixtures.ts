import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

export type Register = (server: McpServer) => void;

/**
 * A small real MCP server over Streamable HTTP, standing in for PayFlow's Java or Python server.
 * `register` runs for every new session, so changing what it registers simulates a server that
 * changes its tools while the gateway is running.
 */
export async function startUpstream(name: string, tokens: string[], register: () => Register) {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const calls: string[] = [];
  const callTokens: string[] = [];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (!tokens.some((t) => req.headers.authorization === `Bearer ${t}`)) {
      res.status(401).end();
      return;
    }
    next();
  });
  const handle = async (req: express.Request, res: express.Response) => {
    const id = req.headers['mcp-session-id'];
    if (typeof id === 'string' && sessions.has(id)) {
      await sessions.get(id)!.handleRequest(req, res, req.body);
      return;
    }
    if (!isInitializeRequest(req.body)) {
      res.status(400).end();
      return;
    }
    const server = new McpServer({ name, version: '1.0.0' });
    register()(server);
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, transport);
      },
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };
  app.post('/mcp', (req, res, next) => {
    if (req.body?.method === 'tools/call') {
      calls.push(req.body.params?.name);
      callTokens.push(String(req.headers.authorization).slice(7));
    }
    next();
  }, handle);
  app.get('/mcp', handle);
  app.delete('/mcp', handle);
  const listener = app.listen(0, '127.0.0.1');
  await new Promise((r) => listener.once('listening', r));
  const port = (listener.address() as AddressInfo).port;
  const close = () => new Promise<void>((resolve) => {
    listener.close(() => resolve());
    listener.closeAllConnections(); // keep-alive sockets would otherwise hold close() open
  });
  return { url: `http://127.0.0.1:${port}/mcp`, calls, callTokens, close };
}
