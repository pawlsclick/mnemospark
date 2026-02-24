# MVP Comparison: Option C (Superbridge + Crust) vs AWS + Client-Held Encryption

**Purpose:** Decide which path is easier for MVP and capture alternatives.  
**References:** [option_c_superbridge_architecture.md](option_c_superbridge_architecture.md), [mvp_option_aws_client_encryption.md](mvp_option_aws_client_encryption.md)

---

## 1. Which is easier for MVP?

**AWS + client-held encryption is easier for MVP.** Summary below; details in the following sections.

| Dimension              | Option C (Superbridge + Crust)                                                       | AWS + client encryption                                                       |
| ---------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| **Infra**              | No AWS accounts; 3-hop on-chain pipeline (Superbridge, Uniswap, Crust bridge)        | 1 AWS account, S3 only; no bridges or DEX                                     |
| **New integrations**   | Superbridge (Base→Ethereum USDC), Uniswap V2 (USDC→CRU), Crust bridge + IPFS pinning | AWS SDK (already in spec), Crust not needed                                   |
| **Storage**            | IPFS + Crust (content-addressed; different semantics)                                | S3 (key-value; familiar)                                                      |
| **Payment conversion** | USDC on Base → CRU on Crust (bridge + swap + bridge); treasury/relayer and batching  | USDC on Base → your revenue; you pay AWS in USD (no token conversion)         |
| **Crypto / keys**      | No client-side encryption in these docs; Crust handles persistence                   | Envelope encryption (KEK/DEK), key provisioning, key store (file + 1Password) |
| **Operational risk**   | Bridge delays (~7 d or Easy Mode), DEX liquidity/slippage, two bridges to monitor    | S3 and IAM only; key backup/loss is user responsibility                       |
| **Build surface**      | Relayer + 3 external systems + Crust IPFS gateway/pinning                            | Gateway + S3 backend + plugin (encrypt/decrypt + key store)                   |

**Why AWS + client encryption wins for “easier MVP”:**

1. **Single provider, single chain** — One AWS account and Base (for x402). No Superbridge, Uniswap, or Crust bridge to integrate or operate.
2. **Familiar stack** — S3 + envelope encryption are well-documented patterns; key store is “file + optional 1Password.”
3. **No token conversion** — You receive USDC; you pay AWS in normal fiat. No CRU, no DEX, no bridge timing or liquidity risk.
4. **Smaller dependency set** — Option C depends on Superbridge, Uniswap pool liquidity, and Crust bridge being available and stable; AWS depends only on your account and IAM.
5. **Faster to “first upload/download”** — Implement S3 + envelope encryption + key store in the plugin; no relayer or multi-chain pipeline.

Option C is a better fit if the **product** must be “decentralized storage on IPFS/Crust” and “USDC-only, no AWS” from day one; for **shipping an MVP quickly**, AWS + client encryption is the lighter path.

---

## 2. Option C — When to choose it

- You want **no AWS** and **decentralized storage** (IPFS + Crust) in MVP.
- You’re okay running a **relayer** and **treasury** (batch USDC → bridge → swap → bridge → CRU).
- You accept **bridge latency** (standard ~7 days or Easy Mode fee) and **DEX liquidity/slippage** risk.
- You’re willing to integrate **three** external systems (Superbridge, Uniswap, Crust) and maintain playbooks for failures.

**Rough MVP effort:** Relayer service, Superbridge integration, Uniswap V2 swap integration, Crust bridge + IPFS gateway/pinning, batching and treasury logic, monitoring. Likely **more** engineering and ops than AWS option.

---

## 3. AWS + client encryption — When to choose it

- You want the **fastest path to “pay in USDC, store and retrieve data”** with one cloud provider.
- You’re okay with **centralized storage** (S3) and **client-side encryption** so you never hold keys.
- You want **“their data, their key”** (KEK in OpenClaw or 1Password) and are okay documenting backup/loss-of-key.

**Rough MVP effort:** S3 backend (bucket per wallet), key provisioning (generate KEK, return once), plugin: encrypt/decrypt + key store (file + optional 1Password), API contract for ciphertext + wrapped_DEK. **Less** moving parts than Option C.

---

## 4. Other ideas

### 4.1 Hybrid: AWS first, Crust later

- **MVP:** Ship **AWS + client encryption** (1 account, 1 bucket per wallet, envelope encryption, key store).
- **Later:** Add a **second storage backend** (Crust/IPFS) and let users or config choose “store in S3” vs “store in Crust.” Option C’s pipeline can be built when you need decentralized storage and are ready to run the relayer.

**Pros:** Fast MVP; defer Option C complexity. **Cons:** Two code paths eventually; product may still want “one story” (e.g. only Crust).

### 4.2 MVP of the MVP: S3 without encryption first

- **Phase 1:** 1 account, 1 bucket per wallet, **no** client-held encryption; use S3 server-side encryption (SSE-S3 or SSE-KMS) so data is encrypted at rest by AWS. Get “pay in USDC, upload/download” working.
- **Phase 2:** Add **client-held envelope encryption** (KEK/DEK, key store, 1Password) so “their data, their key” and you don’t manage keys.

**Pros:** Smallest first step; prove x402 + S3 flow before adding crypto. **Cons:** You don’t have “we never see the key” until Phase 2; some users may want key control from day one.

### 4.3 S3 with SSE-C (customer-provided key) only

- Use **S3 SSE-C**: client sends the same key (or a derived key) with every request; S3 encrypts/decrypts; you don’t store the key. So “their key” is sent every time (or derived on client and sent per request).
- **Downside:** Key is in flight on every request; client must store it and send it each time. Envelope encryption (one KEK returned once, DEK per object) gives better separation and avoids sending the master key repeatedly. So **envelope + client-held KEK** (current AWS option doc) is the better design for “we don’t manage the key.”

### 4.4 Option C with “we hold CRU” (Option A style)

- Keep **Option C’s storage** (IPFS + Crust) but **simplify conversion**: you **hold CRU** and refill via CEX/OTC (or a partner) instead of the full on-chain pipeline (Superbridge + Uniswap + Crust bridge). Users still pay USDC on Base only.
- **Pros:** Fewer integrations than full Option C; still decentralized storage. **Cons:** You operate a CRU treasury and a conversion process; less “fully on-chain” than Option C.

---

## 5. Recommendation

- **For “easiest MVP to ship”:** Use **AWS + client-held encryption** (1 account, 1 bucket per wallet, envelope encryption, key store with file + optional 1Password). It has fewer external dependencies and no token/bridge pipeline.
- **For “decentralized storage and USDC-only, no AWS”:** Use **Option C** (or the simplified “we hold CRU” variant) when you’re ready to run the relayer and integrate Superbridge + Uniswap + Crust.
- **For “ship something very fast, then add key control”:** Use **MVP of the MVP** (S3 first with SSE-S3/SSE-KMS, then add client-held envelope encryption in a follow-on).

This comparison can be updated when product chooses a direction or when Option C or AWS option docs change.
