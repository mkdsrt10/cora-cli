import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, lstatSync, readlinkSync, writeFileSync, appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { HOSTS, findHost, type HostContext } from "../src/hosts.ts"

/** A snapshot of every path under dir: files by content, links by target. */
function snapshot(dir: string, base = dir): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name)
    const key = path.slice(base.length + 1)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) out[key] = `link:${readlinkSync(path)}`
    else if (stat.isDirectory()) Object.assign(out, { [key + "/"]: "dir" }, snapshot(path, base))
    else out[key] = readFileSync(path, "utf8")
  }
  return out
}

function fakeHome(): HostContext {
  const home = mkdtempSync(join(tmpdir(), "cora-home-"))
  const coraDir = mkdtempSync(join(tmpdir(), "cora-state-"))
  mkdirSync(join(home, ".config", "opencode"), { recursive: true })
  writeFileSync(join(home, ".config", "opencode", "opencode.json"), '{"mcp":{}}\n')
  mkdirSync(join(home, ".pi"))
  mkdirSync(join(home, ".codex"))
  writeFileSync(join(home, ".codex", "config.toml"), 'model = "gpt"\n')
  mkdirSync(join(home, ".codewhale"))
  writeFileSync(join(home, ".codewhale", "config.toml"), 'provider = "deepseek"') // no trailing newline
  return {
    home, coraDir,
    config: { baseUrl: "http://localhost:1234/v1" },
    models: [{ id: "qwen-test", name: "Cora · qwen-test", contextWindow: 32768, maxOutput: 8192 }],
  }
}

for (const host of HOSTS) {
  test(`${host.id}: on then off restores the home directory exactly`, () => {
    const ctx = fakeHome()
    const before = snapshot(ctx.home)
    host.on(ctx)
    assert.equal(host.isOn(ctx), true)
    assert.notDeepEqual(snapshot(ctx.home), before)
    host.off(ctx)
    assert.equal(host.isOn(ctx), false)
    assert.deepEqual(snapshot(ctx.home), before)
  })

  test(`${host.id}: on twice equals on once`, () => {
    const ctx = fakeHome()
    host.on(ctx)
    const once = snapshot(ctx.home)
    host.on(ctx)
    assert.deepEqual(snapshot(ctx.home), once)
  })

  test(`${host.id}: existing files are never edited in place, except the marked codewhale block`, () => {
    const ctx = fakeHome()
    const before = snapshot(ctx.home)
    host.on(ctx)
    const after = snapshot(ctx.home)
    for (const [path, content] of Object.entries(before)) {
      if (host.id === "codewhale" && path === ".codewhale/config.toml") assert.ok(after[path].startsWith(content))
      else assert.equal(after[path], content, path)
    }
  })
}

test("codewhale: off keeps edits the user made after on", () => {
  const ctx = fakeHome()
  const host = findHost("codewhale")!
  host.on(ctx)
  appendFileSync(join(ctx.home, ".codewhale", "config.toml"), "\n[tui]\ntheme = \"dark\"\n")
  host.off(ctx)
  const text = readFileSync(join(ctx.home, ".codewhale", "config.toml"), "utf8")
  assert.ok(!text.includes("cora"))
  assert.ok(text.includes('provider = "deepseek"') && text.includes('theme = "dark"'))
})

test("codewhale: a config file Cora created is removed again", () => {
  const ctx = fakeHome()
  const host = findHost("codewhale")!
  const file = join(ctx.home, ".codewhale", "config.toml")
  writeFileSync(file, "")
  const before = snapshot(ctx.home)
  host.on(ctx)
  host.off(ctx)
  assert.deepEqual(snapshot(ctx.home), before)
})

test("codex: the profile never contains the API key and leaves config.toml alone", () => {
  const ctx = { ...fakeHome(), config: { baseUrl: "http://x/v1", apiKey: "secret-123" } }
  findHost("codex")!.on(ctx)
  const profile = readFileSync(join(ctx.home, ".codex", "cora.config.toml"), "utf8")
  assert.ok(!profile.includes("secret-123"))
  assert.ok(profile.includes('env_key = "CORA_API_KEY"'))
  assert.equal(readFileSync(join(ctx.home, ".codex", "config.toml"), "utf8"), 'model = "gpt"\n')
})

test("codex: refuses to overwrite a profile it does not own", () => {
  const ctx = fakeHome()
  writeFileSync(join(ctx.home, ".codex", "cora.config.toml"), 'model = "mine"\n')
  assert.throws(() => findHost("codex")!.on(ctx), /not Cora's file/)
})
