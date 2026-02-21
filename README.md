# mnemospark

Smart LLM router and inference toolkit — based on [ClawRouter](https://github.com/BlockRunAI/ClawRouter). 30+ models, one wallet, x402 micropayments.

**Repository:** [github.com/pawlsclick/mnemospark](https://github.com/pawlsclick/mnemospark)

---

## What is mnemospark?

mnemospark is a fork of BlockRun’s ClawRouter, maintained as its own project. It reuses ClawRouter’s x402 payments and OpenClaw integration while evolving independently.

- **x402 micropayments** — coming soon...
- **Open source** — MIT licensed

---

## Quick start

```bash
#TBD
```

### Python examples (uv)

Python tooling and examples use [uv](https://docs.astral.sh/uv/) for dependency management. From the repo root:

```bash
# Install uv (macOS/Linux): curl -LsSf https://astral.sh/uv/install.sh | sh
uv sync --extra bcm-pricing    # create .venv and install optional deps (e.g. boto3)
source .venv/bin/activate      # or on Windows: .venv\Scripts\activate
python examples/s3_storage_cost_estimate.py --gb 100
```

---

## Configuration

TBD

---

## Documentation

- [Architecture] (TBD)
- [Configuration] (TBD)
- [Features] (TBD)
- [Troubleshooting] (TBD)

---

## License

MIT
