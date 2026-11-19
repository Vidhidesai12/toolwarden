# AI usage notes

Built with Claude Code as a pair programmer. This file records what was generated, the design decisions to be able to explain, and the bugs found along the way.

## ToolWarden 1.0 (2026-11-18)

**Origin:** the gateway started as `mcp-gateway` inside [PayFlow](https://github.com/Vidhidesai12/payflow), with 17 passing tests. It was moved into its own repository, made general (any MCP servers, not just PayFlow), and given a dashboard.

**Generated with Claude Code:** the admin API, the React dashboard, the demo MCP servers and rug-pull switch, the pin store's new format, the new tests, Docker, CI and the README.

**What I reviewed / changed myself:**
- _TODO_

**Design decisions to be able to explain:**
- *Separate admin token:* the dashboard's token is not an AI client token, so an AI can never approve its own tools. Only its SHA-256 is configured.
- *Approve exactly what you saw:* the Approve button sends the fingerprint the person reviewed. If the tool changed in between, the server answers 409. This closes a time-of-check to time-of-use gap.
- *Suspicious tools can't be approved from the UI:* if a definition contains text used in poisoning attacks, the fix belongs in the server, not in an override button.
- *Pins store the approved definition:* not just a hash, so the dashboard can show the approved and the new description side by side, with who approved it and when. Old pin files (hash only) still load.
- *Same process, same origin:* ToolWarden serves the built dashboard itself, with a strict Content-Security-Policy and `frame-ancestors 'none'`. Admin calls use a bearer header, not cookies, so cross-site request forgery doesn't apply.
- *Polling, not WebSockets:* a few small requests every 5 seconds are plenty for an admin screen and need no extra moving parts.
- *Built-in demo servers:* anyone can run the whole story, including a rug pull, without a real backend.

**Bugs caught during this step:**
- *Found by the first dashboard screenshot (a blank page):* ToolWarden refused its own dashboard's JavaScript with 403. Vite marks the script `crossorigin`, so the browser sends an `Origin` header even for same-origin requests, and the Origin check only allowed listed origins. Fix: the server's own origin (the host the request came to, already checked against the Host allow-list) is always allowed; other sites are still refused. A test covers both cases.
- *Found in the live demo output:* masking a card number swallowed the space after it ("[REDACTED CARD]over the phone"), because the pattern allowed a trailing separator. The pattern now starts and ends on a digit. Fixed here and in PayFlow's gateway, with a test.
- *Found while taking screenshots:* signing in by setting the token and then changing only the URL hash didn't reload the page, so the app never read the token. Not a product bug (a person signs in through the form), but the screenshot script now reloads.
- *Environment, not code:* type-checking the demo servers is slow (the MCP SDK's tool types with Zod are heavy), and Vite builds took about 2 minutes while the whole PayFlow Docker stack was running on the same laptop.
