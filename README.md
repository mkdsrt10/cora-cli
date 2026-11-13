# cora-cli

Adds Cora models to the model picker of the coding tools you already use, and shows optional, clearly labeled survey offers that earn credits. Open source, opt-in, and undone with one command.

**Status: v1, early.** It runs from a clone of this repo against any OpenAI-compatible endpoint you run yourself (LM Studio, Ollama, vLLM). There is no Cora server yet: offers are built-in demos and the balance is a local demo number.

## What works

| Tool | Cora models | Offers | Checked |
|---|---|---|---|
| opencode 2.2+ | In `/models`, next to your own | Sidebar card, footer line, answered in place with `/cora take` | Yes, on opencode 2.2.1 |
| Pi 1.5+ | In `/model`, next to your own | Widget below the editor, footer status, answered in place with `/cora take` | Yes, on Pi 1.5.2 |
| Codex CLI 0.134+ | In `/model` under `codex --profile cora` | `cora pane` and `cora earn take` in a second split | Yes, on Codex 0.169.0 |
| CodeWhale (DeepSeek CLI) | `Cora` in `/provider` | `cora pane` and `cora earn take` in a second split | No. Written from its docs |

Codex and CodeWhale give plugins no place to draw, so offers for them live in `cora pane` and `cora line`.

## Quick start

Needs Node 22.18 or later. Start a local model server first.

```bash
git clone https://github.com/mkdsrt10/cora-cli.git && cd cora-cli && npm link
```

```bash
cora setup --base-url http://localhost:1234/v1
```

```bash
cora models on opencode pi codex
```

`cora models on` prints the exact change for each tool and asks before making it. Then restart the tool and pick a `Cora · …` model. For Codex, run `codex --profile cora`; plain `codex` is unchanged.

| Endpoint | Base URL |
|---|---|
| LM Studio | `http://localhost:1234/v1` |
| Ollama | `http://localhost:11434/v1` |
| vLLM | `http://localhost:8000/v1` |

Codex only speaks the OpenAI Responses API, so its endpoint must serve `/v1/responses`.

## What `cora models on` changes

| Tool | Change | Undo |
|---|---|---|
| opencode | A link in `~/.config/opencode/plugins/` to this repo's plugin. The plugin registers the provider in memory | `cora models off opencode` removes the link |
| Pi | A link in `~/.pi/agent/extensions/` to this repo's extension | `cora models off pi` removes the link |
| Codex | A separate profile, `~/.codex/cora.config.toml`, and `~/.cora/codex-models.json` | `cora models off codex` deletes both |
| CodeWhale | A block between `# >>> cora >>>` markers appended to `~/.codewhale/config.toml` | `cora models off codewhale` removes the block |

Cora never edits your existing settings in place (the CodeWhale block is the one append), never changes your default model, and never writes an API key into another tool's files. `cora status` lists every file it wrote.

## Offers

One offer shows at a time, with its label, time and credit up front: `Survey · ~1 min · +300 cr`. Offers never appear on their own as a popup, never block input, and never enter the model's context or the transcript.

You answer a survey where you are. `/cora take` asks its questions one at a time in the tool's own dialogs, and the last answer submits it. Closing any question cancels: nothing is saved and no credit is given.

| Command | In opencode and Pi | In a shell (Codex, CodeWhale) |
|---|---|---|
| Answer the current offer | `/cora take` | `cora earn take` |
| Hide offers for an hour | `/cora snooze` | `cora earn snooze` |
| Hide offers until turned back on | `/cora off`, `/cora on` | `cora off`, `cora on` |
| Balance and current offer | `/cora` | `cora earn` |

An offer without questions opens its URL in your browser instead.

### Demo offers

v1 ships three short demo offers. Submitting one adds its credits to a local demo balance, so the flow can be seen end to end. Demo credits have no value and nothing is spent when you use a model. There is no Cora server yet, so "submit" appends your answers to `~/.cora/answers.jsonl` on your machine and sends them nowhere.

To try your own list, put an array of offers in `~/.cora/offers.json`. Each has `id`, `label`, `title`, `minutes`, `credits`, `url`, and optional `questions` (`id`, `text`, and `options` for a multiple-choice question).

## Switching it off

- `CORA_DISABLE=1`, or any CI environment (`CI` set): Cora does nothing at all.
- `cora off`: hides offers, keeps the models.
- `cora models off <tool>`: removes Cora from that tool.

Offers only render inside an interactive TUI. Cora models stay available in non-interactive runs such as `opencode run`, because a model that vanished there would break scripts.

## Privacy

See [PRIVACY.md](./PRIVACY.md). In short: v1 has no Cora server. Cora's own code makes one kind of network request, a read of the model list from the endpoint you configured. Your prompts go from your tool straight to that endpoint.

## Development

```bash
npm test
```

No build step: the code is TypeScript that Node, Bun (opencode) and jiti (Pi) run directly. `packages/core` has no dependencies and holds everything the tools share.

## License

MIT
