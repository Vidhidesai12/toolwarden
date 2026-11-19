import { copyFileSync, existsSync } from 'node:fs';
import { AuditLog } from './audit.js';
import { Catalog } from './catalog.js';
import { loadConfig } from './config.js';
import { createApp } from './http.js';
import { Metrics } from './metrics.js';
import { PinStore } from './pins.js';
import { RateLimiter } from './policy.js';

const config = loadConfig(process.env.TOOLWARDEN_CONFIG ?? 'toolwarden.config.json');
// In a container the pins file lives on a volume, so dashboard approvals survive restarts. On first start it is
// seeded from the reviewed pins.json shipped in the image.
const seed = process.env.PINS_SEED;
if (seed && !existsSync(config.pinsFile) && existsSync(seed)) copyFileSync(seed, config.pinsFile);
const audit = new AuditLog(config.auditFile);
const pins = new PinStore(config.pinsFile);
const catalog = new Catalog(config.upstreams, pins, audit);

await catalog.refresh();
setInterval(() => void catalog.refresh(), config.catalogRefreshSeconds * 1000).unref();

const { app } = createApp({ config, catalog, audit, pins, limiter: new RateLimiter(), metrics: new Metrics() });
app.listen(config.port, process.env.HOST ?? '127.0.0.1', () => {
  const tools = catalog.all();
  console.log(`ToolWarden on :${config.port}${config.adminTokenSha256 ? ' (dashboard at /)' : ''}; ${tools.filter((t) => t.pin.status === 'approved').length} tools approved, `
    + `${tools.filter((t) => t.pin.status === 'quarantined').length} quarantined; upstreams ${JSON.stringify(catalog.health())}`);
});
