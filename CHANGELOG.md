# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0](https://github.com/pawlsclick/mnemospark/compare/v1.0.1...v1.1.0) (2026-03-29)


### Features

* **cli:** fence next-step mnemospark commands in success text ([#97](https://github.com/pawlsclick/mnemospark/issues/97)) ([89edd72](https://github.com/pawlsclick/mnemospark/commit/89edd72994f1daa606fdb16245596ba494c4ec34))

## [1.0.1](https://github.com/pawlsclick/mnemospark/compare/v1.0.0...v1.0.1) (2026-03-29)


### Bug Fixes

* **ci:** surface docs and test in Release Please notes ([#94](https://github.com/pawlsclick/mnemospark/issues/94)) ([563eefa](https://github.com/pawlsclick/mnemospark/commit/563eefa7386425bc734cdac7f7a9be1391f14fd8))


### Documentation

* and test: commits do not bump semver by default. ([38ff847](https://github.com/pawlsclick/mnemospark/commit/38ff8473a940f03c881cf6875c273d66b6f877a1))
* **cli:** prefer key:value in cloud help and success copy ([#92](https://github.com/pawlsclick/mnemospark/issues/92)) ([5679916](https://github.com/pawlsclick/mnemospark/commit/567991660b690e1b0d208d23a6e4c7fea8bcdd94))


### Tests

* **cli:** add parser edge cases and parseCloudArgs integration tests ([#91](https://github.com/pawlsclick/mnemospark/issues/91)) ([ddac640](https://github.com/pawlsclick/mnemospark/commit/ddac6402828929cd26b7162c2ffc0b84cc33ff42))

## [1.0.0](https://github.com/pawlsclick/mnemospark/compare/v0.9.2...v1.0.0) (2026-03-28)


### ⚠ BREAKING CHANGES

* **openclaw:** /mnemospark_cloud and /mnemospark_wallet are removed. Use /mnemospark cloud … and /mnemospark wallet … instead.

### Features

* **openclaw:** unified /mnemospark slash command and schema-driven args ([#89](https://github.com/pawlsclick/mnemospark/issues/89)) ([107f8b4](https://github.com/pawlsclick/mnemospark/commit/107f8b4c9148ccd32b12c9e2520ec6130a05ea90))

## [0.9.2](https://github.com/pawlsclick/mnemospark/compare/v0.9.1...v0.9.2) (2026-03-27)


### Bug Fixes

* **mnemospark_cloud:** support upload archives over 2 GiB ([#87](https://github.com/pawlsclick/mnemospark/issues/87)) ([718ae6e](https://github.com/pawlsclick/mnemospark/commit/718ae6ebc72f0d6628daec437e0b0707ea4e2637))

## [0.9.1](https://github.com/pawlsclick/mnemospark/compare/v0.9.0...v0.9.1) (2026-03-27)


### Bug Fixes

* **mnemospark_cloud:** upload archives over 2 GiB ([#85](https://github.com/pawlsclick/mnemospark/issues/85)) ([ac4177d](https://github.com/pawlsclick/mnemospark/commit/ac4177d974132662a95201c4a4070ec9b6f4195d))

## [0.9.0](https://github.com/pawlsclick/mnemospark/compare/v0.8.3...v0.9.0) (2026-03-26)


### Features

* **mnemospark_cloud:** surface async command output in op-status ([#83](https://github.com/pawlsclick/mnemospark/issues/83)) ([ff63266](https://github.com/pawlsclick/mnemospark/commit/ff6326668c2c818d384523681717747d07baae53))

## [0.8.3](https://github.com/pawlsclick/mnemospark/compare/v0.8.2...v0.8.3) (2026-03-24)


### Bug Fixes

* **cloud:** shorten OpenClaw renewal cron agent message prefix ([#81](https://github.com/pawlsclick/mnemospark/issues/81)) ([eeb2ace](https://github.com/pawlsclick/mnemospark/commit/eeb2ace6c6c6d534e984942b639813fa1fa2f53d))

## [0.8.2](https://github.com/pawlsclick/mnemospark/compare/v0.8.1...v0.8.2) (2026-03-24)


### Bug Fixes

* **cloud:** correct OpenClaw cron agent message for monthly renewal ([#79](https://github.com/pawlsclick/mnemospark/issues/79)) ([1ffa228](https://github.com/pawlsclick/mnemospark/commit/1ffa2281cfdb02a7e2ef92ae60517bf668f20e0d))

## [0.8.1](https://github.com/pawlsclick/mnemospark/compare/v0.8.0...v0.8.1) (2026-03-24)


### Bug Fixes

* **cloud:** align storage renewal cron jobs with OpenClaw model ([#77](https://github.com/pawlsclick/mnemospark/issues/77)) ([b2c590d](https://github.com/pawlsclick/mnemospark/commit/b2c590db092d0101ee28b30c71ad9ac3886287b5))

## [0.8.0](https://github.com/pawlsclick/mnemospark/compare/v0.7.0...v0.8.0) (2026-03-23)


### Features

* **cloud:** friendly-name backup paths and env docs ([#75](https://github.com/pawlsclick/mnemospark/issues/75)) ([599b300](https://github.com/pawlsclick/mnemospark/commit/599b300acc226f48331352e519980d0cbca45448))
* **cloud:** improve storage copy and backup wallet handling ([#73](https://github.com/pawlsclick/mnemospark/issues/73)) ([55ce638](https://github.com/pawlsclick/mnemospark/commit/55ce6386e60a646eddaca2effa4e0c5f880ad298))
* **cloud:** renewal payment-settle and monthly cron without quote_id ([#76](https://github.com/pawlsclick/mnemospark/issues/76)) ([3936599](https://github.com/pawlsclick/mnemospark/commit/3936599fd462e9be90e038bc887e807d2e9560ff))

## [Unreleased]

### Changed

- **Breaking:** `/mnemospark_cloud backup` requires `--name <friendly-name>`. The backup artifact under `~/.openclaw/mnemospark/backup/` is named from a sanitized form of that string (not `object_id`). Upload locates the file using the friendly name in SQLite first, then falls back to the legacy path keyed by `object_id` if present.
- **Breaking:** After a successful upload, the local backup archive is removed by default. Set `MNEMOSPARK_REMOVE_BACKUP_FILE` to `0`, `false`, `no`, or `n` to keep the file; unset or truthy values remove the archive (previously an opt-in env was required to delete).
- Download writes under `~/.openclaw/mnemospark/downloads/` using the sanitized friendly basename when SQLite has a friendly name for the object; `object_key` remains the storage/API identifier and is not sent as a renamed download to the backend.

## [0.7.0](https://github.com/pawlsclick/mnemospark/compare/v0.6.0...v0.7.0) (2026-03-22)


### Features

* unify local state on SQLite and events.jsonl ([#71](https://github.com/pawlsclick/mnemospark/issues/71)) ([edcb712](https://github.com/pawlsclick/mnemospark/commit/edcb7128a0fc3948d3dacb96cb2c5b186ca07ea6))

## [0.6.0](https://github.com/pawlsclick/mnemospark/compare/v0.5.0...v0.6.0) (2026-03-22)


### Features

* **ls:** simplify table columns and refresh ls header prose ([#69](https://github.com/pawlsclick/mnemospark/issues/69)) ([3e244e7](https://github.com/pawlsclick/mnemospark/commit/3e244e7309e3b3b19b99186a1f80c460b8aabf5a))

## [0.5.0](https://github.com/pawlsclick/mnemospark/compare/v0.4.0...v0.5.0) (2026-03-22)


### Features

* **cloud:** wallet-only ls with S3 list and ls -l-style output ([#67](https://github.com/pawlsclick/mnemospark/issues/67)) ([19821e0](https://github.com/pawlsclick/mnemospark/commit/19821e066b59a8faf8d01d8f2636b69e8ffe0b2e))

## [0.4.0](https://github.com/pawlsclick/mnemospark/compare/v0.3.0...v0.4.0) (2026-03-22)


### Features

* **cloud:** add payment-settle command and slash-command cron line ([#66](https://github.com/pawlsclick/mnemospark/issues/66)) ([8db715e](https://github.com/pawlsclick/mnemospark/commit/8db715eb52bd22656a038fdc974ae8e2a7de5a38))


### Bug Fixes

* **ci:** trigger Publish only on release published, not tag push ([#64](https://github.com/pawlsclick/mnemospark/issues/64)) ([3721019](https://github.com/pawlsclick/mnemospark/commit/37210192e7365587820113f9adf8ae0b417807e4))

## [0.3.0](https://github.com/pawlsclick/mnemospark/compare/v0.2.3...v0.3.0) (2026-03-22)


### Features

* **ci:** enforce Conventional Commits (commitlint + PR title check) ([#63](https://github.com/pawlsclick/mnemospark/issues/63)) ([07a9217](https://github.com/pawlsclick/mnemospark/commit/07a9217eb22de975eb0e3c1e161eef364ffce0ac))


### Bug Fixes

* **ci:** allow Release Please PAT so Publish runs on new releases ([#61](https://github.com/pawlsclick/mnemospark/issues/61)) ([57148d0](https://github.com/pawlsclick/mnemospark/commit/57148d0cc895f9e3376380db201797efd0461b22))

## [0.2.3](https://github.com/pawlsclick/mnemospark/compare/v0.2.2...v0.2.3) (2026-03-22)


### Bug Fixes

* **ci:** anchor release-please; Cursor rule for branch policy ([#58](https://github.com/pawlsclick/mnemospark/issues/58)) ([f016367](https://github.com/pawlsclick/mnemospark/commit/f01636742ff5d189e07f4b4ba34e8491741e7a56))

## [0.2.2](https://github.com/pawlsclick/mnemospark/compare/v0.2.1...v0.2.2) (2026-03-19)

### Bug Fixes

- **wallet:** normalize wallet addresses to lowercase for consistent lookup ([#54](https://github.com/pawlsclick/mnemospark/issues/54)) (869e396)
- **cli:** accept underscore-style flags (--wallet_address) by canonicalizing to hyphen form
- **sqlite:** normalize legacy wallet values on startup for consistent lookup
- **manifest:** make wallet fallback comparison case-insensitive

## [0.2.1](https://github.com/pawlsclick/mnemospark/compare/v0.2.0...v0.2.1) (2026-03-19)

### Bug Fixes

- **publish:** install dev deps explicitly and use local tooling for lint/format ([#48](https://github.com/pawlsclick/mnemospark/issues/48)) ([7e464d3](https://github.com/pawlsclick/mnemospark/commit/7e464d392e45edff9d000df1e0b2a9d1192b829a))
- **sqlite:** load node:sqlite via runtime require to prevent bundle rewrite ([#50](https://github.com/pawlsclick/mnemospark/issues/50)) ([d71ba50](https://github.com/pawlsclick/mnemospark/commit/d71ba507de204ae21e24290710d2001d7355b882))

## [0.2.0](https://github.com/pawlsclick/mnemospark/compare/v0.1.22...v0.2.0) (2026-03-19)

### Features

- add subagent orchestration interfaces for async cloud operations ([#45](https://github.com/pawlsclick/mnemospark/issues/45)) ([951c527](https://github.com/pawlsclick/mnemospark/commit/951c527afd0411065a7bb761591d070dae87f8f2))

## [0.1.22](https://github.com/pawlsclick/mnemospark/compare/v0.1.21...v0.1.22) (2026-03-17)

### Bug Fixes

- trigger 0.1.22 release ([f0e563f](https://github.com/pawlsclick/mnemospark/commit/f0e563f51737b294f00f56caa02661e0136274e9))

## [0.1.21](https://github.com/pawlsclick/mnemospark/compare/v0.1.20...v0.1.21) (2026-03-16)

### Bug Fixes

- trigger release ([1097e64](https://github.com/pawlsclick/mnemospark/commit/1097e6436c0fc3296eda233ab610bb3630991460))

## [0.1.20](https://github.com/pawlsclick/mnemospark/compare/v0.1.19...v0.1.20) (2026-03-16)

### Bug Fixes

- **proxy:** allow upload retry when payment is already settled ([#31](https://github.com/pawlsclick/mnemospark/issues/31)) ([4f7d4a1](https://github.com/pawlsclick/mnemospark/commit/4f7d4a188a942edcc18e261e9725199380059b33))

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

- **mnemospark_cloud backup**: Success message now prints `object-id:`, `object-id-hash:`, and `object-size:` on separate lines; object-id-hash is shown without spaces.
- **mnemospark_wallet**: Wallet and export headers use cloud emoji (☁️).
- **mnemospark_wallet**: Address and (on export) private key are displayed without spaces.
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
