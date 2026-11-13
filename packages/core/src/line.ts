// The view every surface renders, and its one-line form.
import { loadConfig } from "./config.ts"
import { currentOffer, loadOffers, loadState, offerText, type Offer, type State } from "./offers.ts"
import { coraDollars, type ServiceOffer } from "./service.ts"

export type View = {
  balance: number
  offer?: Offer
  offersOff: boolean
  working: boolean
  /** Present after `cora login`: the balance and survey come from the Cora service. */
  service?: { balanceMicro?: number; offer?: ServiceOffer }
}

export function buildView(working = false, state: State = loadState(), offers: Offer[] = loadOffers()): View {
  if (loadConfig().service) {
    const hidden = state.offersOff || Date.now() < state.snoozeUntil
    const offer = hidden ? undefined : (state.service?.offer ?? undefined)
    return { balance: 0, offersOff: state.offersOff, working, service: { balanceMicro: state.service?.balanceMicro, offer } }
  }
  return { balance: state.balance, offer: currentOffer(state, offers), offersOff: state.offersOff, working }
}

export function hasOffer(view: View): boolean {
  return Boolean(view.service ? view.service.offer : view.offer)
}

export function balanceText(view: View): string {
  if (view.service) return view.service.balanceMicro === undefined ? "C$…" : coraDollars(view.service.balanceMicro, 3)
  return `${view.balance.toLocaleString("en-US")} cr (demo)`
}

function shortBalance(view: View): string {
  return view.service ? balanceText(view) : `${view.balance.toLocaleString("en-US")}cr`
}

/** The offer in full and in compact form, for whichever mode is active. */
function offerLines(view: View): { full: string; compact: string; title: string; inPlace: boolean } | undefined {
  const survey = view.service?.offer
  if (survey) {
    const reward = `+${coraDollars(survey.rewardMicro)}`
    const progress = survey.answered > 0 ? ` · ${survey.answered}/${survey.questions} done` : ""
    return { full: `${survey.label} · ${survey.questions} questions · ${reward}${progress}`, compact: `${survey.label} ${reward}`, title: survey.title, inPlace: true }
  }
  if (!view.offer) return undefined
  return {
    full: offerText(view.offer), compact: `${view.offer.label} +${view.offer.credits} cr`, title: view.offer.title,
    inPlace: Boolean(view.offer.questions?.length),
  }
}

/** One line for status bars. Shrinks for narrow widths; hidden below 12 columns. */
export function renderLine(view: View, width = 80): string {
  if (width < 12) return ""
  const icon = view.working ? "◆" : "◇"
  const short = `${icon} ${shortBalance(view)}`
  const base = `${icon} cora ${balanceText(view)}`
  if (base.length > width) return short.length <= width ? short : ""
  // Offers show only while idle, so a working agent is never decorated with one.
  const offer = offerLines(view)
  if (!offer || view.working) return base
  const full = `${base} · ${offer.full}`
  if (full.length <= width) return full
  // Narrow status bars drop the detail rather than wrap.
  const compact = `${base} · ${offer.compact}`
  return compact.length <= width ? compact : base
}

/** Lines for a small card (Pi widget, companion pane, opencode sidebar text). */
export function renderCard(view: View): string[] {
  const lines = [`cora · ${balanceText(view)}`]
  if (view.offersOff) return [...lines, "Offers hidden · /cora on"]
  const offer = offerLines(view)
  if (!offer) return [...lines, view.service ? "No survey right now" : "No offer right now"]
  return [...lines, offer.full, offer.title, `${offer.inPlace ? "/cora take" : "/cora open"} · /cora snooze · /cora off`]
}
