# cora-cli

Open-source plugins for coding CLIs that let you earn free LLM credits by taking surveys and seeing labeled sponsor lines, without ever reading your code.

**Status:** pre-release, under active development.

## Principles

- **Opt-in.** Nothing is sent until you enable it.
- **Never reads your code or prompts.** Only coarse, allow-listed tags (e.g. `lang:ts`, `fw:nextjs`) leave your machine. Run `/cora why` to see the exact last payload.
- **Off in CI and non-interactive runs**, and off when `CORA_DISABLE=1` is set.
- **Never blocks input** and never injects anything into the model's context.
- **Uses only official plugin APIs** of the host CLI.

## Packages (planned)

| Package | Host |
|---|---|
| `packages/core` | Shared tag extractor, taxonomy, API client, payload log |
| `packages/opencode` | opencode TUI plugin |
| `packages/pi` | Pi extension |
| `packages/statusline` | statusLine script (Claude Code, Qwen Code) |

## License

MIT
