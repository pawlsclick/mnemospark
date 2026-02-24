# ClawRouter Proxy — Role, When Used, and Process Flows

## Role of the ClawRouter Proxy

The ClawRouter proxy is a **local HTTP server** that:

1. Exposes an **OpenAI-compatible API** at `http://127.0.0.1:<port>/v1` (default port 8402).
2. Handles **x402 micropayments** (EIP-712 USDC on Base) so clients don’t deal with 402/Payment Required.
3. Does **local smart routing** (14-dimension scorer) for `blockrun/auto` and other BlockRun models.
4. Provides **dedup**, **response cache**, **session pinning**, **fallback chain**, **balance checks**, and **SSE heartbeat** for streaming.

Clients (OpenClaw, `clawrouter` CLI, or any OpenAI-compatible app) talk only to this proxy; the proxy talks to the BlockRun API and upstream providers.

---

## When the Proxy is Used

| Use case                | When it runs                                                                           | How                                                                                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. OpenClaw gateway** | When the OpenClaw gateway is started with the ClawRouter plugin enabled.               | Plugin `register()` runs; if `isGatewayMode()` is true, `startProxyInBackground(api)` is called (non-blocking). Proxy base URL is set in `api.config.models.providers.blockrun.baseUrl` so OpenClaw sends requests to the proxy. |
| **2. Standalone CLI**   | When you run the `clawrouter` command (e.g. `clawrouter` or `clawrouter --port 8402`). | `cli.ts` resolves the wallet key, then calls `startProxy({ walletKey, port, onReady, onError, ... })` and keeps the process running. No OpenClaw; the proxy is the only server.                                                  |
| **3. Programmatic**     | When another process calls `startProxy()` from the exported API.                       | Same as CLI: you get a `ProxyHandle` (port, baseUrl, close). Used by tests (e2e, fallback, compression, etc.) that start the proxy against a mock or real API.                                                                   |

The proxy is **not** started when:

- Running in **completion mode** (only the completion script runs).
- **Gateway is not running** (plugin registers provider and config but logs “proxy will start when gateway runs”).
- **ClawRouter is disabled** (`CLAWROUTER_DISABLED=true`).

---

## Process Flow by Use

### Use 1: OpenClaw Gateway

1. User runs the OpenClaw gateway; ClawRouter plugin loads.
2. Plugin registers the BlockRun provider and injects `baseUrl: http://127.0.0.1:<port>/v1` into OpenClaw config.
3. If in gateway mode, `startProxyInBackground(api)` starts the proxy (no await). When the proxy is up, `setActiveProxy(handle)` is called so the provider’s `models` getter uses `activeProxy.baseUrl`.
4. OpenClaw (and agents) send requests to `http://127.0.0.1:<port>/v1/chat/completions` etc. Those go to the proxy.
5. On gateway shutdown, the plugin’s registered service runs `stop()`, which calls `activeProxyHandle.close()` to release the port.

### Use 2: Standalone `clawrouter` CLI

1. User runs `clawrouter` (optionally with `--port`). Wallet key is resolved (env, saved file, or generated).
2. `startProxy()` is awaited; the server binds to the chosen port (or reuses an existing proxy on that port).
3. CLI prints “Proxy listening on http://127.0.0.1:<port>” and stays running. Any client (browser, curl, another app) can send requests to that URL.
4. Process exits when the user stops it (e.g. Ctrl+C); `close()` is not called unless you wire it in your own runner.

### Use 3: Per-Request Flow (Same for Both Gateway and CLI)

For each HTTP request to the proxy:

1. **Routing by path**
   - `/health` → balance-aware health JSON; return.
   - `/cache` → cache stats; return.
   - `/stats` → usage stats; return.
   - `GET /v1/models` → local list of BlockRun models; return (no upstream).
   - Other `/v1/*` → continue to step 2.

2. **Proxy `/v1/*` (e.g. `/v1/chat/completions`)**
   - Parse body; optional **dedup** (hash → cache or join in-flight).
   - **Route**: if model is `blockrun/auto` (or profile-based), run local router → get model + tier; else use requested model (with alias resolution, session pinning, free-tier handling).
   - **Balance check**: estimate cost; if empty/insufficient wallet, error or fallback to free model; optionally emit low-balance callback.
   - **Optional compression** for large bodies; **session journal** injection when configured.
   - **Streaming**: send 200 + SSE headers and start heartbeat.
   - **tryModelRequest** (and fallback chain): for each candidate model, normalize messages (e.g. Google, thinking), call BlockRun with **payFetch** (402 → sign → retry with X-PAYMENT); on provider error, try next model.
   - **Response**: stream SSE (or buffer non-streaming); record usage; cache response when applicable; end stream with `data: [DONE]`.

So: the **role** is “local OpenAI-compatible + x402 + routing + resilience”; **when** is “gateway start, CLI run, or explicit `startProxy()`”; **process** is “path dispatch → dedup → route → balance → payFetch + fallback → stream/cache.”
