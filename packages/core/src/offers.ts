// Offers (surveys and tasks), local state and the demo balance.
import { spawn } from "node:child_process"
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { coraDir, readJson, writeJson } from "./config.ts"

export type Question = {
  id: string
  text: string
  /** A fixed list to pick from, or free text when omitted. */
  options?: string[]
}

/** How a surface asks one question. Resolves undefined when the user cancels. */
export type Asker = {
  choice(title: string, options: string[]): Promise<string | undefined>
  text(title: string): Promise<string | undefined>
}

export type Offer = {
  id: string
  label: "Survey" | "Task"
  title: string
  minutes: number
  credits: number
  /** Where an offer without questions opens in the browser. */
  url: string
  /** Offers with questions are answered in place, inside the tool. */
  questions?: Question[]
  demo?: boolean
}

export type State = {
  /** Demo credits; has no value and is not spent in v1. */
  balance: number
  /** Offers hidden until the user turns them back on. */
  offersOff: boolean
  /** Epoch ms until which offers are snoozed. */
  snoozeUntil: number
  /** Offer ids already opened (and credited, for demo offers). */
  opened: string[]
}

export const SNOOZE_MS = 60 * 60 * 1000

const DEMO_URL = "https://github.com/mkdsrt10/cora-cli#demo-offers"
const FREQUENCY = ["Daily", "A few times a week", "Rarely", "Never"]
export const DEMO_OFFERS: Offer[] = [
  {
    id: "demo-tools", label: "Survey", title: "Which coding tools do you use?", minutes: 1, credits: 300, url: DEMO_URL, demo: true,
    questions: [
      { id: "primary", text: "Which coding agent do you use most?", options: ["opencode", "Codex", "Pi", "Claude Code", "Another one"] },
      { id: "frequency", text: "How often do you use it?", options: FREQUENCY },
      { id: "missing", text: "What is the one thing it is missing? (free text)" },
    ],
  },
  {
    id: "demo-models", label: "Survey", title: "How do you choose a model?", minutes: 1, credits: 200, url: DEMO_URL, demo: true,
    questions: [
      { id: "priority", text: "What matters most when you pick a model?", options: ["Quality", "Speed", "Price", "Privacy"] },
      { id: "local", text: "How often do you run models locally?", options: FREQUENCY },
    ],
  },
  {
    id: "demo-review", label: "Task", title: "Tell us how you review AI-written code", minutes: 1, credits: 450, url: DEMO_URL, demo: true,
    questions: [
      { id: "review", text: "How do you review code an agent wrote?", options: ["Read every line", "Skim the diff", "Run the tests only", "Trust it"] },
      { id: "worst", text: "What was the worst mistake an agent made in your code? (free text)" },
    ],
  },
]

export function stateFile(): string {
  return join(coraDir(), "state.json")
}

export function loadState(): State {
  const saved = readJson<Partial<State>>(stateFile(), {})
  return {
    balance: Number(saved.balance) || 0,
    offersOff: Boolean(saved.offersOff),
    snoozeUntil: Number(saved.snoozeUntil) || 0,
    opened: Array.isArray(saved.opened) ? saved.opened.map(String) : [],
  }
}

export function saveState(state: State): void {
  writeJson(stateFile(), state)
}

/** Built-in demo offers unless ~/.cora/offers.json supplies a list. */
export function loadOffers(): Offer[] {
  const custom = readJson<Offer[] | null>(join(coraDir(), "offers.json"), null)
  return Array.isArray(custom) && custom.length > 0 ? custom : DEMO_OFFERS
}

export function answersFile(): string {
  return join(coraDir(), "answers.jsonl")
}

/**
 * Asks the current offer's questions through the surface's own prompts and
 * submits the answers. Cancelling any question saves nothing and grants nothing.
 * v1 has no Cora server: "submit" appends to a local file.
 */
export async function takeSurvey(asker: Asker): Promise<CommandResult> {
  const state = loadState()
  const offer = currentOffer(state, loadOffers())
  if (!offer) return { message: "No offer right now.", state }
  const questions = offer.questions ?? []
  if (questions.length === 0) return runOfferCommand("open")

  const answers: Record<string, string> = {}
  for (const [index, question] of questions.entries()) {
    const title = `${offer.label} ${index + 1}/${questions.length} · ${question.text}`
    const answer = question.options ? await asker.choice(title, question.options) : await asker.text(title)
    if (answer === undefined) return { message: "Closed. Nothing was saved.", state }
    answers[question.id] = answer
  }

  mkdirSync(coraDir(), { recursive: true })
  appendFileSync(answersFile(), JSON.stringify({ ts: new Date().toISOString(), offer: offer.id, answers }) + "\n", { mode: 0o600 })
  // Re-read state: another tool may have changed it while the user answered.
  const next = markOpened(loadState(), offer)
  saveState(next)
  const credit = offer.demo ? `+${offer.credits} demo credits` : `+${offer.credits} cr`
  return { message: `Submitted. ${credit}. Balance: ${next.balance.toLocaleString("en-US")}.`, state: next }
}

/** Every `/cora <sub>` and `cora earn <sub>` goes through here. */
export async function handleCommand(sub: string, asker: Asker): Promise<CommandResult> {
  const word = sub.trim().split(/\s+/)[0] || "status"
  if (word === "take" || word === "open") return takeSurvey(asker)
  return runOfferCommand(word)
}

/** The one offer to show now, or undefined when off, snoozed or all opened. */
export function currentOffer(state: State, offers: Offer[], now = Date.now()): Offer | undefined {
  if (state.offersOff || now < state.snoozeUntil) return undefined
  return offers.find((offer) => !state.opened.includes(offer.id))
}

/** Marks an offer opened. Demo offers credit the local balance once. */
export function markOpened(state: State, offer: Offer): State {
  if (state.opened.includes(offer.id)) return state
  return {
    ...state,
    opened: [...state.opened, offer.id],
    balance: state.balance + (offer.demo ? offer.credits : 0),
  }
}

export function snooze(state: State, now = Date.now()): State {
  return { ...state, snoozeUntil: now + SNOOZE_MS }
}

export function setOffersOff(state: State, off: boolean): State {
  return { ...state, offersOff: off, snoozeUntil: off ? state.snoozeUntil : 0 }
}

export function openInBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open"
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url]
  spawn(command, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref()
}

export type CommandResult = { message: string; state: State }

/** The commands that need no questions asked. */
export function runOfferCommand(sub: string, open: (url: string) => void = openInBrowser): CommandResult {
  const state = loadState()
  const offers = loadOffers()
  const offer = currentOffer(state, offers)
  const finish = (next: State, message: string): CommandResult => {
    saveState(next)
    return { message, state: next }
  }
  switch (sub.trim().split(/\s+/)[0] || "status") {
    case "open": {
      if (!offer) return { message: "No offer right now.", state }
      open(offer.url)
      const next = markOpened(state, offer)
      const credit = offer.demo ? ` +${offer.credits} demo credits.` : ""
      return finish(next, `Opened in your browser: ${offer.title}.${credit}`)
    }
    case "snooze":
      return finish(snooze(state), "Offers snoozed for 1 hour.")
    case "off":
      return finish(setOffersOff(state, true), "Offers hidden. Turn them back on with: cora on")
    case "on":
      return finish(setOffersOff(state, false), "Offers on.")
    default:
      return { message: describe(state, offer), state }
  }
}

export function offerText(offer: Offer): string {
  return `${offer.label} · ~${offer.minutes} min · +${offer.credits} cr`
}

export function describe(state: State, offer: Offer | undefined): string {
  const balance = `${state.balance.toLocaleString("en-US")} demo credits`
  if (state.offersOff) return `${balance}. Offers are hidden.`
  if (!offer) return `${balance}. No offer right now.`
  return `${balance}. ${offerText(offer)}: ${offer.title}`
}
