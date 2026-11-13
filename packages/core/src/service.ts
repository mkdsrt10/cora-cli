// The one module that talks to the Cora service's account API. Every request
// is written to the local outbox first; nothing is sent if that write fails.
import { loadConfig, logOutbox, type Service } from "./config.ts"

export const MICRO = 1_000_000

export type ServiceOffer = { id: string; label: string; title: string; questions: number; answered: number; rewardMicro: number }
export type Summary = { balanceMicro: number; offer: ServiceOffer | null }
export type ServiceQuestion = { id: string; text: string; type: "single" | "multi"; choices: Array<{ id: string; label: string }> }
export type NextQuestion = { survey: ServiceOffer; question: ServiceQuestion } | { done: true }
export type AnswerResult = Summary & { completed: boolean; rewardMicro: number }

export class ServiceError extends Error {}

/** Rewards read best as C$0.50; a balance needs a third decimal so small charges are visible. */
export function coraDollars(micro: number, digits = 2): string {
  const sign = micro < 0 ? "-" : ""
  return `${sign}C$${(Math.abs(micro) / MICRO).toFixed(digits)}`
}

async function request<T>(apiUrl: string, method: "GET" | "POST", path: string, key?: string, body?: unknown): Promise<T> {
  const url = `${apiUrl}${path}`
  logOutbox(method, url, body ?? null)
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    throw new ServiceError(`The Cora service at ${apiUrl} could not be reached.`)
  }
  const reply = (await response.json().catch(() => ({}))) as any
  if (!response.ok) throw new ServiceError(reply?.error?.message ?? `The Cora service answered ${response.status}.`)
  return reply as T
}

function service(): Service {
  const current = loadConfig().service
  if (!current) throw new ServiceError("Not logged in. Run: cora login")
  return current
}

export function exchangeCode(apiUrl: string, code: string): Promise<Summary & { key: string }> {
  return request(apiUrl, "POST", "/api/login/exchange", undefined, { code })
}

export function fetchSummary(): Promise<Summary> {
  const { apiUrl, key } = service()
  return request(apiUrl, "GET", "/api/me", key)
}

export function fetchNextQuestion(): Promise<NextQuestion> {
  const { apiUrl, key } = service()
  return request(apiUrl, "GET", "/api/surveys/next", key)
}

/** Sends the survey id, the question id and the chosen option ids. Nothing else. */
export function submitAnswer(surveyId: string, questionId: string, choiceIds: string[]): Promise<AnswerResult> {
  const { apiUrl, key } = service()
  return request(apiUrl, "POST", "/api/surveys/answer", key, { surveyId, questionId, choiceIds })
}

export function revokeKey(): Promise<unknown> {
  const { apiUrl, key } = service()
  return request(apiUrl, "POST", "/api/logout", key)
}
