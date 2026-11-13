// The `cora` command.
import { emitKeypressEvents } from "node:readline"
import { createInterface } from "node:readline/promises"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import {
  balanceText, buildView, configFile, coraDir, DEFAULT_API_URL, discoverModels, envDisabled, handleCommand, isConfigured,
  loadConfig, loadState, outboxFile, refreshSummary, renderCard, renderLine, revokeKey, saveConfig, saveLogin, saveState,
  type Asker, type Config, type ModelDef,
} from "../../core/src/index.ts"
import { findHost, HOSTS, type HostContext } from "./hosts.ts"
import { login } from "./login.ts"

const HELP = `cora — free models and optional surveys for the coding tools you already use

  cora login [--api URL] [--paste]              sign in to a Cora service (opens your browser)
  cora logout                                   revoke the key and go back to your local endpoint
  cora setup [--base-url URL] [--api-key KEY]   point Cora at an OpenAI-compatible endpoint (no login)
  cora tools                                    supported tools and whether Cora is on in each
  cora models list                              models your endpoint serves
  cora models on  <tool...> [--yes]             add Cora models to a tool (shows the change first)
  cora models off <tool...>                     undo it
  cora status                                   endpoint, balance, and every file Cora wrote
  cora earn [take|snooze]                       show, answer or snooze the current offer
  cora outbox [--tail N]                        every request Cora's code sent to the Cora service
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
    if (["--base-url", "--api-key", "--api", "--tail", "--width"].includes(args[index])) index++
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

/** Arrow-key menu for an interactive terminal. Resolves undefined on esc or ctrl+c. */
function menu(title: string, options: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    const { stdin, stdout } = process
    let selected = 0
    const draw = (first: boolean) => {
      if (!first) stdout.write(`\x1b[${options.length}A`)
      for (const [index, option] of options.entries()) {
        const row = `${index === selected ? "›" : " "} ${index + 1}. ${option}`
        stdout.write(`\x1b[2K${index === selected ? `\x1b[1m${row}\x1b[0m` : row}\n`)
      }
    }
    const finish = (value: string | undefined) => {
      stdin.off("keypress", onKey)
      stdin.setRawMode(false)
      stdin.pause()
      stdout.write("\x1b[?25h")
      resolve(value)
    }
    const onKey = (text: string | undefined, key: { name?: string; ctrl?: boolean }) => {
      if (key.name === "escape" || (key.ctrl && (key.name === "c" || key.name === "d"))) return finish(undefined)
      if (key.name === "return") return finish(options[selected])
      const digit = Number(text)
      if (digit >= 1 && digit <= options.length) {
        selected = digit - 1
        draw(false)
        return finish(options[selected])
      }
      if (key.name === "up" || key.name === "k") selected = (selected + options.length - 1) % options.length
      else if (key.name === "down" || key.name === "j") selected = (selected + 1) % options.length
      else return
      draw(false)
    }
    stdout.write(`${title}\n\x1b[2m↑↓ move · enter select · esc cancel\x1b[0m\n\x1b[?25l`)
    draw(true)
    emitKeypressEvents(stdin)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.on("keypress", onKey)
  })
}

/** Asks survey questions in the shell: arrow keys in a terminal, typed lines when piped. */
function shellAsker(): Asker & { close(): void } {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    return {
      close: () => {},
      choice: menu,
      async text(title) {
        const prompt = createInterface({ input: process.stdin, output: process.stdout })
        const answer = await prompt.question(`${title}\n\x1b[2menter submit · leave empty to cancel\x1b[0m\n> `).catch(() => "")
        prompt.close()
        return answer.trim() || undefined
      },
    }
  }
  const prompt = createInterface({ input: process.stdin })
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

/** Tools that copy the endpoint into a file of their own are rewritten when it changes. */
async function rewriteTools(): Promise<void> {
  const ctx = await context()
  for (const host of HOSTS) {
    if (!host.copiesEndpoint || !host.isOn(ctx)) continue
    host.off(ctx)
    host.on(ctx)
    console.log(`${host.name}: updated for the new endpoint.`)
  }
}

async function signIn(args: string[]): Promise<void> {
  const apiUrl = (flag(args, "--api") ?? process.env.CORA_API_URL ?? loadConfig().service?.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "")
  await login(apiUrl, args.includes("--paste"))
  console.log(`Signed in to ${apiUrl}. Balance: ${balanceText(buildView())}`)
  await rewriteTools()
  console.log("Restart your tools to pick up the Cora models. Earn more with: cora earn take")
}

async function signOut(): Promise<void> {
  if (!loadConfig().service) return console.log("Not logged in.")
  await revokeKey().catch((error: Error) => console.log(`Could not reach the service to revoke the key (${error.message}). Removing it locally.`))
  saveLogin(undefined)
  const { service: _service, ...state } = loadState()
  saveState(state)
  console.log("Logged out. Cora is back on your local endpoint.")
  await rewriteTools()
}

function outbox(args: string[]): void {
  let text = ""
  try {
    text = readFileSync(outboxFile(), "utf8")
  } catch {
    return console.log("Nothing has been sent to a Cora service.")
  }
  const lines = text.trim().split("\n").filter(Boolean)
  for (const line of lines.slice(-(Number(flag(args, "--tail")) || 20))) console.log(line)
  console.log(`${lines.length} request(s) logged in ${outboxFile()}. The key is sent as a header and is never logged.`)
}

async function status(): Promise<void> {
  const config = loadConfig()
  await refreshSummary()
  const ctx = await context(config)
  console.log(`Mode       ${config.service ? `signed in to ${config.service.apiUrl}` : "local endpoint (not signed in)"}`)
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
  console.log(config.service
    ? "Network    Cora's code talks only to the service above; every request is in: cora outbox"
    : "Network    Cora's code only reads the model list from the endpoint above.")
}

async function pane(): Promise<void> {
  if (!process.stdout.isTTY || envDisabled()) return
  const draw = async () => {
    await refreshSummary(20_000)
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
    case "login": return signIn(args)
    case "logout": return signOut()
    case "key": {
      // Used by tools that fetch the key by command, so it is never written into their files.
      const key = loadConfig().apiKey
      if (!key) throw new Error("no key: run cora login")
      return console.log(key)
    }
    case "outbox": return outbox(args)
    case "answer": return earn("take")
    case "setup": return setup(args)
    case "tools": return tools()
    case "models": return models(args)
    case "status": return status()
    case "earn": return earn(args[0] ?? "status")
    case "on":
    case "off": return earn(command)
    case "line": {
      if (envDisabled()) return
      await refreshSummary(60_000)
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
