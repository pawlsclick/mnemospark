# mnemospark Commands Reference

## `/mnemospark_cloud`

### Backup

`backup <file|directory> [--name <friendly-name>]`

### Price storage quote

`price-storage --wallet-address <addr> --object-id <id> --object-id-hash <hash> --gb <gb> --provider <provider> --region <region>`

### Upload

`upload --quote-id <quote-id> --wallet-address <addr> --object-id <id> --object-id-hash <hash> [--name <friendly-name>] [--async]`

### List

`ls --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>]`

### Download

`download --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>] [--async]`

### Delete

`delete --wallet-address <addr> [--object-key <object-key> | --name <friendly-name>] [--latest|--at <timestamp>]`

### Operation status

`op-status --operation-id <id>`

## Name selector rules

- `--object-key` and `--name` are mutually exclusive.
- If `--name` maps to multiple active objects, require `--latest` or `--at`.

## One-step debug helper

```bash
./skills/mnemospark/scripts/debug-operation.sh <operation-id>
```
