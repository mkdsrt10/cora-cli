import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, test } from "node:test"
import {
  answersFile, buildView, currentOffer, DEMO_OFFERS, envDisabled, handleCommand, loadState, renderLine, runOfferCommand,
  SNOOZE_MS, type Asker,
} from "../../core/src/index.ts"

beforeEach(() => {
  process.env.CORA_HOME = mkdtempSync(join(tmpdir(), "cora-core-"))
})

test("a fresh install shows the first demo offer and a zero demo balance", () => {
  const view = buildView()
  assert.equal(view.offer?.id, DEMO_OFFERS[0].id)
  assert.equal(view.balance, 0)
})

/** Picks the first option and types "x"; cancels at question number cancelAt. */
function scripted(cancelAt = Infinity): Asker & { asked: string[] } {
  const asked: string[] = []
  const answer = (title: string, value: string) => {
    asked.push(title)
    return Promise.resolve(asked.length === cancelAt ? undefined : value)
  }
  return { asked, choice: (title, options) => answer(title, options[0]), text: (title) => answer(title, "x") }
}

test("taking a survey asks every question, saves the answers and credits once", async () => {
  const asker = scripted()
  const result = await handleCommand("take", asker)
  assert.equal(asker.asked.length, DEMO_OFFERS[0].questions!.length)
  assert.match(result.message, /Submitted/)
  assert.equal(loadState().balance, DEMO_OFFERS[0].credits)
  const saved = JSON.parse(readFileSync(answersFile(), "utf8").trim())
  assert.equal(saved.offer, DEMO_OFFERS[0].id)
  assert.deepEqual(Object.keys(saved.answers), DEMO_OFFERS[0].questions!.map((question) => question.id))
  assert.equal(buildView().offer?.id, DEMO_OFFERS[1].id)
})

test("cancelling part way saves nothing, credits nothing and keeps the offer", async () => {
  const result = await handleCommand("take", scripted(2))
  assert.equal(result.message, "Closed. Nothing was saved.")
  assert.equal(loadState().balance, 0)
  assert.equal(existsSync(answersFile()), false)
  assert.equal(buildView().offer?.id, DEMO_OFFERS[0].id)
})

test("when every offer is answered there is nothing to take or credit", async () => {
  for (const _ of DEMO_OFFERS) await handleCommand("take", scripted())
  const total = loadState().balance
  assert.equal(total, DEMO_OFFERS.reduce((sum, offer) => sum + offer.credits, 0))
  const asker = scripted()
  assert.equal((await handleCommand("take", asker)).message, "No offer right now.")
  assert.equal(asker.asked.length, 0)
  assert.equal(loadState().balance, total)
})

test("snooze hides offers for an hour, then they return", () => {
  runOfferCommand("snooze")
  const state = loadState()
  assert.equal(currentOffer(state, DEMO_OFFERS), undefined)
  assert.ok(currentOffer(state, DEMO_OFFERS, Date.now() + SNOOZE_MS + 1))
})

test("off hides offers until on", () => {
  runOfferCommand("off")
  assert.equal(buildView().offer, undefined)
  runOfferCommand("on")
  assert.ok(buildView().offer)
})

test("Cora is disabled in CI and by CORA_DISABLE", () => {
  assert.equal(envDisabled({ CI: "true" }), true)
  assert.equal(envDisabled({ CORA_DISABLE: "1" }), true)
  assert.equal(envDisabled({}), false)
})

test("the status line fits its width and hides the offer while working", () => {
  for (const width of [8, 12, 30, 45, 80]) assert.ok(renderLine(buildView(), width).length <= width)
  assert.equal(renderLine(buildView(), 8), "")
  assert.ok(renderLine(buildView(false), 80).includes("Survey"))
  assert.ok(!renderLine(buildView(true), 80).includes("Survey"))
  assert.ok(renderLine(buildView(), 80).includes("demo"))
})
