import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, test } from "node:test"
import {
  buildView, configFile, handleCommand, loadConfig, outboxFile, refreshSummary, renderCard, renderLine, saveLogin,
  type Asker,
} from "../../core/src/index.ts"
import { findHost } from "../src/hosts.ts"
import { finishLogin, waitForCallback } from "../src/login.ts"

const KEY = "ck_test_key_do_not_log"
const SURVEY = { id: "s1", label: "Survey", title: "Tools", questions: 2, rewardMicro: 500_000 }
const QUESTIONS = [
  { id: "q1", text: "Pick one", type: "single", choices: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }] },
  { id: "q2", text: "Pick several", type: "multi", choices: [{ id: "x", label: "Ex" }, { id: "y", label: "Why" }, { id: "z", label: "Zed" }] },
]

/** A stand-in Cora service that records what the CLI sends. */
let server: Server
let apiUrl = ""
let seen: Array<{ method: string; path: string; auth?: string; body: any }> = []
let answered = 0
let balance = 1_000_000

beforeEach(async () => {
  process.env.CORA_HOME = mkdtempSync(join(tmpdir(), "cora-service-"))
  seen = []
  answered = 0
  balance = 1_000_000
  const offer = () => (answered < 2 ? { ...SURVEY, answered } : null)
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null
    seen.push({ method: req.method!, path: req.url!, auth: req.headers.authorization, body })
    const send = (status: number, json: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(json)) }
    if (req.url === "/api/login/exchange") return body.code === "good" ? send(200, { key: KEY, balanceMicro: balance, offer: offer() }) : send(400, { error: { message: "That code is wrong, used or expired." } })
    if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { error: { message: "Unknown or revoked Cora key." } })
    if (req.url === "/api/me") return send(200, { balanceMicro: balance, offer: offer() })
    if (req.url === "/api/surveys/next") return send(200, answered < 2 ? { survey: { ...SURVEY, answered }, question: QUESTIONS[answered] } : { done: true })
    if (req.url === "/api/surveys/answer") {
      answered += 1
      const completed = answered === 2
      if (completed) balance += SURVEY.rewardMicro
      return send(200, { completed, rewardMicro: completed ? SURVEY.rewardMicro : 0, balanceMicro: balance, offer: offer() })
    }
    send(404, {})
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  apiUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterEach(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }))

/** Answers by picking the given labels in order. */
function scripted(picks: Array<string | undefined>): Asker {
  return {
    choice: async (_title, options) => {
      const pick = picks.shift()
      return pick === undefined ? undefined : options.find((option) => option.endsWith(pick))
    },
    text: async () => undefined,
  }
}

test("the login callback accepts only the state the CLI generated", async () => {
  const { port, code } = await waitForCallback("expected-state-123", 5000)
  const wrong = await fetch(`http://127.0.0.1:${port}/callback?code=evil&state=other-state`)
  assert.equal(wrong.status, 400)
  const right = await fetch(`http://127.0.0.1:${port}/callback?code=good&state=expected-state-123`)
  assert.equal(right.status, 200)
  assert.equal(await code, "good")
})

test("after login the key is saved for the owner only and models come from the service", async () => {
  await finishLogin(apiUrl, "good")
  const config = loadConfig()
  assert.deepEqual(config.service, { apiUrl, key: KEY })
  assert.equal(config.baseUrl, `${apiUrl}/v1`)
  assert.equal(config.apiKey, KEY)
  assert.equal(statSync(configFile()).mode & 0o777, 0o600)
  assert.ok(renderLine(buildView(), 80).includes("C$1.000"))
})

test("a wrong code leaves the CLI logged out", async () => {
  await assert.rejects(finishLogin(apiUrl, "bad"), /wrong, used or expired/)
  assert.equal(loadConfig().service, undefined)
})

test("every request is in the outbox, byte for byte, and the key never is", async () => {
  await finishLogin(apiUrl, "good")
  await handleCommand("take", scripted(["Beta", "Ex", "Zed", "Done", undefined]))
  const logged = readFileSync(outboxFile(), "utf8").trim().split("\n").map((line) => JSON.parse(line))
  assert.deepEqual(logged.map((entry) => [entry.method, entry.url.replace(apiUrl, ""), entry.body]), seen.map((call) => [call.method, call.path, call.body]))
  assert.ok(!readFileSync(outboxFile(), "utf8").includes(KEY))
})

test("a survey is answered in place: single choice, then toggled multiple choice, then the reward arrives", async () => {
  await finishLogin(apiUrl, "good")
  assert.ok(renderCard(buildView()).some((line) => line.includes("2 questions · +C$0.50")))
  const result = await handleCommand("take", scripted(["Beta", "Ex", "Zed", "Ex", "Done"])) // Ex toggled on then off
  const answers = seen.filter((call) => call.path === "/api/surveys/answer").map((call) => call.body)
  assert.deepEqual(answers, [
    { surveyId: "s1", questionId: "q1", choiceIds: ["b"] },
    { surveyId: "s1", questionId: "q2", choiceIds: ["z"] },
  ])
  assert.match(result.message, /Submitted\. \+C\$0\.50\. Balance: C\$1\.500/)
  assert.ok(renderCard(buildView()).includes("No survey right now"))
})

test("closing a question keeps earlier answers and sends nothing more", async () => {
  await finishLogin(apiUrl, "good")
  const result = await handleCommand("take", scripted(["Alpha", undefined]))
  assert.match(result.message, /answers so far are saved/)
  assert.equal(seen.filter((call) => call.path === "/api/surveys/answer").length, 1)
  await refreshSummary()
  assert.ok(renderCard(buildView()).some((line) => line.includes("1/2 done")))
})

test("logged in, Codex fetches the key by command and its profile never holds it", () => {
  saveLogin({ apiUrl, key: KEY })
  const home = mkdtempSync(join(tmpdir(), "cora-home-"))
  const ctx = { home, coraDir: process.env.CORA_HOME!, config: loadConfig(), models: [{ id: "m", name: "Cora · m", contextWindow: 1, maxOutput: 1 }] }
  findHost("codex")!.on(ctx)
  const profile = readFileSync(join(home, ".codex", "cora.config.toml"), "utf8")
  assert.ok(profile.includes(`auth = { command = "cora", args = ["key"] }`))
  assert.ok(profile.includes(`base_url = "${apiUrl}/v1"`))
  assert.ok(!profile.includes(KEY))
})

test("logging out returns to the local endpoint", async () => {
  await finishLogin(apiUrl, "good")
  saveLogin(undefined)
  assert.equal(loadConfig().service, undefined)
  assert.ok(renderLine(buildView(), 80).includes("demo"))
})
