# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.20](https://github.com/pawlsclick/mnemospark/compare/v0.1.19...v0.1.20) (2026-03-16)


### Bug Fixes

* **proxy:** allow upload retry when payment is already settled ([#31](https://github.com/pawlsclick/mnemospark/issues/31)) ([4f7d4a1](https://github.com/pawlsclick/mnemospark/commit/4f7d4a188a942edcc18e261e9725199380059b33))

## [0.1.19] - 2026-03-15

### Features & fixes

fix: wallet proof, payment/settle, proxy settle-before-upload
feature: automatic decrypt on download

## [0.1.18] - 2026-03-12

### Fixed

fix: cloud-command-handler-guard

## [0.1.17] - 2026-03-12

### Fixed

- fix: cloud messaging and logging
- fix: new upload-confirm step for presigned storage uploads

## [0.1.16] - 2026-03-09

### Fixed

- fix: fix-06-client-handle-207-s3-retry

## [0.1.15] - 2026-03-09

### Fixed

- fix: fix-01-flatten-upload-payload

## [0.1.14] - 2026-03-05

### Fixed

- fix: timestamp converted via BigInt(payload.timestamp)

## [0.1.13] - 2026-03-05

### Fixed

- fix: EIP-712 v4 standard

## [0.1.12] - 2026-03-05

### Fixed

- fix install `openclaw plugins install mnemospark`

## [0.1.11] - 2026-03-05

### Fixed

- **OpenClaw plugin install**: Extension entry path now works when OpenClaw installs via `openclaw plugins install mnemospark` (npm layout: `node_modules/mnemospark/dist/index.js`); fallback `./dist/index.js` kept for full-package layout.

## [0.1.10] - 2026-03-05

### Changed

- **mnemospark-cloud backup**: Success message now prints `object-id:`, `object-id-hash:`, and `object-size:` on separate lines; object-id-hash is shown without spaces.
- **mnemospark-wallet**: Wallet and export headers use cloud emoji (☁️).
- **mnemospark-wallet**: Address and (on export) private key are displayed without spaces.
- EIP-712 type mismatch fixed

## [0.1.9] - 2025-03-05

### Changed

- fix: slash commands.

## [0.1.8] - 2025-03-05

### Changed

- chore version bump.

## [0.1.7] - 2025-03-05

### Changed

- redesigned plugin to OpenClaw spec (2)

## [0.1.6] - 2025-03-05

### Changed

- redesigned plugin to OpenClaw spec

## [0.1.5] - 2025-03-04

### Changed

- redesigned command syntax
- tested mnemospark client and proxy with OpenClaw and ClawRouter, all tests pass.

## [0.1.4] - 2025-03-03

### Changed

- chore version bump.

## [0.1.3] - 2025-03-03

### Changed

- chore version bump.

## [0.1.2] - 2025-03-03

### Changed

- chore version bump.

## [0.1.1] - 2025-03-02

### Changed

- Package description updated to clarify mnemospark as an OpenClaw plugin for cloud services workflows with wallet management and x402 USDC payments on Base.

## [0.1.0] - (initial release)

### Added

- Initial release: OpenClaw plugin for mnemospark storage workflow with wallet management and x402 USDC payments via `/mnemospark wallet` and `/mnemospark cloud`.
- Local proxy for backend storage endpoints.
- `mnemospark update` and `mnemospark check-update` subcommands for version check and install.
