# ToolWarden

[![CI](https://github.com/Vidhidesai12/toolwarden/actions/workflows/ci.yml/badge.svg)](https://github.com/Vidhidesai12/toolwarden/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6)
![Node 24](https://img.shields.io/badge/Node-24-339933)
![React 19](https://img.shields.io/badge/React-19-61DAFB)
![MCP 2025-11-25](https://img.shields.io/badge/MCP-2025--11--25-6E56CF)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

**A security gateway for AI tool calls, with a dashboard.** AI assistants connect to ToolWarden instead of directly to [MCP](https://modelcontextprotocol.io) servers. ToolWarden checks every tool call against a per-client policy, pins each tool's definition so a changed tool is quarantined until a person approves it, masks card numbers and keys, and writes a tamper-evident audit log. A web dashboard shows live traffic and puts the human decisions in one place.

*Personal portfolio project; not used in production. It grew out of the MCP gateway in [PayFlow](https://github.com/Vidhidesai12/payflow).*

![ToolWarden dashboard: overview](docs/screenshots/overview.png)

## Why

AI assistants now call real tools: payment systems, databases, internal APIs. Each MCP server enforces its own rules, but nobody sees all the traffic in one place, and a server can quietly change a tool's description into hidden instructions for the model after it was approved (**tool poisoning**, or a **rug pull**). ToolWarden is one checkpoint for all of it, built the way banks already protect APIs: least privilege, limits, human approval and an audit trail.

## What it checks

Every call goes through the same steps, and every outcome is audited.

| # | Check | How |
|---|---|---|
| 1 | Known tool | Tools are namespaced by server (`bank__get_balance`); unknown names are refused |
| 2 | **Pinned** | Each tool definition is hashed (SHA-256 of canonical JSON). New or changed tools are quarantined until a person approves that exact version; text used in poisoning attacks can't be approved at all |
| 3 | **Allowed** for this client | Glob allow and deny lists per client; deny wins; tools a client can't use aren't listed to it |
| 4 | Rate limit | Sliding 60-second window per client |
| 5 | Arguments | Size limit, plus numeric limits per client (the demo operator may transfer at most 500) |
| 6 | Forward | With **that client's own upstream identity**: clients never hold server tokens, so there's no token passthrough and no confused deputy |
| 7 | **Mask** and **audit** | Luhn-checked card numbers, API keys, bearer tokens and private keys are masked; the decision goes into a **hash-chained** log |

Human confirmations still work through the proxy: when a server asks "Transfer 120.00 USD?", ToolWarden relays the question to the person using that session. If their client can't show questions, ToolWarden doesn't claim it can, so the server refuses.

## The dashboard

A React app served by ToolWarden itself at `/`, behind its own admin token (separate from every AI client token, so an AI can never approve its own tools).

| Screen | What it's for |
|---|---|
| **Overview** | Servers reachable, approved and quarantined tools, calls allowed and blocked, secrets masked, audit-chain status, latest decisions |
| **Tools** | Every tool and its status. Open a quarantined tool to see the approved description next to the new one, then approve that exact version or leave it blocked |
| **Clients** | Each AI client's policy, upstream identity and allowed/blocked counts |
| **Audit log** | Every decision, filterable and searchable, with a one-click hash-chain check |

**A rug pull, caught:** the demo `docs` server switched `summarize_doc` to a description with hidden instructions. Within one refresh it was quarantined, hidden from every AI client, and shown side by side with the approved version. The Approve button is replaced by a warning because the new text is suspicious.

![A poisoned tool, quarantined, with the approved and new descriptions side by side](docs/screenshots/tools-quarantine.png)

| Clients | Audit log, chain verified |
|---|---|
| ![Clients page](docs/screenshots/clients.png) | ![Audit log with the hash chain verified](docs/screenshots/audit.png) |

All screenshots are from the running demo, not mock-ups.

## Run it

**Prerequisites:** Node.js 22+ (24 recommended) and Git, or just Docker.

### Option A: Docker (one command)

```bash
git clone https://github.com/Vidhidesai12/toolwarden.git
cd toolwarden
docker compose up -d --build
```

Open http://127.0.0.1:8090 and sign in with the demo admin token `tw-demo-admin`.

### Option B: from source

```bash
npm ci && npm --prefix web ci
npm run build                 # server + dashboard
cp .env.example .env          # demo upstream tokens
npm run demo:servers          # terminal 1: demo MCP servers "bank" (:9101) and "docs" (:9102)
npm start                     # terminal 2: ToolWarden on http://127.0.0.1:8090
npm run demo                  # terminal 3: an AI client making allowed and blocked calls
```

Then open the dashboard. To see a rug pull get caught:

```bash
npm run demo:rugpull -- on    # Docker: docker compose exec demo node dist/demo/rugpull.js on
# within 10 seconds docs__summarize_doc is quarantined; the Tools page shows what changed
npm run demo:rugpull -- off   # back to the approved version
```

**Expected output of `npm run demo`** (real run, shortened):

```text
assistant-readonly sees 5 tools: bank__get_balance, bank__list_transactions, bank__get_customer_note, docs__search_docs, docs__summarize_doc
  OK      Read a balance
  OK      Read a note that contains a card number and a key
          bank__get_customer_note -> Note for ACC-1001: customer read their card [REDACTED CARD] over the phone; test key [REDACTED KEY] ...
  BLOCKED Read-only client tries to transfer money        -> Blocked by ToolWarden: this client is not allowed to use this tool
  BLOCKED Operator asks for 900.00                       -> Blocked by ToolWarden: amount 900.00 is above this client's limit of 500
          person is asked: "Transfer 120.00 USD from ACC-1001 to ACC-2002?" -> yes
  OK      Operator asks for 120.00                       -> {"status":"TRANSFERRED", ...}
          person is asked: "Transfer 120.00 USD from ACC-1001 to ACC-2002?" -> no
  BLOCKED Same request, but the person says no            -> The person did not confirm, so nothing was transferred.
```

### Connect an AI assistant

```bash
claude mcp add --transport http toolwarden http://127.0.0.1:8090/mcp --header "Authorization: Bearer tw-demo-readonly"
```

Use `tw-demo-operator` to allow transfers (with a confirmation for each).

### Use it in front of your own MCP servers

Edit [toolwarden.config.json](toolwarden.config.json): list the `upstreams`, give each AI client a token hash and policy, then review and pin the tools:

```bash
node -e "console.log(require('crypto').createHash('sha256').update('your-client-token').digest('hex'))"
npm run pin            # prints every tool with its fingerprint; approves the non-suspicious ones into pins.json
```

| Setting | Meaning |
|---|---|
| `upstreams[]` | `name`, `url`, and `tokenEnv`: the environment variable holding ToolWarden's token for that server |
| `clients[]` | `name`, `tokenSha256`, `allowTools`, `denyTools`, `callsPerMinute`, `argumentLimits`, optional `upstreamTokenEnv` per server |
| `adminTokenSha256` | Turns on the dashboard and admin API. Leave it out to run headless |
| `catalogRefreshSeconds` | How often tools are re-read and re-checked against their pins |
| Environment overrides | `PORT`, `ALLOWED_HOSTS`, `UPSTREAM_<NAME>_URL`, `PINS_FILE`, `AUDIT_FILE`, `ADMIN_TOKEN_SHA256`, `CATALOG_REFRESH_SECONDS` |

## API

| Path | Who | What |
|---|---|---|
| `POST/GET/DELETE /mcp` | AI clients (Bearer token) | MCP over Streamable HTTP |
| `GET /health`, `GET /metrics` | anyone on an allowed host | Health; Prometheus counters `toolwarden_tool_calls_total{client,tool,decision}`, `toolwarden_redactions_total`, `toolwarden_quarantined_tools` |
| `GET /api/admin/overview`, `/tools`, `/clients`, `/calls`, `/audit` | admin token | Dashboard data (never returns token hashes or secrets) |
| `POST /api/admin/tools/{key}/approve` `{fingerprint}` | admin token | Approve the exact version reviewed; 409 if it changed since, 422 if it's suspicious |
| `POST /api/admin/tools/{key}/revoke`, `/audit/verify`, `/refresh` | admin token | Withdraw approval; verify the hash chain; re-read tools now |

`npm run verify-audit [file]` checks the audit chain from the command line and exits 1 if a record was edited or removed.

## Tests

```bash
npm run typecheck && npm test
```

25 tests. They start real MCP servers inside the test and drive ToolWarden with the official MCP TypeScript client: policy filtering, per-client upstream identity, rate and argument limits, confirmations (accept, decline, client that can't ask), masking, quarantine of poisoned and changed tools, audit tampering, session binding, same-origin rules, an upstream outage, and the whole admin API (approve only the reviewed version, refuse poisoned tools, revoke, no secrets in responses). CI also type-checks and builds the dashboard and the Docker image.

## Project layout

```
src/            gateway: http.ts (transport, auth), session.ts (per-call checks), catalog.ts + pins.ts (tool pinning),
                policy.ts, redact.ts, audit.ts (hash chain), admin.ts (dashboard API), metrics.ts
src/demo/       demo MCP servers "bank" and "docs", and the rug-pull switch
web/            dashboard: React 19 + Vite 8, plain CSS, light and dark themes
test/           integration tests with real MCP servers
scripts/        demo client and audit verifier
```

## Known limits (deliberate, for a portfolio project)

- Rate limits and sessions live in memory, so ToolWarden runs as one instance. Several instances would share them through Redis.
- Client and admin tokens are static. Production would use OAuth 2.1 for AI clients (as the MCP spec describes) and single sign-on for the dashboard.
- The hash chain detects tampering but can't prevent someone rewriting the whole file; production would also ship records to write-once storage.
- The poisoning phrase scan is a heuristic. Pinning is the control: nothing new or changed runs until a person approves it.
- The dashboard polls every 5 seconds rather than streaming.

## License

[MIT](LICENSE)
