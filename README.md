# Echo Orbit

Turn your app into an MCP server.

`echo-orbit` scans an existing app or API repo, detects agent-callable actions, and writes the MCP adapter package agents need before they can safely call it.

It is built for Base MCP style apps, x402 endpoints, wallet/payment-aware APIs, and private repos where the source should stay local.

## Quick Start

```bash
npx @builtbyecho/echo-orbit --dir .
```

Write the generated package somewhere else:

```bash
npx @builtbyecho/echo-orbit --dir . --out orbit-package
```

Validate the generated package:

```bash
npx @builtbyecho/echo-orbit doctor --dir orbit-package
npx @builtbyecho/echo-orbit test --dir orbit-package
```

Run the generated MCP adapter:

```bash
cd orbit-package
ORBIT_TARGET_BASE_URL=https://your-app.example node mcp-server.js
```

For authenticated apps:

```bash
ORBIT_TARGET_BASE_URL=https://your-app.example ORBIT_API_KEY=... node mcp-server.js
```

## What Orbit Generates

Orbit writes seven files:

- `mcp-server.js` - runnable MCP stdio adapter. Agents connect to this server.
- `orbit.mcp.json` - manifest describing how to launch the MCP adapter and what tools it exposes.
- `AGENT_ACTIONS.md` - human-readable action inventory with route, source file, risk, auth, payment, signing, and confirmation notes.
- `SKILL.md` - compact agent skill file explaining how agents should use the app safely.
- `openapi.json` - draft OpenAPI 3.1 contract for detected app actions.
- `bazaar-resource.json` - discovery/listing package with actions, schemas, safe-start tools, paid tools, and confirmation-required tools.
- `mcp-readiness.json` - machine-readable scorecard with readiness checks, actions, and risks.

## What It Detects

Orbit statically scans common app shapes:

- Express-style `app.get(...)`, `app.post(...)`, `router.*(...)`
- Next.js App Router `app/api/**/route.ts`
- Vercel-style `api/*.js`
- Node HTTP handlers using `req.method` and pathname checks
- obvious fetch calls to local API paths

It classifies detected actions as:

- `read-only`
- `write`
- `wallet-signing`
- `destructive`
- `unknown`

It also flags payment, x402, wallet, Base, and onchain hints when they appear in the repo.

## MCP Runtime

The generated `mcp-server.js` speaks JSON-RPC over stdio and supports:

- `initialize`
- `tools/list`
- `tools/call`

Each detected app action becomes one MCP tool.

Tool metadata includes:

- risk level
- auth expectation
- payment hint
- wallet-signing hint
- human-confirmation requirement
- read-only/destructive annotations

Risky tools are blocked unless the call includes `confirm: true` after explicit human approval.

## Runtime Environment

The generated MCP adapter uses these environment variables:

- `ORBIT_TARGET_BASE_URL` - required. The running app/API base URL.
- `ORBIT_API_KEY` - optional bearer token forwarded to the target app.
- `ORBIT_ALLOW_UNCONFIRMED` - optional. Set to `1` only when a human has approved dangerous tools.
- `ORBIT_TIMEOUT_MS` - optional. Per-call timeout, default `30000`.
- `ORBIT_MAX_RESPONSE_BYTES` - optional. Max response body size, default `1000000`.

## AI Modes

Orbit works without AI by default.

```bash
npx @builtbyecho/echo-orbit --dir . --ai off
```

Optional local AI polish:

```bash
npx @builtbyecho/echo-orbit --dir . --ai local
```

`--ai local` uses an Ollama-compatible endpoint:

- endpoint: `ORBIT_LOCAL_AI_ENDPOINT` or `http://127.0.0.1:11434/api/chat`
- model: `ORBIT_AI_MODEL` or `llama3.1`

Optional bring-your-own-key AI polish:

```bash
ORBIT_AI_API_KEY=... npx @builtbyecho/echo-orbit --dir . --ai byo
```

`--ai byo` uses an OpenAI-compatible chat endpoint:

- endpoint: `ORBIT_AI_ENDPOINT` or `https://api.openai.com/v1/chat/completions`
- key: `ORBIT_AI_API_KEY` or `OPENAI_API_KEY`
- model: `ORBIT_AI_MODEL` or `gpt-4.1-mini`

AI polish can improve tool names, descriptions, risk calls, confirmation rules, and generated package text. It does not need to upload the full repo; Orbit sends only the compact action package.

## Private Repos

Private repos stay private.

Orbit runs where the repo already is:

- local machine
- private CI
- internal dev environment

Use deterministic mode for no model calls:

```bash
npx @builtbyecho/echo-orbit --dir . --ai off
```

Use local or BYO AI only when you explicitly choose it.

## Commands

Generate package:

```bash
echo-orbit scan --dir . --out orbit-package
```

`scan` is optional, so this is equivalent:

```bash
echo-orbit --dir . --out orbit-package
```

Check generated files:

```bash
echo-orbit doctor --dir orbit-package
```

Smoke-test generated MCP server:

```bash
echo-orbit test --dir orbit-package
```

Dry run:

```bash
echo-orbit --dir . --dry-run
```

Version:

```bash
echo-orbit --version
```

## What To Review Before Shipping

Orbit is a launch accelerator, not a security audit.

Before publishing a generated MCP adapter, review:

- whether every detected action is real and useful
- whether write/destructive/wallet actions need stricter confirmation
- whether generated input/output schemas should be tightened
- whether `ORBIT_TARGET_BASE_URL` points at the right environment
- whether auth and payment behavior matches the app
- whether public discovery files reveal anything you do not want listed

## Local Development

```bash
npm install
npm test
node bin/echo-orbit.js --dir ../echo-gate --out out/echo-gate
node bin/echo-orbit.js doctor --dir out/echo-gate
node bin/echo-orbit.js test --dir out/echo-gate
```

## Goal

Most apps already have useful actions, but agents cannot safely discover or call them.

Orbit gives the app an agent layer:

- MCP adapter
- tool schemas
- safety labels
- payment/x402 hints
- human-confirmation rules
- discovery package

From repo to Base-ready MCP package in one command.
