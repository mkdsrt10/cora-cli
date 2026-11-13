import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, test } from "node:test"
import {
  buildView, currentOffer, DEMO_OFFERS, envDisabled, loadState, renderLine, runOfferCommand, SNOOZE_MS,
} from "../../core/src/index.ts"

beforeEach(() => {
  process.env.CORA_HOME = mkdtempSync(join(tmpdir(), "cora-core-"))
})

test("a fresh install shows the first demo offer and a zero demo balance", () => {
  const view = buildView()
  assert.equal(view.offer?.id, DEMO_OFFERS[0].id)
  assert.equal(view.balance, 0)
})

test("opening a demo offer credits it once and moves to the next offer", () => {
  const opened: string[] = []
  runOfferCommand("open", (url) => opened.push(url))
  assert.equal(loadState().balance, DEMO_OFFERS[0].credits)
  assert.equal(opened.length, 1)
  assert.equal(buildView().offer?.id, DEMO_OFFERS[1].id)
})

test("when every offer is opened there is nothing to open or credit", () => {
  for (const _ of DEMO_OFFERS) runOfferCommand("open", () => {})
  const total = loadState().balance
  assert.equal(runOfferCommand("open", () => { throw new Error("must not open") }).message, "No offer right now.")
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
