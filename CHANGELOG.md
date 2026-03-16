# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0](https://github.com/pawlsclick/mnemospark/compare/v0.1.20...v1.0.0) (2026-03-16)


### ⚠ BREAKING CHANGES

* ClawRouter no longer forces blockrun/auto as default model. Users must explicitly opt-in via /model blockrun/auto.

### Features

* add /cloud backup command and tests ([6f4f90c](https://github.com/pawlsclick/mnemospark/commit/6f4f90c141d6e0349f59209d00e88b60e42bb9ea))
* add /wallet command for backup and recovery ([52e5e72](https://github.com/pawlsclick/mnemospark/commit/52e5e723bbb49c0dfc5a923316c9793ef00729e5))
* add agentic mode for multi-step autonomous tasks ([c05309c](https://github.com/pawlsclick/mnemospark/commit/c05309c38b81e480711a4f9f8f8b59004e0f5730))
* add balance monitoring with low balance warnings and empty wallet errors ([0461c69](https://github.com/pawlsclick/mnemospark/commit/0461c69d500b4e93b8cafb995f6fb9de07ca8b0b))
* add CLAWROUTER_DISABLED env var to toggle plugin on/off ([d504897](https://github.com/pawlsclick/mnemospark/commit/d50489745680ac6e3d86cf2a1978ba1adc1a6bbb))
* add codex to OpenClaw model picker allowlist ([603c69a](https://github.com/pawlsclick/mnemospark/commit/603c69aed01f1f2e5f1a8504e92271063d99831b))
* add cost savings dashboard with /stats command and web UI ([bab2c67](https://github.com/pawlsclick/mnemospark/commit/bab2c67ae9c8f28303f821fd0d7fe6e92d2aa468))
* add Docker edge case test suite for OpenClaw integration ([5e4e4c8](https://github.com/pawlsclick/mnemospark/commit/5e4e4c8247be064f41c4ab6f4cb05b501af6e5a9))
* add German language support for smart routing ([0a843c6](https://github.com/pawlsclick/mnemospark/commit/0a843c69c8b6ecb0154caef3f16337d2338f1fdb))
* add gpt-120b and free aliases for nvidia model ([f464f80](https://github.com/pawlsclick/mnemospark/commit/f464f80d97f77230e2fe04fed83c8c28b7110c3d))
* add MiniMax M2.5 model support ([1d4d0f3](https://github.com/pawlsclick/mnemospark/commit/1d4d0f3c3ff891870e4aa3275a634ca3e1528915))
* add model fallback on provider errors (v0.4.0) ([44db232](https://github.com/pawlsclick/mnemospark/commit/44db2329f5038cd20a83c4582bfedca93cfd21ea))
* add model shortcut aliases for UX improvement ([1edb072](https://github.com/pawlsclick/mnemospark/commit/1edb072aa59da5c5e1600346d3167ba81a61e212))
* add new xAI/NVIDIA models with free fallback ([304a9fd](https://github.com/pawlsclick/mnemospark/commit/304a9fd7bafecbbb80de8081ea9b28721510c4bd))
* add OpenClaw plugin manifest for marketplace integration ([e2b0e6c](https://github.com/pawlsclick/mnemospark/commit/e2b0e6ce61675c2dcc7459496ee3c47f2353f1ac))
* add proxy reuse and configurable port ([fa5dfde](https://github.com/pawlsclick/mnemospark/commit/fa5dfdec3188dc64ea7c70fc1b3b5301ff68b598))
* add reinstall.sh script for easy updates ([abcc2dd](https://github.com/pawlsclick/mnemospark/commit/abcc2dda61d2da1edc3eb53a7661b5e8573bb346))
* add response cache for LLM completions ([5d3d730](https://github.com/pawlsclick/mnemospark/commit/5d3d730e4ebdbb466e67539758edb335fcb20a6f))
* add routing profiles (free/eco/auto/premium) + fix grok-4-0709 pricing ([2a12507](https://github.com/pawlsclick/mnemospark/commit/2a1250730bd7270c883484d3a8e03bcd47aa7753))
* add session persistence to prevent mid-task model switching ([49be74b](https://github.com/pawlsclick/mnemospark/commit/49be74b4fe185c49b71e3ec3298aac1655758e67))
* add startup version check with update notification ([d65df4a](https://github.com/pawlsclick/mnemospark/commit/d65df4ab101a8bc4c6cea1fd6b244f03b8e9efa7))
* **auth-05:** add Mnemospark request signing module ([19c6eca](https://github.com/pawlsclick/mnemospark/commit/19c6eca71bdf59a905a62f1c8cd3ba0270c33735))
* auto-detect tool requests and force agentic routing ([791e68e](https://github.com/pawlsclick/mnemospark/commit/791e68ebe11e921a4963874617d80132c41b52d5))
* auto-generate wallet on first run + add User-Agent header ([9edbd3f](https://github.com/pawlsclick/mnemospark/commit/9edbd3fcbfd1789f4ab17f0315eb314df13f2184))
* ClawRouter v0.5.0 - Agentic routing, context-aware fallbacks, tool detection ([c4f9146](https://github.com/pawlsclick/mnemospark/commit/c4f9146f4d3da0b0db397df587c7d32975f86416))
* context-length-aware routing ([c3ffc8a](https://github.com/pawlsclick/mnemospark/commit/c3ffc8a876e789d597a2640b805920fe5d83526c))
* **dashboard:** update design to match BlockRun style ([2cb0e70](https://github.com/pawlsclick/mnemospark/commit/2cb0e709b1ec1ee1f0ce0078c628af6a5475fc8b))
* decrypt downloaded objects using wrapped DEK + wallet KEK ([#30](https://github.com/pawlsclick/mnemospark/issues/30)) ([2f4c9e5](https://github.com/pawlsclick/mnemospark/commit/2f4c9e569151e603408c71d3e509e1e397a61681))
* enable smart routing by default ([9698104](https://github.com/pawlsclick/mnemospark/commit/96981049fce5d23d2c96321fe7dd8ab246da5a7a))
* expand Russian keyword dictionaries for routing classifier ([af5ca94](https://github.com/pawlsclick/mnemospark/commit/af5ca9430182e287b6f17016a7c106bb53aa46bf))
* expand Russian keyword dictionaries for routing classifier ([f45d1e7](https://github.com/pawlsclick/mnemospark/commit/f45d1e75f8d8a18d0124e989c5a2c0313cd0d941))
* implement /cloud price-storage via local proxy ([8bce7e1](https://github.com/pawlsclick/mnemospark/commit/8bce7e12a332bffcc6559b5ac93a55efaea4ef1e))
* make smart routing opt-in, add uninstall script ([a2ae415](https://github.com/pawlsclick/mnemospark/commit/a2ae415f8c3422ebab556b0e3645665e52978755))
* multilingual keyword support (Chinese, Japanese, Russian) ([4ebe68f](https://github.com/pawlsclick/mnemospark/commit/4ebe68f347c83526ff8af0cf9851ef20193db0a1))
* optimize tier configs with cheaper models ([3a3b13e](https://github.com/pawlsclick/mnemospark/commit/3a3b13ebd18bab93edf0a4d6cdeafbde2566e869))
* Phase 1 & 2 resilience fixes - prevent silent proxy death ([acfc174](https://github.com/pawlsclick/mnemospark/commit/acfc174b5507ed443defc0edd3dbb04f0968aa98))
* rate limit rotation - deprioritize 429'd models for 60s ([b243524](https://github.com/pawlsclick/mnemospark/commit/b243524c640204f40076bdc4c8a5b1a715799a50))
* register model aliases with OpenClaw for /model command ([7271c61](https://github.com/pawlsclick/mnemospark/commit/7271c612a4352df1a1a6506aed65e50fa7fed1f2))
* rename aliases to sonnet4.6/opus4.6, remove flash from picker ([390950e](https://github.com/pawlsclick/mnemospark/commit/390950e9c1eb8bcb99edda2c039a53d6f38fa47d))
* required-args help and error messages; config docs ([f142198](https://github.com/pawlsclick/mnemospark/commit/f142198b70fe0a0284bc2020a522810480dc44cd))
* robustness improvements - timeout, retry, RPC errors ([3dfbc48](https://github.com/pawlsclick/mnemospark/commit/3dfbc48a14d22b0a204c424ac8b79c599a92a524))
* **router:** agentic task auto-detection ([8c0d68c](https://github.com/pawlsclick/mnemospark/commit/8c0d68c3def80b765bffe14662bf7e544930b40b))
* set blockrun/auto as default model on install ([9b9b89e](https://github.com/pawlsclick/mnemospark/commit/9b9b89e779bb130a18763111bafa76998ecddb96))
* sync models with BlockRun API, add o4-mini and nvidia/gpt-oss-20b ([223b917](https://github.com/pawlsclick/mnemospark/commit/223b917f793446c0bb84ea3d5ac226d866081631))
* transform payment errors into user-friendly messages ([f611caf](https://github.com/pawlsclick/mnemospark/commit/f611caff5da9bb8553c44a79b3acc7d03001b223))
* update Claude Sonnet 4 → 4.6 model references ([edaa1b8](https://github.com/pawlsclick/mnemospark/commit/edaa1b8e2bcc36cab62caa44e16d5052b7028f01))
* update model catalog with latest BlockRun models ([c369954](https://github.com/pawlsclick/mnemospark/commit/c369954198adbd14cee7ae50b92d8b04876cfd61))
* update premium tier routing ([29c87db](https://github.com/pawlsclick/mnemospark/commit/29c87db73cb74849cf1ed6a1bc17f99cf7597fbd))
* upgrade COMPLEX tier to Claude Opus, rebase savings on Opus baseline ([8ad34ed](https://github.com/pawlsclick/mnemospark/commit/8ad34ed1d5a625291e201e9971beeeeb895011c6))
* version and release management planning ([58a671d](https://github.com/pawlsclick/mnemospark/commit/58a671dea3adf62f60abf6114e1141e3a5c828a0))
* weighted scoring engine with 14 dimensions and sigmoid confidence ([34c3943](https://github.com/pawlsclick/mnemospark/commit/34c3943f6f017b47a8ac63f9256c90943c688135))


### Bug Fixes

* accurate stats tracking - recalculate cost for fallback models, use full body length, add 20% buffer ([2687a4d](https://github.com/pawlsclick/mnemospark/commit/2687a4db686546caa6f64d6cbf3252c32259cebc))
* add 80% buffer to pre-flight balance check ([0c88fc9](https://github.com/pawlsclick/mnemospark/commit/0c88fc9ed746b4d1f7a36609137f66d06bda940c))
* add aliases for base Claude model names without version (claude-sonnet-4 -&gt; claude-sonnet-4-6) ([e08c9cc](https://github.com/pawlsclick/mnemospark/commit/e08c9ccffcb5f6ed9fd51fd0316aa83bf0f5dbc8))
* add ALL blockrun models to allowlist ([5e59361](https://github.com/pawlsclick/mnemospark/commit/5e59361871a89c1af31930250cdef700cd93efe2))
* add anthropic/sonnet, anthropic/opus, anthropic/haiku model aliases ([de628be](https://github.com/pawlsclick/mnemospark/commit/de628be6c3333fb764375b0fbe1fe07d348ef696))
* add apiKey to blockrun provider config for /model picker ([78b62ea](https://github.com/pawlsclick/mnemospark/commit/78b62ea03f72f7cdab92f5f0fe087e71cbfa8bb1))
* add auth profile injection to reinstall script ([90db618](https://github.com/pawlsclick/mnemospark/commit/90db618631a1bf7d8c17eece6c335514c39ef231))
* add auto-router and router aliases for auto routing profile ([cc075a5](https://github.com/pawlsclick/mnemospark/commit/cc075a56f3ae7242ef064fb78d1e0d35dcae1399))
* add blockrun models to agents.defaults.models allowlist ([b955666](https://github.com/pawlsclick/mnemospark/commit/b955666244ec0c19ad26ae89b3919c8fc48ec13e))
* add debug logging for model routing and make matching case-insensitive ([a34b381](https://github.com/pawlsclick/mnemospark/commit/a34b3813275745c5932b3643c4fa0705fcc71616))
* add dist verification to reinstall script, bump to 0.9.12 ([8deab0d](https://github.com/pawlsclick/mnemospark/commit/8deab0d1e1dee707474ab68d1ecd852f7bbf748a))
* add gateway_stop hook to prevent EADDRINUSE on hot restart ([24e1b57](https://github.com/pawlsclick/mnemospark/commit/24e1b57ea9bbfbc18c40d41d3a1720f6f995b8f7))
* add HTTP 413 to fallback status codes for context limit errors ([3a76188](https://github.com/pawlsclick/mnemospark/commit/3a761880755a547e8ef4e49c34be9380e06f138d))
* add logprobs and system_fingerprint to SSE chunks for OpenAI compat ([ec46bed](https://github.com/pawlsclick/mnemospark/commit/ec46bed15360c2fedb5613ebaaaffc3de9a868b7))
* add mini to deprecated aliases to properly clean up config ([afad285](https://github.com/pawlsclick/mnemospark/commit/afad28554fad79df6de74aa8dcc0c3e733bc4daf))
* add minimax to ALIASES_TO_INJECT for model picker ([9f4c0ed](https://github.com/pawlsclick/mnemospark/commit/9f4c0ed81f68bd0900e009fa681840e10fdf0656))
* add missing journal.ts module ([85fb403](https://github.com/pawlsclick/mnemospark/commit/85fb403ed7e37d4ac26a10241a2522e0223ace93))
* add missing model aliases to KEY_MODEL_ALIASES for Telegram /model picker ([c09ec01](https://github.com/pawlsclick/mnemospark/commit/c09ec013615a31618703c03db08b160cb213d56d))
* add plugin to allow list after reinstall ([9284d2b](https://github.com/pawlsclick/mnemospark/commit/9284d2b8debea232d5512b04077e7d1696fd11d5))
* add reasoning_content to messages for reasoning models ([0ab83aa](https://github.com/pawlsclick/mnemospark/commit/0ab83aa7ceab04ef04326bef8258c7abb10fd38e))
* add wallet persistence checks and verification ([345f087](https://github.com/pawlsclick/mnemospark/commit/345f0873bbd499a44da1f08756758323bc1e11ee))
* adjust agentic threshold to 0.69 for better context handling ([860e50a](https://github.com/pawlsclick/mnemospark/commit/860e50adc5874f6fde330a0623c87e5128bfc2d8))
* align plugin ID to 'clawrouter' (was 'claw-router') ([37dd51a](https://github.com/pawlsclick/mnemospark/commit/37dd51a1b9e297bac01bb519067882f1f6811d2e))
* align x402 payload with 402 payment requirements ([ff1c2d3](https://github.com/pawlsclick/mnemospark/commit/ff1c2d38453008ab9a99f2feb62c18c33331b793))
* always set blockrun/auto as default model on upgrade ([4f259c8](https://github.com/pawlsclick/mnemospark/commit/4f259c8144e0aeabd63e7c7a0bb8555618d836a4))
* auto-cleanup deprecated model aliases from config (nvidia/gpt/o3/grok) ([f237ef9](https://github.com/pawlsclick/mnemospark/commit/f237ef90ee180af99a8dfc5f87584c05054f86c9))
* auto-truncate messages exceeding 200 limit ([59bfd58](https://github.com/pawlsclick/mnemospark/commit/59bfd58a9e443984875aa3bc5e751d7becd4cf38))
* canonicalize JSON before dedup hash to prevent Discord message duplication ([5e921bd](https://github.com/pawlsclick/mnemospark/commit/5e921bddcf1e6eaba546763438c5d3f6cc3e3654))
* **ci:** format README with Prettier ([24e744e](https://github.com/pawlsclick/mnemospark/commit/24e744e74fabfc9215b85cc73d7f14931a11a8ab))
* **ci:** ignore .aws-sam build artifacts in prettier ([9edcee1](https://github.com/pawlsclick/mnemospark/commit/9edcee12b01a43631a404f663480a1b7eb0798f6))
* clean stale clawrouter from plugins.allow during reinstall ([8cb02a5](https://github.com/pawlsclick/mnemospark/commit/8cb02a5ca2281b8f77af5bb6de2c13c5ed484a73))
* cloud-command-handler-guard release v0.1.18 ([8dd5ecf](https://github.com/pawlsclick/mnemospark/commit/8dd5ecfad7ee562e031059fcbe359897c9943a46))
* convert PowerShell test script to CRLF line endings for Windows ([f0a65db](https://github.com/pawlsclick/mnemospark/commit/f0a65dbded876811e5741d1f3b1d4cc897bd0a63))
* correct reinstall script ordering (install before allow list) ([7fbf434](https://github.com/pawlsclick/mnemospark/commit/7fbf4340d5f1466f29fbe5bf89d8ded631e38787))
* create openclaw.json if missing, fix broken configs on every load ([ff44440](https://github.com/pawlsclick/mnemospark/commit/ff44440a5e3cf3a7d6e358e507ea4649a4f8dee9))
* delete flow ([6a2ab27](https://github.com/pawlsclick/mnemospark/commit/6a2ab27267347071beb66cf7794452012c286094))
* deploy extension files (incl. uninstall script) during install ([abf548c](https://github.com/pawlsclick/mnemospark/commit/abf548c309b659015a118abc7b7752619fd0c970))
* deploy uninstall script to persistent data dir for idempotent uninstall ([97dcfd2](https://github.com/pawlsclick/mnemospark/commit/97dcfd249f3d089c2c2263b50d45ae3e6f7bc328))
* direct minimax injection in reinstall script for reliable model registration ([8c10f03](https://github.com/pawlsclick/mnemospark/commit/8c10f0342c1ffc92d22fc98a423794057898f592))
* discord → telegram link ([2eac28f](https://github.com/pawlsclick/mnemospark/commit/2eac28fe264f5c125a41a7f070b6f33fcc037168))
* EIP-712 v4 standard ([4dc54dd](https://github.com/pawlsclick/mnemospark/commit/4dc54dd3de6aff8f791e72a00e410881d3cdc53f))
* enforce CRLF line endings for PowerShell scripts via .gitattributes ([c46a6fa](https://github.com/pawlsclick/mnemospark/commit/c46a6fab728b96934040f2c2db1820ad4ebfc7ec))
* ensure all required fields in blockrun provider config ([b7f24c5](https://github.com/pawlsclick/mnemospark/commit/b7f24c576c5569384c27896c451c50dfb1d3e6bc))
* ensure auth profile created for main agent ([ef115f7](https://github.com/pawlsclick/mnemospark/commit/ef115f70efb349365f41da0fd1b11988f99d80dc))
* export calculateModelCost for programmatic use ([c2e5485](https://github.com/pawlsclick/mnemospark/commit/c2e54853cfae683d044fab4cb8f59675b9ee2a52))
* fix-06-client-handle-207-s3-retry ([6b4d7d8](https://github.com/pawlsclick/mnemospark/commit/6b4d7d83c3d4c8196e04c6f0cd60b58452574995))
* fixed issues in v0.1.9 ([fed614c](https://github.com/pawlsclick/mnemospark/commit/fed614cb735e43205a8bef266a6cbc111afa4138))
* fixed OpenClaw extension entry path ([30b1fdb](https://github.com/pawlsclick/mnemospark/commit/30b1fdb6aec5103a2b4b05a15e55e7e94319bdda))
* force stream:false since BlockRun API doesn't support streaming yet ([5709c5d](https://github.com/pawlsclick/mnemospark/commit/5709c5dedd7b7b0d740ca84e26ee6b3f0a01c8b0))
* format code with prettier ([794551c](https://github.com/pawlsclick/mnemospark/commit/794551cc97cb3da544d903c5913bb01990c063ce))
* forward tool_calls in SSE streaming response ([e7f1346](https://github.com/pawlsclick/mnemospark/commit/e7f1346ea12088a405986e596828544e29611d09))
* guard cloud upload handler ([#28](https://github.com/pawlsclick/mnemospark/issues/28)) ([34d149c](https://github.com/pawlsclick/mnemospark/commit/34d149ccf017463f298bd83ffe72628ea90c978c))
* handle Anthropic format tool_use in reasoning_content normalization ([c37cd2c](https://github.com/pawlsclick/mnemospark/commit/c37cd2c1434bb19fb5c2606516f862ffb6e47257))
* handle EADDRINUSE gracefully when proxy already running ([1627f96](https://github.com/pawlsclick/mnemospark/commit/1627f961e4b81761b3cf0a6dccb6691227a3293a))
* handle malformed JSON gracefully in reinstall script ([f5a3ed2](https://github.com/pawlsclick/mnemospark/commit/f5a3ed27dca6bc02117881c75cc49c37e1c6320c))
* handle multimodal messages in compression (fixes [#32](https://github.com/pawlsclick/mnemospark/issues/32)) ([d43fe48](https://github.com/pawlsclick/mnemospark/commit/d43fe48968914652b66260087001356d46befe5e))
* handle TIME_WAIT state on gateway restart ([cf43d73](https://github.com/pawlsclick/mnemospark/commit/cf43d73d4aa4153f5cf8b1838fdb0ffd6986e3f6))
* handle undefined price fields in calculateModelCost to prevent NaN ([6b98e79](https://github.com/pawlsclick/mnemospark/commit/6b98e7940eff2f8c079de24b4ed5833177ff2039))
* improve routing accuracy - prevent sticky grok-4-fast-reasoning ([91abc54](https://github.com/pawlsclick/mnemospark/commit/91abc5455768c90f8b17eb33e0cbe25d887483e1))
* make proxy startup non-blocking to prevent model selection hang ([003a0f3](https://github.com/pawlsclick/mnemospark/commit/003a0f354dd3dfb39828cc956b65f5cd9828ab2f))
* merge activate() into register() — OpenClaw only calls register() ([1319312](https://github.com/pawlsclick/mnemospark/commit/1319312c232574793e41a603640f1b7cb0893a56))
* move allow list step after install to avoid validation error ([c641769](https://github.com/pawlsclick/mnemospark/commit/c641769af76110712f79233e980aae5feebe0fa5))
* normalize messages for Google models ([d88fc75](https://github.com/pawlsclick/mnemospark/commit/d88fc755444c8aa16bc331ba3ff81cdc787d201a)), closes [#8](https://github.com/pawlsclick/mnemospark/issues/8)
* normalize non-standard message roles (developer -&gt; system) ([11350b8](https://github.com/pawlsclick/mnemospark/commit/11350b80dcf7c460c8861a8c8e349a165d2e50a8))
* normalize repository.url ([3f76fe4](https://github.com/pawlsclick/mnemospark/commit/3f76fe4e0493496d8e3a0e7088046f31f9c853b4))
* only start proxy in gateway mode, not during CLI commands ([193056e](https://github.com/pawlsclick/mnemospark/commit/193056e5d8955fe755e1a1268a000f92b42de77a))
* optimize routing tiers with best models at each price point (v0.9.17) ([bb711e5](https://github.com/pawlsclick/mnemospark/commit/bb711e50a27198bd4edbba722149bb36106bb974))
* payment cron schedule and user message (monthly on 1st, not */30) ([2e8d3e9](https://github.com/pawlsclick/mnemospark/commit/2e8d3e927c291990569892afd436eb5389e05686))
* plugin redesign ([9ba5089](https://github.com/pawlsclick/mnemospark/commit/9ba5089ef7f80a2762f4cc95d36274e35e80b306))
* plugin redesign (2) ([78f9589](https://github.com/pawlsclick/mnemospark/commit/78f9589c3eb4d05b0181194e498f71759863e1ac))
* prettier formatting ([c8a6c5f](https://github.com/pawlsclick/mnemospark/commit/c8a6c5f19acf247ea8bc327a9d8b5fd008f34a9c))
* prettier formatting for premium tier routing config ([1648463](https://github.com/pawlsclick/mnemospark/commit/1648463aac1f82f8e7e00f98fcaaaf9bc1281945))
* prevent config clobber on corrupt JSON + atomic write ([375137a](https://github.com/pawlsclick/mnemospark/commit/375137affedcd6e08788d23979b9c10222d164c6))
* prevent install command from hanging by skipping proxy startup during installation ([b54123a](https://github.com/pawlsclick/mnemospark/commit/b54123a7bbe9ed4a3db2da9aa688d92f6e0f5f45))
* proper SSE streaming format for Discord, add security documentation ([7959dce](https://github.com/pawlsclick/mnemospark/commit/7959dce1fda3ea934c73889145590e1374c3d81b))
* properly format SSE response for streaming requests ([b9d47d2](https://github.com/pawlsclick/mnemospark/commit/b9d47d228e0b2149280e0747574a66972f658a64))
* **proxy:** allow upload retry when payment is already settled ([#31](https://github.com/pawlsclick/mnemospark/issues/31)) ([4f7d4a1](https://github.com/pawlsclick/mnemospark/commit/4f7d4a188a942edcc18e261e9725199380059b33))
* **proxy:** fallback on degraded 200 responses ([044ad2a](https://github.com/pawlsclick/mnemospark/commit/044ad2a18e85c340b37263bf765102d39ab0ab16))
* raise agentic auto-detection threshold from 0.6 to 0.75 ([a4f707a](https://github.com/pawlsclick/mnemospark/commit/a4f707a99efd9e5b7a73064748ef5dde11bf10ea))
* read version dynamically from package.json in /stats panel ([e026d4c](https://github.com/pawlsclick/mnemospark/commit/e026d4c31e646d865c731b3dd4a6fdfdcb1705af))
* recognize 'auto' model when OpenClaw strips prefix ([18e7343](https://github.com/pawlsclick/mnemospark/commit/18e73435f645d68c8faf146a2d893a6f9e96acac))
* refresh models list on plugin load to include new aliases ([3f077b8](https://github.com/pawlsclick/mnemospark/commit/3f077b8e2d59cf840eccf26ab450b0136be75c52))
* register auto model without provider prefix for OpenClaw compatibility ([033924c](https://github.com/pawlsclick/mnemospark/commit/033924c5cf16f0d951d5f2c24b692363fe7a0766))
* reinstall script now works with curl|bash for model refresh ([bcba8c2](https://github.com/pawlsclick/mnemospark/commit/bcba8c27261e01008ae19201fd9396e6da77fbef))
* remove compromised wallet key from tests, fix prettier formatting ([500d24f](https://github.com/pawlsclick/mnemospark/commit/500d24fce151f7224747fe4ead707168213cd22b))
* remove conflicting 'free' alias, enable eco/premium routing profiles ([0f0b683](https://github.com/pawlsclick/mnemospark/commit/0f0b68315a298618ab3e1ce7c8c04d2214e6ed7d))
* remove dashboard reference, fix gzip header forwarding ([1f3a43b](https://github.com/pawlsclick/mnemospark/commit/1f3a43bfb5f02b60206b6888d5de55cdd6fb17d7))
* remove deprecated aliases (mini) from config during reinstall ([6e5e5e1](https://github.com/pawlsclick/mnemospark/commit/6e5e5e1b6e64235685194efbd144f7f4d1e1896b))
* remove duplicate createNonce imports (typecheck) ([c0cfe46](https://github.com/pawlsclick/mnemospark/commit/c0cfe4637883545bbcf035ce54ff118d063481c0))
* remove invalid backtick-n escape sequences in PowerShell test script ([6116db5](https://github.com/pawlsclick/mnemospark/commit/6116db5eab6207742420a7a41663c28c274b2aaa))
* remove invalid node_modules extension entry that breaks openclaw plugin install ([#23](https://github.com/pawlsclick/mnemospark/issues/23)) ([1e00dd8](https://github.com/pawlsclick/mnemospark/commit/1e00dd8742fb9a76d4a064548331566802d01295))
* remove nvidia/gpt/o3/grok from Telegram model picker (keep routing) ([88c92ca](https://github.com/pawlsclick/mnemospark/commit/88c92ca7bda0cc058bc1a74f7026e18c1b69399d))
* remove o4-mini placeholder, add RPC timeout ([c712dec](https://github.com/pawlsclick/mnemospark/commit/c712dec0572cfe638fcfcbe4674001294c177381))
* remove unused AUTO_MODEL_SHORT variable ([38c4d1b](https://github.com/pawlsclick/mnemospark/commit/38c4d1b8afd78f41ba63b970dd8914df9b3787d5))
* remove unused BalanceInfo import ([bcfab98](https://github.com/pawlsclick/mnemospark/commit/bcfab98513546534a826d350e09234525ec3d3c0))
* remove unused catch variable ([176ce33](https://github.com/pawlsclick/mnemospark/commit/176ce33f738fdd261d5116ca16a23dbcd2df8f3a))
* remove unused error imports (lint) ([d0deb32](https://github.com/pawlsclick/mnemospark/commit/d0deb32de3d1d06582113d754340d713f7661bca))
* remove unused import ([38d31f9](https://github.com/pawlsclick/mnemospark/commit/38d31f90ed02631ffb0e59912b3163f8a031f7ce))
* rename sonnet/opus/haiku aliases to avoid shadowing core models ([#28](https://github.com/pawlsclick/mnemospark/issues/28)) ([74c8721](https://github.com/pawlsclick/mnemospark/commit/74c8721c77ef85158690fe4f2a705f64b67ff94c))
* reorder PREMIUM COMPLEX fallback to gpt-5.2-codex -&gt; opus-4.5 -&gt; sonnet-4 ([d058ed5](https://github.com/pawlsclick/mnemospark/commit/d058ed522e11692e7d7673c8270faf36fc09a99e))
* reorder reinstall script steps to prevent config setup being skipped ([db8e828](https://github.com/pawlsclick/mnemospark/commit/db8e8286e70af52486e5b41b3eda8377b098ca03))
* replace dedup resolver closure chain with array to prevent hangs ([#25](https://github.com/pawlsclick/mnemospark/issues/25)) ([fdefab5](https://github.com/pawlsclick/mnemospark/commit/fdefab53617b22d2d690b8718d14fe9429eb2e84))
* resolve lint errors ([cb80e70](https://github.com/pawlsclick/mnemospark/commit/cb80e701162dcc51d6887e79b7f92f60801c543c))
* restore forced default model, keep reduced allowlist ([d86e691](https://github.com/pawlsclick/mnemospark/commit/d86e691256138b148ff82f803c7e14c828c48d78))
* revert submodule pointer to original commit ([03adef5](https://github.com/pawlsclick/mnemospark/commit/03adef53f4224be0c5ca19481d7ee0d76a88aee2))
* route reasoning keywords only in user prompt, replace o3 with DeepSeek ([9d5049b](https://github.com/pawlsclick/mnemospark/commit/9d5049b8b7749f150273cfe13cb076e75075c16e))
* **router:** restore dashed Claude baseline and add alias regressions ([cbad791](https://github.com/pawlsclick/mnemospark/commit/cbad791645ebb5ff2e0ce623713f0c1191b9bede))
* sanitize tool IDs to match Anthropic's pattern ([#18](https://github.com/pawlsclick/mnemospark/issues/18)) ([bdb0840](https://github.com/pawlsclick/mnemospark/commit/bdb08409aa6008ec29c2901158abcf984c43662f))
* set finish_reason to tool_calls when tool calls are present ([1339fcc](https://github.com/pawlsclick/mnemospark/commit/1339fccd7a5a308a457a82ad14940114a9e34353))
* show error output when plugin install fails in Windows tests ([9bbe647](https://github.com/pawlsclick/mnemospark/commit/9bbe6471ce30b642c9b2780ff589f2432402cde8))
* simplify PowerShell test output to avoid encoding issues ([2b0028a](https://github.com/pawlsclick/mnemospark/commit/2b0028afaa7f0b06f9f960cd900e3e03d3dcc715))
* slash commands ([7892714](https://github.com/pawlsclick/mnemospark/commit/7892714c151ed63cb941ae4b74630caa3d170e5c))
* slash commands (2) ([f45bd9e](https://github.com/pawlsclick/mnemospark/commit/f45bd9e1d5ed01556e9037df37838551701d8767))
* stats display shows all tiers and notes partial baseline tracking ([7e57a19](https://github.com/pawlsclick/mnemospark/commit/7e57a19a083b1d6387375416192d33f4dbd384a1))
* strip blockrun/ prefix from direct model paths ([42f981e](https://github.com/pawlsclick/mnemospark/commit/42f981ec041675207ebc0d35633171001edc64b7))
* strip DSML markup tokens from Kimi/DeepSeek responses ([fc38c0a](https://github.com/pawlsclick/mnemospark/commit/fc38c0afac0d9610cd0d6432bc59741a623245bb))
* strip Kimi thinking tokens from model responses ([3c16d10](https://github.com/pawlsclick/mnemospark/commit/3c16d1099eeca19269f693fc012db0a5246d7123))
* strip OpenClaw timestamps before hashing for dedup ([d7f86d6](https://github.com/pawlsclick/mnemospark/commit/d7f86d67011e464a44bb88a84f8eea802cb1a6e0))
* sync package-lock.json with vitest dependencies ([0bfe0e5](https://github.com/pawlsclick/mnemospark/commit/0bfe0e5367031ddf289a8cc38b5390a23c6660b1))
* timestamp converted via BigInt(payload.timestamp) ([0068341](https://github.com/pawlsclick/mnemospark/commit/0068341d56b04886465e9452b7830c93fc017e12))
* transform invalid_payload and settlement errors into user-friendly messages ([3ca6d9f](https://github.com/pawlsclick/mnemospark/commit/3ca6d9f92ad6d765884d2ec2b18cb3aed4155879))
* transform response to streaming format for OpenClaw compatibility ([d40d3fc](https://github.com/pawlsclick/mnemospark/commit/d40d3fc08fbb3cce9cedce6b2e95a130545af76d))
* update model injection to detect new models by ID, not just length ([ff5051a](https://github.com/pawlsclick/mnemospark/commit/ff5051a2e6c2b2662e2a5c91e5c7282efddbef56))
* update package name to @blockrun/clawrouter in docker tests ([7a0d456](https://github.com/pawlsclick/mnemospark/commit/7a0d4562f4d7839bdcdba96bf84b50df95926734))
* update tests for agentic routing + add local /v1/models endpoint ([c11123d](https://github.com/pawlsclick/mnemospark/commit/c11123ded90494657e06e75721627475491ad1af))
* use 'openclaw models set' instead of deprecated 'openclaw config set model' ([8b91307](https://github.com/pawlsclick/mnemospark/commit/8b91307e35c244af01017a68dd65382db7a1d3a6))
* use correct config path for default model (agents.defaults.model) ([cdb129a](https://github.com/pawlsclick/mnemospark/commit/cdb129a7b1189ece9ee839912affb05de5ffaac3))
* use correct nested path agents.defaults.model.primary ([543d613](https://github.com/pawlsclick/mnemospark/commit/543d61303f0132af3c39493ac5a9b0925ce23fe8))
* use correct OpenClaw auth-profiles.json format ([5c87977](https://github.com/pawlsclick/mnemospark/commit/5c8797786cb23062ad9cc108618cefbf971d4215))
* use dashes in Claude model IDs (claude-opus-4-6 not 4.6) for Anthropic API compatibility ([74de7af](https://github.com/pawlsclick/mnemospark/commit/74de7af2e870fe8d9379f1e3aa643e3eee949130))
* use fixed default port 8402 instead of random ([03a600d](https://github.com/pawlsclick/mnemospark/commit/03a600df563841e662c6aee715b41c539c71bea8))
* use opus-4.6 as PREMIUM COMPLEX primary ([f1ed9dd](https://github.com/pawlsclick/mnemospark/commit/f1ed9ddd4ab4d1303e3434486e49e87d1c04eaa9))
* use registerService for proper proxy cleanup on gateway restart ([07ddc22](https://github.com/pawlsclick/mnemospark/commit/07ddc226cae6d54d5696b6dafe86d05cf68a84c3))
* use type-only re-export for isolated modules ([bc8b4b2](https://github.com/pawlsclick/mnemospark/commit/bc8b4b273536050eebb16e78942d535f7f77b8e2))
* use VERSION from version.ts instead of top-level await ([29f8e2a](https://github.com/pawlsclick/mnemospark/commit/29f8e2a6ea30701b243f96dc9ec15aed4decd964))
* use VERSION from version.ts, extract PROXY_PORT to config.ts ([1f3ad9b](https://github.com/pawlsclick/mnemospark/commit/1f3ad9b8ffe35ec32c13e557bac81adace945c24))
* UX improvements and thinking/reasoning content fix ([76b1c29](https://github.com/pawlsclick/mnemospark/commit/76b1c2989dbc3bb7abef28567f6043031c0a8264))


### Performance Improvements

* use kimi-k2.5 for agentic SIMPLE tier (50% cheaper than haiku) ([40bd35a](https://github.com/pawlsclick/mnemospark/commit/40bd35aa9a709645b49c5716edf86862631b028f))


### Reverts

* don't strip DSML tool calls from Kimi/DeepSeek ([ab0dea8](https://github.com/pawlsclick/mnemospark/commit/ab0dea8fdb04d4a13b449640f5a42f700a8f2412))
* rollback PROXY_PORT constant to fix production install ([01ea41f](https://github.com/pawlsclick/mnemospark/commit/01ea41fe77f3151c94f21751599699fb4d2c0623))

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
