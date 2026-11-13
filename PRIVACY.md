# Privacy

This describes what the code in this repo does today (v1). If the code changes what it sends, this file changes in the same commit.

## Network

There is no Cora server in v1.

| Who connects | Where | What | When |
|---|---|---|---|
| Cora's code (`discoverModels` in `packages/core`) | The endpoint you set with `cora setup` | `GET <base-url>/models`, with your key as a bearer token if you set one | When a tool starts with Cora on, and on `cora setup`, `cora status`, `cora models` |
| Your tool (opencode, Pi, Codex, CodeWhale) | The same endpoint | Your prompts, code and tool results, as with any model provider | Only while you have a Cora model selected |
| Your browser | The offer's URL | Whatever that page collects | Only after you run `/cora open` or `cora earn open` |

Cora's code sends nothing else: no analytics, no crash reports, no identifiers, no tags. It never reads your prompts, code, file names or repository names.

## Files

| Path | Contents |
|---|---|
| `~/.cora/config.json` | Endpoint URL and, if you set one, its API key (file mode 0600) |
| `~/.cora/state.json` | Demo balance, snooze time, offers on or off, ids of offers you opened |
| `~/.cora/installed.json` | Folders Cora created, so `cora models off` can remove them |
| `~/.cora/codex-models.json` | Model list for Codex's picker |
| Per-tool files | Listed in the README and by `cora status` |

Set `CORA_HOME` to move `~/.cora`.

## Off switches

`CORA_DISABLE=1` or a CI environment makes Cora do nothing: no model list read, no UI, no files written by the plugins.

## What will change

A later version will add a Cora service for real offers and credits. Before that ships, this file will state exactly what is sent, and the code will log every payload locally so you can check it.
