import { createHash, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { tail, verifyChain } from './audit.js';
import { fingerprint, suspiciousPhrase } from './pins.js';
import type { GatewayDeps } from './session.js';

/**
 * The dashboard's API, under /api/admin. Its own bearer token (only the SHA-256 is configured), separate from
 * every AI client token, so an AI client can never approve tools for itself. Every approve or revoke is audited.
 */
export function adminRouter(deps: GatewayDeps): Router {
  const { config, catalog, audit, metrics, pins } = deps;
  const router = express.Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    const expected = Buffer.from(config.adminTokenSha256 ?? '', 'hex');
    const header = req.headers.authorization ?? '';
    const presented = createHash('sha256').update(header.startsWith('Bearer ') ? header.slice(7).trim() : '').digest();
    if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
      res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'admin token required' });
      return;
    }
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/overview', (_req, res) => {
    const tools = catalog.all();
    const snapshot = metrics.snapshot();
    const byDecision = (d: string) => snapshot.calls.filter((c) => c.decision === d).reduce((n, c) => n + c.count, 0);
    const chain = verifyChain(config.auditFile);
    res.json({
      upstreams: Object.entries(catalog.health()).map(([name, up]) => ({
        name, up, url: config.upstreams.find((u) => u.name === name)?.url,
        tools: tools.filter((t) => t.upstream === name).length,
      })),
      tools: {
        approved: tools.filter((t) => t.pin.status === 'approved').length,
        quarantined: tools.filter((t) => t.pin.status === 'quarantined').length,
      },
      calls: { allow: byDecision('allow'), deny: byDecision('deny'), error: byDecision('error') },
      redactions: snapshot.redactions,
      clients: config.clients.length,
      audit: chain.ok ? { ok: true, records: chain.lines } : { ok: false, line: chain.line, reason: chain.reason },
    });
  });

  router.get('/tools', (_req, res) => {
    res.json(catalog.all()
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .map((e) => {
        const pin = pins.get(e.key);
        return {
          key: e.key, upstream: e.upstream, tool: e.tool,
          status: e.pin.status, reason: e.pin.status === 'quarantined' ? e.pin.reason : undefined,
          suspicious: suspiciousPhrase(e.definition) !== null,
          description: e.definition.description ?? '',
          readOnly: (e.definition.annotations as { readOnlyHint?: boolean } | undefined)?.readOnlyHint === true,
          fingerprint: fingerprint(e.definition),
          approved: pin ? {
            fingerprint: pin.fingerprint, description: pin.definition?.description, by: pin.approvedBy, at: pin.approvedAt,
          } : undefined,
        };
      }));
  });

  router.post('/tools/:key/approve', async (req, res) => {
    const entry = catalog.get(req.params.key ?? '');
    if (!entry) {
      res.status(404).json({ error: 'no such tool' });
      return;
    }
    // The client sends the fingerprint it reviewed; if the tool changed in between, the approval is refused.
    const reviewed = (req.body as { fingerprint?: string } | undefined)?.fingerprint;
    if (reviewed !== fingerprint(entry.definition)) {
      res.status(409).json({ error: 'the tool changed since you looked at it; review it again' });
      return;
    }
    try {
      pins.approve(entry.key, entry.definition, 'admin');
    } catch (error) {
      res.status(422).json({ error: error instanceof Error ? error.message : String(error) });
      return;
    }
    audit.write({ client: 'admin', event: 'approve', tool: entry.key, decision: 'allow', reason: `approved fingerprint ${reviewed.slice(0, 12)}` });
    await catalog.refresh();
    res.json({ ok: true, status: catalog.get(entry.key)?.pin.status });
  });

  router.post('/tools/:key/revoke', async (req, res) => {
    const key = req.params.key ?? '';
    if (!pins.revoke(key)) {
      res.status(404).json({ error: 'tool is not approved' });
      return;
    }
    audit.write({ client: 'admin', event: 'revoke', tool: key, decision: 'deny', reason: 'approval withdrawn' });
    await catalog.refresh();
    res.json({ ok: true, status: catalog.get(key)?.pin.status });
  });

  router.get('/clients', (_req, res) => {
    // Policies only: token hashes and upstream secrets never leave the server.
    res.json(config.clients.map((c) => ({
      name: c.name, allowTools: c.allowTools, denyTools: c.denyTools, callsPerMinute: c.callsPerMinute,
      argumentLimits: c.argumentLimits,
      upstreamIdentity: Object.fromEntries(config.upstreams.map((u) => [u.name, c.upstreamTokenEnv?.[u.name] ?? u.tokenEnv])),
      visibleTools: catalog.all().filter((e) => e.pin.status === 'approved').length,
    })));
  });

  router.get('/calls', (_req, res) => {
    res.json(metrics.snapshot());
  });

  router.get('/audit', (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500);
    res.json(tail(config.auditFile, limit));
  });

  router.post('/audit/verify', (_req, res) => {
    res.json(verifyChain(config.auditFile));
  });

  router.post('/refresh', async (_req, res) => {
    await catalog.refresh();
    res.json({ ok: true, upstreams: catalog.health() });
  });

  return router;
}
