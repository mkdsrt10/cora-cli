// The `cora` command.
import { createInterface } from "node:readline/promises"
import { homedir } from "node:os"
import {
  buildView, configFile, coraDir, discoverModels, envDisabled, handleCommand, isConfigured, loadConfig, renderCard,
  renderLine, saveConfig, type Asker, type Config, type ModelDef,
} from "../../core/src/index.ts"
import { findHost, HOSTS, type HostContext } from "./hosts.ts"

const HELP = `cora — free models and optional surveys for the coding tools you already use

  cora setup [--base-url URL] [--api-key KEY]   point Cora at an OpenAI-compatible endpoint
  cora tools                                    supported tools and whether Cora is on in each
  cora models list                              models your endpoint serves
  cora models on  <tool...> [--yes]             add Cora models to a tool (shows the change first)
  cora models off <tool...>                     undo it
  cora status                                   endpoint, balance, and every file Cora wrote
  cora earn [take|snooze]                       show, answer or snooze the current offer
  cora on | off                                 show or hide offers
  cora line                                     one-line status for a prompt or tmux bar
  cora pane                                     live view for a second terminal split

Tools: ${HOSTS.map((host) => host.id).join(", ")}
Set CORA_DISABLE=1 to switch everything off.`

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function positional(args: string[]): string[] {
  const out: string[] = []
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--base-url" || args[index] === "--api-key") index++
    else if (!args[index].startsWith("--")) out.push(args[index])
  }
  return out
}

async function context(config: Config = loadConfig(), models?: ModelDef[]): Promise<HostContext> {
  return { home: homedir(), coraDir: coraDir(), config, models: models ?? (await discoverModels(config)) }
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await prompt.question(`${question} [y/N] `)
  prompt.close()
  return /^y(es)?$/i.test(answer.trim())
}

/** Asks survey questions in the shell. An empty answer or ctrl+d cancels. */
function shellAsker(): Asker & { close(): void } {
  const prompt = createInterface({ input: process.stdin })
  // Reading lines in order also works when answers are piped in.
  const lines = prompt[Symbol.asyncIterator]()
  const ask = async (question: string) => {
    process.stdout.write(question)
    const line = await lines.next()
    return line.done ? undefined : line.value.trim() || undefined
  }
  return {
    close: () => prompt.close(),
    text: (title) => ask(`${title}\n> `),
    async choice(title, options) {
      const list = options.map((option, index) => `  ${index + 1}. ${option}`).join("\n")
      const answer = await ask(`${title}\n${list}\n> `)
      return options[Number(answer) - 1]
    },
  }
}

async function earn(sub: string): Promise<void> {
  const asker = shellAsker()
  const result = await handleCommand(sub, asker)
  asker.close()
  console.log(result.message)
}

async function setup(args: string[]): Promise<void> {
  const current = loadConfig()
  const config: Config = {
    baseUrl: (flag(args, "--base-url") ?? current.baseUrl).replace(/\/+$/, ""),
    apiKey: flag(args, "--api-key") ?? current.apiKey,
  }
  saveConfig(config)
  console.log(`Endpoint: ${config.baseUrl}  (saved to ${configFile()})`)
  const models = await discoverModels(config)
  if (models.length === 0) {
    console.log("No models found there yet. Start your model server, then run: cora models list")
    return
  }
  console.log(`Models:   ${models.map((model) => model.id).join(", ")}`)
  console.log("Next:     cora tools")
}

async function tools(): Promise<void> {
  const ctx = await context(loadConfig(), [])
  for (const host of HOSTS) {
    const state = host.isOn(ctx) ? "on " : host.installed(ctx.home) ? "off" : "not installed"
    console.log(`${host.id.padEnd(10)} ${state.padEnd(14)} ${host.surface}`)
  }
}

async function models(args: string[]): Promise<void> {
  const [action, ...ids] = positional(args)
  const config = loadConfig()
  if (action === "list" || !action) {
    const found = await discoverModels(config)
    if (found.length === 0) return console.log(`No models found at ${config.baseUrl}. Is the server running?`)
    for (const model of found) console.log(`${model.name}   (${model.id})`)
    return
  }
  if (action !== "on" && action !== "off") throw new Error(`unknown: cora models ${action}`)
  if (ids.length === 0) throw new Error(`name a tool: ${HOSTS.map((host) => host.id).join(", ")}`)
  const ctx = await context(config)
  for (const id of ids) {
    const host = findHost(id)
    if (!host) throw new Error(`unknown tool "${id}". Tools: ${HOSTS.map((item) => item.id).join(", ")}`)
    if (action === "off") {
      host.off(ctx)
      console.log(`${host.name}: Cora removed.`)
      continue
    }
    if (host.isOn(ctx) && id !== "codex") {
      console.log(`${host.name}: already on. ${host.next}`)
      continue
    }
    console.log(`${host.name}: this will`)
    for (const line of host.plan(ctx)) console.log(`  ${line}`)
    if (!args.includes("--yes") && !(await confirm("Go ahead?"))) {
      console.log("  skipped (pass --yes to apply without asking)")
      continue
    }
    host.on(ctx)
    console.log(`  done. ${host.next}`)
  }
}

async function status(): Promise<void> {
  const config = loadConfig()
  const ctx = await context(config)
  console.log(`Endpoint   ${config.baseUrl}${isConfigured() ? "" : "  (default; run cora setup)"}`)
  console.log(`Models     ${ctx.models.length ? ctx.models.map((model) => model.id).join(", ") : "none found (server not running?)"}`)
  console.log(`Balance    ${renderCard(buildView())[0].replace("cora · ", "")}`)
  console.log(`Disabled   ${envDisabled() ? "yes (CI or CORA_DISABLE=1)" : "no"}`)
  console.log(`Files      ${coraDir()}  (config, state)`)
  for (const host of HOSTS) {
    if (!host.isOn(ctx)) continue
    console.log(`${host.id.padEnd(10)} on`)
    for (const line of host.plan(ctx)) console.log(`             ${line}`)
  }
  console.log("Network    Cora's code only reads the model list from the endpoint above. No Cora server exists in v1.")
}

async function pane(): Promise<void> {
  if (!process.stdout.isTTY || envDisabled()) return
  const draw = () => {
    const width = Math.min(process.stdout.columns ?? 40, 60)
    const lines = renderCard(buildView()).filter((line) => !line.startsWith("/cora")).map((line) => line.slice(0, width))
    process.stdout.write("\x1b[2J\x1b[H" + lines.join("\n") + "\n\nIn another shell: cora earn take · cora earn snooze\nctrl+c to close\n")
  }
  draw()
  setInterval(draw, 5000)
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)
  switch (command) {
    case "setup": return setup(args)
    case "tools": return tools()
    case "models": return models(args)
    case "status": return status()
    case "earn": return earn(args[0] ?? "status")
    case "on":
    case "off": return earn(command)
    case "line": {
      if (envDisabled()) return
      return console.log(renderLine(buildView(), Number(flag(args, "--width")) || process.stdout.columns || 80))
    }
    case "pane": return pane()
    default: console.log(HELP)
  }
}

main().catch((error: Error) => {
  console.error(`cora: ${error.message}`)
  process.exitCode = 1
})
