import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { adminRouter } from './admin.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { ClientPolicy } from './config.js';
import { createSession, type GatewayDeps } from './session.js';

interface Live {
  transport: StreamableHTTPServerTransport;
  client: string;
  close: () => Promise<void>;
}

/** The HTTP side: Host/Origin checks, client tokens, and one MCP session per connected client. */
export function createApp(deps: GatewayDeps) {
  const { config } = deps;
  const sessions = new Map<string, Live>();
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // DNS-rebinding and cross-site protection, done here as the SDK now recommends.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const host = req.headers.host ?? '';
    if (config.allowedHosts.length && !config.allowedHosts.includes(host)) {
      res.status(403).json({ error: 'host not allowed' });
      return;
    }
    // A browser sends Origin even for its own page's scripts (Vite marks them crossorigin), so the gateway's
    // own origin is always allowed. Host has passed the allow-list above, so this opens nothing new; other
    // sites are still refused unless listed.
    const origin = req.headers.origin;
    const sameOrigin = origin === `http://${host}` || origin === `https://${host}`;
    if (origin && !sameOrigin && !config.allowedOrigins.includes(origin)) {
      res.status(403).json({ error: 'origin not allowed' });
      return;
    }
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'UP', upstreams: deps.catalog.health() });
  });

  app.get('/metrics', (_req, res) => {
    const quarantined = deps.catalog.all().filter((e) => e.pin.status === 'quarantined').length;
    res.type('text/plain; version=0.0.4').send(deps.metrics.render(quarantined));
  });

  const authenticate = (req: Request): ClientPolicy | undefined => {
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) return undefined;
    const presented = createHash('sha256').update(header.slice(7).trim()).digest();
    return config.clients.find((c) => {
      const expected = Buffer.from(c.tokenSha256, 'hex');
      return expected.length === presented.length && timingSafeEqual(expected, presented);
    });
  };

  const handle = async (req: Request, res: Response) => {
    const policy = authenticate(req);
    if (!policy) {
      deps.audit.write({ client: 'unknown', event: 'auth', decision: 'deny', reason: 'missing or invalid token' });
      res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'unauthorized' });
      return;
    }

    const sessionId = req.headers['mcp-session-id'];
    if (typeof sessionId === 'string') {
      const live = sessions.get(sessionId);
      if (!live) {
        res.status(404).json({ error: 'unknown session' });
        return;
      }
      // A session belongs to the client that opened it: another client's token can't use it.
      if (live.client !== policy.name) {
        deps.audit.write({ client: policy.name, event: 'auth', decision: 'deny', reason: 'session belongs to another client' });
        res.status(403).json({ error: 'session belongs to another client' });
        return;
      }
      await live.transport.handleRequest(req, res, req.body);
      return;
    }

    if (req.method !== 'POST' || !isInitializeRequest(req.body)) {
      res.status(400).json({ error: 'start a session with an initialize request' });
      return;
    }
    const { server, close } = createSession(policy, deps);
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, client: policy.name, close });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
      void close();
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };

  app.post('/mcp', handle);
  app.get('/mcp', handle);
  app.delete('/mcp', handle);

  // The dashboard: its API, then the built single-page app. Off unless an admin token is configured.
  if (config.adminTokenSha256) {
    app.use('/api/admin', adminRouter(deps));
    const webDir = process.env.WEB_DIR ?? fileURLToPath(new URL('../web/dist', import.meta.url));
    if (existsSync(join(webDir, 'index.html'))) {
      app.use((_req: Request, res: Response, next: NextFunction) => {
        res.set({
          'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
        });
        next();
      });
      app.use(express.static(webDir, { index: 'index.html' }));
    }
  }

  return { app, sessions };
}
