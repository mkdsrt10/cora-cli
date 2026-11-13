// The view every surface renders, and its one-line form.
import { currentOffer, loadOffers, loadState, offerText, type Offer, type State } from "./offers.ts"

export type View = { balance: number; offer?: Offer; offersOff: boolean; working: boolean }

export function buildView(working = false, state: State = loadState(), offers: Offer[] = loadOffers()): View {
  return { balance: state.balance, offer: currentOffer(state, offers), offersOff: state.offersOff, working }
}

export function balanceText(view: View): string {
  return `${view.balance.toLocaleString("en-US")} cr (demo)`
}

/** One line for status bars. Shrinks for narrow widths; hidden below 12 columns. */
export function renderLine(view: View, width = 80): string {
  if (width < 12) return ""
  const icon = view.working ? "◆" : "◇"
  const short = `${icon} ${view.balance.toLocaleString("en-US")}cr`
  if (width < 40) return short.length <= width ? short : ""
  const base = `${icon} cora ${balanceText(view)}`
  // Offers show only while idle, so a working agent is never decorated with one.
  if (!view.offer || view.working) return base
  const full = `${base} · ${offerText(view.offer)}`
  return full.length <= width ? full : base
}

/** Lines for a small card (Pi widget, companion pane, opencode sidebar text). */
export function renderCard(view: View): string[] {
  const lines = [`cora · ${balanceText(view)}`]
  if (view.offersOff) return [...lines, "Offers hidden · /cora on"]
  if (!view.offer) return [...lines, "No offer right now"]
  return [...lines, offerText(view.offer), view.offer.title, "/cora open · /cora snooze · /cora off"]
}
