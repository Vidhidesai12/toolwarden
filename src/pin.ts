/**
 * `npm run pin`: print every upstream tool with its fingerprint, and approve them all into pins.json.
 * Run it only after reading the list: approving is a person's decision that these definitions are safe.
 */
import { connectUpstream, SEPARATOR } from './catalog.js';
import { loadConfig } from './config.js';
import { fingerprint, PinStore, suspiciousPhrase, type ToolDefinition } from './pins.js';

const config = loadConfig(process.env.TOOLWARDEN_CONFIG ?? 'toolwarden.config.json');
const tools: Record<string, ToolDefinition> = {};
for (const upstream of config.upstreams) {
  const client = await connectUpstream(upstream);
  for (const t of (await client.listTools()).tools) {
    const def: ToolDefinition = { name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
      annotations: t.annotations };
    const key = upstream.name + SEPARATOR + t.name;
    const warning = suspiciousPhrase(def);
    console.log(`${warning ? 'SUSPICIOUS' : 'ok        '} ${key}  ${fingerprint(def).slice(0, 12)}  ${t.description ?? ''}`);
    if (!warning) tools[key] = def;
  }
  await client.close();
}
new PinStore(config.pinsFile).approveAll(tools);
console.log(`\napproved ${Object.keys(tools).length} tools into ${config.pinsFile}; suspicious tools were left out`);
