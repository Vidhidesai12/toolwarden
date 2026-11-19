// `npm run verify-audit [file]`: check the audit log's hash chain. Exit code 1 if it was tampered with.
// For the Docker gateway:  docker compose cp mcp-gateway:/data/audit.jsonl ./audit-docker.jsonl
import { existsSync } from 'node:fs';
import { verifyChain } from '../dist/audit.js';

const file = process.argv[2] ?? process.env.AUDIT_FILE ?? 'audit.jsonl';
if (!existsSync(file)) {
  console.error(`no audit log at ${file}`);
  process.exit(2);
}
const result = verifyChain(file);
console.log(result.ok
  ? `${file}: ${result.lines} records, hash chain intact`
  : `${file}: TAMPERED at line ${result.line} (${result.reason})`);
process.exit(result.ok ? 0 : 1);
