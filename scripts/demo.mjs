// `npm run demo`: drive a running ToolWarden the way an AI assistant would, and print each decision.
// Needs the demo servers and ToolWarden running (see README). Local demo tokens only.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const url = new URL(process.env.TOOLWARDEN_URL ?? 'http://127.0.0.1:8090/mcp');

async function connect(token, confirm) {
  const client = new Client({ name: 'toolwarden-demo', version: '1.0.0' },
    { capabilities: confirm ? { elicitation: { form: {} } } : {} });
  if (confirm) {
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      console.log(`          person is asked: "${request.params.message}" -> ${confirm}`);
      return confirm === 'yes' ? { action: 'accept', content: { confirm: true } } : { action: 'decline' };
    });
  }
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}

async function step(title, client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.map((c) => (c.type === 'text' ? c.text : '')).join(' ').replace(/\s+/g, ' ');
  const shown = text.length > 140 ? `${text.slice(0, 140)}…` : text;
  console.log(`${result.isError ? '  BLOCKED' : '  OK     '} ${title}\n          ${name} -> ${shown}`);
  return result;
}

const reader = await connect('tw-demo-readonly');
const tools = (await reader.listTools()).tools.map((t) => t.name);
console.log(`\nassistant-readonly sees ${tools.length} tools: ${tools.join(', ')}\n`);
await step('Read a balance', reader, 'bank__get_balance', { account: 'ACC-1001' });
await step('Read a note that contains a card number and a key', reader, 'bank__get_customer_note', { account: 'ACC-1001' });
await step('Search documents', reader, 'docs__search_docs', { query: 'approval' });
await step('Read-only client tries to transfer money', reader, 'bank__transfer', { from: 'ACC-1001', to: 'ACC-2002', amount: '50.00' });

const operator = await connect('tw-demo-operator', 'yes');
console.log('');
await step('Operator asks for 900.00 (this client may move at most 500)', operator, 'bank__transfer', { from: 'ACC-1001', to: 'ACC-2002', amount: '900.00' });
await step('Operator asks for 120.00; the bank asks the person through ToolWarden', operator, 'bank__transfer', { from: 'ACC-1001', to: 'ACC-2002', amount: '120.00' });
const decliner = await connect('tw-demo-operator', 'no');
await step('Same request, but the person says no', decliner, 'bank__transfer', { from: 'ACC-1001', to: 'ACC-2002', amount: '120.00' });

console.log('\nEvery decision above is in the audit log: open the dashboard at http://127.0.0.1:8090 (admin token tw-demo-admin).');
for (const c of [reader, operator, decliner]) await c.close();
