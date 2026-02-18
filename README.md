# mnemospark

Smart LLM router and inference toolkit — based on [ClawRouter](https://github.com/BlockRunAI/ClawRouter). 30+ models, one wallet, x402 micropayments.

**Repository:** [github.com/pawlsclick/mnemospark](https://github.com/pawlsclick/mnemospark)

---

## What is mnemospark?

mnemospark is a fork of BlockRun’s ClawRouter, maintained as its own project. It reuses ClawRouter’s smart routing, x402 payments, and OpenClaw integration while evolving independently.

- **Smart routing** — cost-aware model selection, multiple profiles (auto, eco, premium, free)
- **30+ models** — OpenAI, Anthropic, Google, DeepSeek, xAI, Moonshot through one wallet
- **x402 micropayments** — pay per request with USDC on Base, no API keys
- **Open source** — MIT licensed

---

## Quick start

```bash
git clone git@github.com:pawlsclick/mnemospark.git
cd mnemospark
npm install
npm run build
npm run typecheck
```

---

## Configuration

| Setting               | Default | Description           |
| --------------------- | ------- | --------------------- |
| `CLAWROUTER_DISABLED` | `false` | Disable smart routing |
| `BLOCKRUN_PROXY_PORT` | `8402`  | Proxy port            |
| `BLOCKRUN_WALLET_KEY` | auto    | Wallet private key    |

See [docs/configuration.md](docs/configuration.md) for full options.

---

## Documentation

- [Architecture](docs/architecture.md)
- [Configuration](docs/configuration.md)
- [Features](docs/features.md)
- [Troubleshooting](docs/troubleshooting.md)
- [vs OpenRouter](docs/vs-openrouter.md)

---

## License

MIT
