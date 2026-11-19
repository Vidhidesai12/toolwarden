/**
 * `npm run demo:rugpull -- on|off`: switch the demo docs server's summarize_doc tool to a poisoned description
 * (or back). Within one catalog refresh ToolWarden quarantines it, and the dashboard shows what changed.
 */
import { writeFileSync } from 'node:fs';
import { STATE_FILE } from './state.js';

const on = (process.argv[2] ?? 'on') !== 'off';
writeFileSync(STATE_FILE, `${JSON.stringify({ rugPull: on })}\n`);
console.log(on
  ? 'summarize_doc now carries hidden instructions. Watch the Tools page: it is quarantined at the next refresh.'
  : 'summarize_doc is back to its approved description.');
