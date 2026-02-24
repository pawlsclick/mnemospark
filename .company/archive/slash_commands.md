# Slash commands

**This file is out of date.** For the authoritative list of slash commands, argument descriptions, and workflow behavior, use:

**[mnemospark_full_workflow.md](./mnemospark_full_workflow.md)**

That document defines:

- **Base:** `/cloud`, `/cloud help`
- **Backup:** `/cloud backup <file>` or `<directory>`
- **Price storage:** `/cloud price-storage --wallet-address <addr>` … (full args in workflow)
- **Upload:** `/cloud upload --quote-id <quote-id> --wallet-address <addr> --object-id <object-id> --object-id-hash <object-id-hash>`
- **List:** `/cloud ls --wallet-address <addr> --object-key <s3-key>`
- **Download:** `/cloud download --wallet-address <addr> --object-key <s3-key>`
- **Delete:** `/cloud delete --wallet-address <addr> --object-key <s3-key>`
- **Wallet:** `/wallet`

Do not rely on this file for argument names (e.g. use **upload** not “store”) or error messages. See mnemospark_full_workflow.md for the full workflow and client/proxy/backend steps.
