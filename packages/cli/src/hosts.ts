// Per-tool setup. Each tool gets the least invasive change that puts Cora
// models in its picker, and `off` removes only what `on` created.
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmdirSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { PROVIDER_ID, PROVIDER_NAME, type Config, type ModelDef } from "../../core/src/index.ts"

const PACKAGES = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

export type HostContext = { home: string; coraDir: string; config: Config; models: ModelDef[] }
export type Host = {
  id: string
  name: string
  /** What the user gets: models in the picker, and where offers show. */
  surface: string
  installed(home: string): boolean
  /** Human-readable list of the changes `on` will make. */
  plan(ctx: HostContext): string[]
  on(ctx: HostContext): void
  off(ctx: HostContext): void
  isOn(ctx: Pick<HostContext, "home" | "coraDir">): boolean
  /** How to use it after `on`. */
  next: string
}

function onPath(command: string): boolean {
  return (process.env.PATH ?? "").split(":").some((dir) => dir && existsSync(join(dir, command)))
}

/** mkdir -p that returns the directories it created, deepest last. */
function ensureDir(dir: string): string[] {
  const created: string[] = []
  let current = dir
  while (!existsSync(current)) {
    created.unshift(current)
    current = dirname(current)
  }
  mkdirSync(dir, { recursive: true })
  return created
}

function removeEmptyDirs(dirs: string[]): void {
  for (const dir of [...dirs].reverse()) {
    try {
      rmdirSync(dir)
    } catch {
      // Not empty or already gone: leave it.
    }
  }
}

function journalFile(ctx: Pick<HostContext, "coraDir">): string {
  return join(ctx.coraDir, "installed.json")
}

type Journal = Record<string, { createdDirs: string[] }>

function readJournal(ctx: Pick<HostContext, "coraDir">): Journal {
  try {
    return JSON.parse(readFileSync(journalFile(ctx), "utf8")) as Journal
  } catch {
    return {}
  }
}

function writeJournal(ctx: Pick<HostContext, "coraDir">, journal: Journal): void {
  mkdirSync(ctx.coraDir, { recursive: true })
  writeFileSync(journalFile(ctx), JSON.stringify(journal, null, 2) + "\n")
}

function record(ctx: HostContext, id: string, createdDirs: string[]): void {
  const journal = readJournal(ctx)
  journal[id] = { createdDirs: [...(journal[id]?.createdDirs ?? []), ...createdDirs] }
  writeJournal(ctx, journal)
}

function forget(ctx: HostContext, id: string): void {
  const journal = readJournal(ctx)
  removeEmptyDirs(journal[id]?.createdDirs ?? [])
  delete journal[id]
  writeJournal(ctx, journal)
}

function isOurLink(link: string, target: string): boolean {
  try {
    return lstatSync(link).isSymbolicLink() && resolve(dirname(link), readlinkSync(link)) === target
  } catch {
    return false
  }
}

/** A tool that loads plugins from a folder: link our package into it. */
function linkedPlugin(input: {
  id: string; name: string; surface: string; next: string
  configDir: (home: string) => string; pluginsDir: (home: string) => string; packageDir: string
}): Host {
  const link = (home: string) => join(input.pluginsDir(home), "cora")
  return {
    id: input.id,
    name: input.name,
    surface: input.surface,
    next: input.next,
    installed: (home) => existsSync(input.configDir(home)) || onPath(input.id),
    plan: (ctx) => [`link  ${link(ctx.home)} -> ${input.packageDir}`, "no existing file is edited"],
    isOn: (ctx) => isOurLink(link(ctx.home), input.packageDir),
    on(ctx) {
      if (this.isOn(ctx)) return
      if (existsSync(link(ctx.home))) throw new Error(`${link(ctx.home)} already exists and is not Cora's link`)
      record(ctx, input.id, ensureDir(input.pluginsDir(ctx.home)))
      symlinkSync(input.packageDir, link(ctx.home), "dir")
    },
    off(ctx) {
      if (this.isOn(ctx)) rmSync(link(ctx.home))
      forget(ctx, input.id)
    },
  }
}

const opencode = linkedPlugin({
  id: "opencode",
  name: "opencode",
  surface: "models in /models · offers in the sidebar and footer · /cora",
  next: "Restart opencode, then pick a Cora model with /models.",
  configDir: (home) => join(home, ".config", "opencode"),
  pluginsDir: (home) => join(home, ".config", "opencode", "plugins"),
  packageDir: join(PACKAGES, "opencode"),
})

const pi = linkedPlugin({
  id: "pi",
  name: "Pi",
  surface: "models in /model · offers in a widget below the editor · /cora",
  next: "Restart pi, then pick a Cora model with /model.",
  configDir: (home) => join(home, ".pi"),
  pluginsDir: (home) => join(home, ".pi", "agent", "extensions"),
  packageDir: join(PACKAGES, "pi"),
})

const OWNED = "# Managed by cora. Remove with: cora models off codex\n"

function codexCatalog(models: ModelDef[]): string {
  return JSON.stringify({
    models: models.map((model, index) => ({
      slug: model.id,
      display_name: model.name,
      description: "Served by your Cora endpoint",
      default_reasoning_level: "medium",
      supported_reasoning_levels: [{ effort: "medium", description: "Default" }],
      shell_type: "shell_command",
      visibility: "list",
      supported_in_api: true,
      priority: index + 1,
      upgrade: null,
      base_instructions: "You are a coding agent running in the Codex CLI. Be precise, safe and helpful.",
      supports_reasoning_summaries: false,
      support_verbosity: false,
      default_verbosity: null,
      apply_patch_tool_type: null,
      truncation_policy: { mode: "bytes", limit: 10000 },
      supports_parallel_tool_calls: false,
      context_window: model.contextWindow,
      experimental_supported_tools: [],
    })),
  }, null, 2) + "\n"
}

const codex: Host = {
  id: "codex",
  name: "Codex CLI",
  surface: "models in /model under the cora profile · offers via `cora pane`",
  next: "Run: codex --profile cora   (plain `codex` is unchanged). Run `cora pane` in a second split for offers.",
  installed: (home) => existsSync(join(home, ".codex")) || onPath("codex"),
  plan: (ctx) => [
    `write ${join(ctx.home, ".codex", "cora.config.toml")} (a separate profile; config.toml is untouched)`,
    `write ${join(ctx.coraDir, "codex-models.json")} (model list for the picker)`,
  ],
  isOn: (ctx) => {
    try {
      return readFileSync(join(ctx.home, ".codex", "cora.config.toml"), "utf8").startsWith(OWNED)
    } catch {
      return false
    }
  },
  on(ctx) {
    if (ctx.models.length === 0) throw new Error("no models found at the endpoint; start it and run `cora setup` first")
    const profile = join(ctx.home, ".codex", "cora.config.toml")
    if (existsSync(profile) && !this.isOn(ctx)) throw new Error(`${profile} already exists and is not Cora's file`)
    const catalog = join(ctx.coraDir, "codex-models.json")
    record(ctx, "codex", [...ensureDir(dirname(profile)), ...ensureDir(ctx.coraDir)])
    writeFileSync(catalog, codexCatalog(ctx.models))
    const lines = [
      OWNED.trimEnd(),
      `model_provider = "${PROVIDER_ID}"`,
      `model = ${JSON.stringify(ctx.models[0].id)}`,
      `model_catalog_json = ${JSON.stringify(catalog)}`,
      "",
      `[model_providers.${PROVIDER_ID}]`,
      `name = "${PROVIDER_NAME}"`,
      `base_url = ${JSON.stringify(ctx.config.baseUrl)}`,
      `wire_api = "responses"`,
      // The key stays in the environment; it is never written to this file.
      ...(ctx.config.apiKey ? [`env_key = "CORA_API_KEY"`] : []),
      "",
    ]
    writeFileSync(profile, lines.join("\n"))
  },
  off(ctx) {
    if (this.isOn(ctx)) rmSync(join(ctx.home, ".codex", "cora.config.toml"))
    rmSync(join(ctx.coraDir, "codex-models.json"), { force: true })
    forget(ctx, "codex")
  },
}

const BLOCK_START = "# >>> cora >>> (managed block; remove with: cora models off codewhale)"
const BLOCK_END = "# <<< cora <<<"

/** Removes the managed block, restoring the text that was there before `on`. */
function stripBlock(text: string): string {
  let start = text.indexOf(BLOCK_START)
  if (start < 0) return text
  let end = text.indexOf(BLOCK_END, start)
  if (end < 0) return text
  end += BLOCK_END.length
  if (text[end] === "\n") end += 1
  else if (text[start - 1] === "\n") start -= 1
  return text.slice(0, start) + text.slice(end)
}

const codewhale: Host = {
  id: "codewhale",
  name: "CodeWhale (DeepSeek CLI)",
  surface: "Cora provider in /provider · offers via `cora pane` · untested, written from its docs",
  next: "Restart codewhale, then choose Cora with /provider. Run `cora pane` in a second split for offers.",
  installed: (home) => existsSync(join(home, ".codewhale")) || onPath("codewhale"),
  plan: (ctx) => [
    `append a marked [providers.${PROVIDER_ID}] block to ${join(ctx.home, ".codewhale", "config.toml")}`,
    "your default provider is not changed",
  ],
  isOn: (ctx) => {
    try {
      return readFileSync(join(ctx.home, ".codewhale", "config.toml"), "utf8").includes(BLOCK_START)
    } catch {
      return false
    }
  },
  on(ctx) {
    if (this.isOn(ctx)) return
    const file = join(ctx.home, ".codewhale", "config.toml")
    const existed = existsSync(file)
    const before = existed ? readFileSync(file, "utf8") : ""
    record(ctx, "codewhale", ensureDir(dirname(file)))
    const block = [
      BLOCK_START,
      `[providers.${PROVIDER_ID}]`,
      `kind = "openai-compatible"`,
      `base_url = ${JSON.stringify(ctx.config.baseUrl)}`,
      ...(ctx.config.apiKey ? [`api_key_env = "CORA_API_KEY"`] : []),
      ...(ctx.models[0] ? [`model = ${JSON.stringify(ctx.models[0].id)}`] : []),
      BLOCK_END,
    ].join("\n")
    // A file without a trailing newline keeps that shape, so `off` restores it exactly.
    const text = before === "" || before.endsWith("\n") ? `${before}${block}\n` : `${before}\n${block}`
    writeFileSync(file, text)
    if (!existed) writeFileSync(join(ctx.coraDir, "codewhale-created"), "")
  },
  off(ctx) {
    const file = join(ctx.home, ".codewhale", "config.toml")
    const marker = join(ctx.coraDir, "codewhale-created")
    if (this.isOn(ctx)) {
      const after = stripBlock(readFileSync(file, "utf8"))
      if (after === "" && existsSync(marker)) rmSync(file)
      else writeFileSync(file, after)
    }
    rmSync(marker, { force: true })
    forget(ctx, "codewhale")
  },
}

export const HOSTS: Host[] = [opencode, pi, codex, codewhale]

export function findHost(id: string): Host | undefined {
  return HOSTS.find((host) => host.id === id)
}
