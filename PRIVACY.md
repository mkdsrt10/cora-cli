# Privacy

This describes what the code in this repo does today. If the code changes what it sends, this file changes in the same commit.

Cora runs in one of two modes. `cora status` shows which.

## Local mode (not signed in)

No Cora service is involved.

| Who connects | Where | What | When |
|---|---|---|---|
| Cora's code (`discoverModels` in `packages/core`) | The endpoint you set with `cora setup` | `GET <base-url>/models`, with your key as a bearer token if you set one | When a tool starts with Cora on, and on `cora setup`, `cora status`, `cora models` |
| Your tool (opencode, Pi, Codex, CodeWhale) | The same endpoint | Your prompts, code and tool results, as with any model provider | Only while you have a Cora model selected |
| Your browser | The offer's URL | Whatever that page collects | Only for an offer that has no questions, after you run `/cora take` or `cora earn take` |

**Demo survey answers stay on your machine.** Submitting one appends your answers to `~/.cora/answers.jsonl`. Nothing is uploaded. Cancelling saves nothing.

## Service mode (after `cora login`)

Cora's code talks to the Cora service you signed in to, and to nothing else. These are all the requests it makes (`packages/core/src/service.ts` and `discoverModels`):

| Request | Body | When |
|---|---|---|
| `POST /api/login/exchange` | `{"code": "<one-time code>"}` | Once, at `cora login` |
| `GET /v1/models` | none | When a tool starts with Cora on, and on `cora status`, `cora models` |
| `GET /api/me` | none | At tool start, after each agent run, and on `cora status`, `cora line`, `cora pane` |
| `GET /api/surveys/next` | none | Only after you run `/cora take` or `cora earn take` |
| `POST /api/surveys/answer` | `{"surveyId", "questionId", "choiceIds"}`: the ids of the options you picked | Each time you answer a question |
| `POST /api/logout` | none | At `cora logout` |

Your Cora key is sent as an `Authorization` header on all but the first.

**Check it yourself.** Every one of these requests is appended to `~/.cora/outbox.jsonl` (method, URL and exact body) before it is sent; if that write fails, the request is not sent. `cora outbox` prints it. The key is never written to the log.

**Model traffic.** While you have a Cora model selected, your tool sends your prompts, code and tool results to the service's model gateway (`<service>/v1`), as it would to any model provider. Cora's plugin code does not read, relay or log that traffic.

**Answering a survey sends your choices to the service, linked to your account.** Each answer is saved as you give it, so closing a survey midway keeps the answers already given. Survey questions sent by the service are multiple choice; no free text is sent.

## Never, in either mode

Cora's code sends no analytics, no crash reports and no tags, and it never reads your prompts, code, file names or repository names.

## Files

| Path | Contents |
|---|---|
| `~/.cora/config.json` | Local endpoint URL and optional key; after login, the service URL and your Cora key (file mode 0600) |
| `~/.cora/state.json` | Demo balance, snooze time, offers on or off, ids of offers you finished; after login, the last balance and survey read from the service |
| `~/.cora/outbox.jsonl` | Every request Cora's code sent to a Cora service (file mode 0600, restarted when it passes 2 MB) |
| `~/.cora/answers.jsonl` | Demo survey answers from local mode (file mode 0600) |
| `~/.cora/installed.json` | Folders Cora created, so `cora models off` can remove them |
| `~/.cora/codex-models.json` | Model list for Codex's picker |
| Per-tool files | Listed in the README and by `cora status` |

Your Cora key is never written into another tool's files: opencode and Pi read it from `~/.cora/config.json`, and Codex runs `cora key`.

Set `CORA_HOME` to move `~/.cora`.

## Off switches

`CORA_DISABLE=1` or a CI environment makes Cora do nothing: no requests, no UI, no files written by the plugins. `cora logout` revokes your key and returns to local mode.
