# mnemospark

Coming soon...

## What is mnemospark?

mnemospark is a fork of BlockRun’s ClawRouter, maintained as its own project. It reuses ClawRouter’s x402 payments and OpenClaw integration while evolving independently.

Check out ClawRouter if you haven't yet [BlockRun's ClawRouter](https://github.com/BlockRunAI/ClawRouter). 30+ models, one wallet, x402 micropayments.

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
python examples/data_transfer_cost_estimate.py --direction in --gb 100   # ingress/regional
python examples/data_transfer_cost_estimate.py --direction out --gb 500  # egress to internet
```

---

## Configuration

- **Required environment:** `MNEMOSPARK_BACKEND_API_BASE_URL` (or use the default) so the proxy can reach the mnemospark backend. A **wallet** is required for storage commands (price-storage, upload, ls, download, delete); configure via BlockRun/mnemospark wallet key (see workflow docs).
- **No backend API key** — do not set or pass `MNEMOSPARK_BACKEND_API_KEY` or `x-api-key`. Backend authentication is **wallet proof**: the proxy signs each request with the user's wallet; the backend verifies the signature. The canonical API specification is in the [mnemospark-docs](https://github.com/pawlsclick/mnemospark-docs) repo.

---

## Documentation

- [Architecture] (TBD)
- [Configuration] (TBD)
- [Features] (TBD)
- [Troubleshooting] (TBD)

---

## License

MIT
