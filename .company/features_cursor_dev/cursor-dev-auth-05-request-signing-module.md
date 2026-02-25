# Cursor Dev: Request signing module (X-Wallet-Signature)

**ID:** auth-05  
**Repo:** mnemospark  
**Rough size:** One Cloud Agent run

**Workspace for Cloud Agent:** Work only in **this repo** (the repo you were started in). Client features (11–14) and this module are in this repo (plugin/client/proxy). Do **not** open, clone, or require access to BlockRun/ClawRouter, OpenRouter, or any other repository; all code and references are in this repo and `.company/`.

## Scope

Add a **request signing module** (e.g. `src/mnemospark-request-sign.ts` or under `src/cloud-*.ts`): given `method`, `path`, `walletAddress`, and wallet private key, build the canonical EIP-712 payload **MnemosparkRequest** (method, path, walletAddress, nonce, timestamp) with domain name `Mnemospark`, version `1`, chainId 8453 or 84532, and fixed verifyingContract; sign with `signTypedData` (viem/accounts); return the value for **X-Wallet-Signature** header = base64-encoded JSON `{ payloadB64, signature, address }`. Reuse the same wallet resolution as x402 (viem, same key from BLOCKRUN_WALLET_KEY or ~/.openclaw/blockrun/wallet.key). **Tests:** unit tests for payload construction and that a signed header verifies correctly (e.g. small verification helper or mock). Single source of truth: [auth_no_api_key_wallet_proof_spec.md](../auth_no_api_key_wallet_proof_spec.md) §2.

## References

- [auth_no_api_key_wallet_proof_spec.md](../auth_no_api_key_wallet_proof_spec.md) §2 (header, payload, canonical request, EIP-712 domain)
- [clawrouter_wallet_gen_payment_eip712.md](../clawrouter_wallet_gen_payment_eip712.md) — EIP-712 patterns (viem/accounts)

## Cloud Agent

- **Install (idempotent):** `npm install` (or project equivalent); viem (or existing wallet dependency).
- **Start (if needed):** None.
- **Secrets:** None for module itself; wallet key used at runtime by caller (same as x402).
- **Acceptance criteria (checkboxes):**
  - [ ] New module exports a function that takes (method, path, walletAddress, walletPrivateKey) and returns the string value for header `X-Wallet-Signature` (base64 JSON with payloadB64, signature, address).
  - [ ] Canonical payload: EIP-712 MnemosparkRequest with method, path, walletAddress, nonce (e.g. 32 bytes hex), timestamp (Unix seconds); domain Mnemospark/1, chainId 8453 or 84532, fixed verifyingContract per spec.
  - [ ] Signing via signTypedData (viem/accounts); signature hex (with or without 0x) and signer address included in header value.
  - [ ] Unit tests: payload construction deterministic; signed header verifies (e.g. verification helper or mock that reconstructs and checks).
  - [ ] No backend API key in this module; wallet resolution consistent with existing x402 usage.

## Task string (optional)

Work only in this repo. Implement request signing module: given method, path, walletAddress, wallet key → build EIP-712 MnemosparkRequest (nonce, timestamp), signTypedData, return X-Wallet-Signature header value (base64 JSON: payloadB64, signature, address). Use same wallet resolution as x402. Unit tests for payload and verification. Ref: auth_no_api_key_wallet_proof_spec.md §2. Acceptance: [ ] header builder; [ ] EIP-712 domain/payload per spec; [ ] tests.
