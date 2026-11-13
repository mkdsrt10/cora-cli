# cora-cli

Open-source (MIT) plugins for coding CLIs. **This repo is PUBLIC.**

## Public repo rules

- Never add business material: pricing, revenue shares, sponsor or partner names and deals, competitor analysis, launch strategy, internal metrics. That lives in the private home repo, not here.
- Never commit secrets, API keys, internal URLs or backend implementation details. The plugin talks to the backend only through its public API.
- Privacy claims in README and `PRIVACY.md` must match what the code actually sends. If you change the payload, update `PRIVACY.md` in the same change.

## Agent skills

### Issue tracker

Issues are tracked in this repo's GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Commits

Commits and PRs are authored by the repo owner (`mkdsrt10`) alone. Never add `Co-Authored-By` lines, "Generated with" footers or any other AI attribution to commit messages, PR descriptions or issues.
