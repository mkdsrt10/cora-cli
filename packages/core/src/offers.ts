// Offers (surveys and tasks), local state and the demo balance.
import { spawn } from "node:child_process"
import { join } from "node:path"
import { coraDir, readJson, writeJson } from "./config.ts"

export type Offer = {
  id: string
  label: "Survey" | "Task"
  title: string
  minutes: number
  credits: number
  url: string
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
export const DEMO_OFFERS: Offer[] = [
  { id: "demo-tools", label: "Survey", title: "Which coding tools do you use each week?", minutes: 4, credits: 300, url: DEMO_URL, demo: true },
  { id: "demo-models", label: "Survey", title: "How do you choose a model for a task?", minutes: 3, credits: 200, url: DEMO_URL, demo: true },
  { id: "demo-review", label: "Task", title: "Rate three AI-written code reviews", minutes: 6, credits: 450, url: DEMO_URL, demo: true },
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

/** Shared behaviour behind `/cora <sub>` in every tool and `cora earn <sub>`. */
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
