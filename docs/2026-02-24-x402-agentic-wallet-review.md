# Mnemospark note: Coinbase x402 + Agentic Wallet review

Date: 2026-02-24

## Sources reviewed

- https://docs.cdp.coinbase.com/x402/welcome
- https://docs.cdp.coinbase.com/x402/core-concepts/how-it-works
- https://docs.cdp.coinbase.com/x402/core-concepts/http-402
- https://docs.cdp.coinbase.com/x402/migration-guide
- https://docs.cdp.coinbase.com/x402/network-support
- https://docs.cdp.coinbase.com/x402/quickstart-for-buyers
- https://docs.cdp.coinbase.com/x402/quickstart-for-sellers
- https://docs.cdp.coinbase.com/agentic-wallet/welcome
- https://docs.cdp.coinbase.com/agentic-wallet/quickstart
- https://docs.cdp.coinbase.com/agentic-wallet/skills/overview
- https://docs.cdp.coinbase.com/agentic-wallet/skills/authenticate
- https://docs.cdp.coinbase.com/agentic-wallet/skills/fund
- https://docs.cdp.coinbase.com/agentic-wallet/skills/pay-for-service

Compared against current repo docs/code:

- `README.md`
- `docs/architecture.md`
- `docs/configuration.md`
- `docs/subscription-failover.md`
- `src/x402.ts`
- `src/proxy.ts`

---

## Direct answers to requested questions

### 1) Does this inform the current project spec?

**Yes.**

How:

- It validates Mnemospark's core direction (agent-native, wallet-based, per-request payments over HTTP 402).
- It sharpens the spec language toward **x402 v2 canonical terms**:
  - `PAYMENT-REQUIRED`
  - `PAYMENT-SIGNATURE`
  - `PAYMENT-RESPONSE`
- It reinforces that CAIP-2 network IDs (for example `eip155:8453`) should be treated as the primary network format.

Low-complexity implication:

- Update documentation language first (no architecture changes) so spec wording matches current x402 ecosystem conventions.

---

### 2) Does this inform the PRD?

**Yes, with one caveat:** there is no formal standalone PRD file in this repo today, so this applies to the effective product goals in current docs.

How:

- Clarifies product value statement: "no account/session setup required for paid API access" is a first-class benefit of x402.
- Supports explicit PRD acceptance criteria for interoperability:
  - Works with x402 v2 header names.
  - Maintains backward compatibility where practical.
- Confirms focus on "agent autonomy + pay-per-use" rather than subscription/account-centric flows.

Low-complexity implication:

- Add 2-3 PRD bullets in docs only; do not add new subsystems.

---

### 3) Does this inform the API spec?

**Yes (highest impact area).**

How:

- x402 migration docs make header compatibility explicit (v1 -> v2).
- Mnemospark currently already sends both modern and legacy payment signature headers in `src/x402.ts`, which is good.
- Mnemospark currently reads payment requirements from `x-payment-required` only; v2 canonical behavior is `PAYMENT-REQUIRED`.

Low-complexity implication:

- API spec should explicitly define:
  - Preferred v2 headers.
  - Legacy compatibility behavior.
  - CAIP-2 network identifier expectation.
- This is mostly a documentation/spec clarification now; implementation follow-up can be a small compatibility patch if needed.

---

### 4) Does this inform the workflow?

**Yes.**

How:

- Confirms the buyer workflow already used by Mnemospark:
  1. Request resource
  2. Receive 402 challenge
  3. Sign payment payload
  4. Retry request with payment header
  5. Receive paid response
- Agentic Wallet docs provide an operator-friendly onboarding path (OTP auth + guided funding + `x402 pay` command) that could simplify docs for non-crypto users.

Important constraint:

- Agentic Wallet keeps private keys isolated in Coinbase infrastructure, while Mnemospark currently signs locally from a private key (`BLOCKRUN_WALLET_KEY` / wallet file). This is **not** a drop-in runtime replacement.

Low-complexity implication:

- Treat Agentic Wallet as an **optional operator workflow reference**, not a core runtime integration target.

---

## Recommended streamlining actions (no added complexity)

1. **Docs/spec alignment only (now):**
   - Add x402 v2 canonical header names and CAIP-2 wording to architecture/config docs.
2. **Small compatibility hardening (optional, later):**
   - Accept `PAYMENT-REQUIRED` in addition to legacy `x-payment-required` when parsing 402 challenges.
3. **Workflow documentation only:**
   - Add an optional "Agentic Wallet onboarding" section for users who want OTP + onramp UX.
4. **Do not do now:**
   - Do not embed full Agentic Wallet runtime into Mnemospark; it adds integration complexity without clear end-goal acceleration.

---

## Bottom line

The Coinbase docs do inform Mnemospark in all four areas (spec, PRD framing, API spec, workflow), but the best near-term value is **documentation and compatibility clarity**, not deeper architecture changes.
