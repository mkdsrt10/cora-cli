// Config, paths and model discovery. No dependencies; runs on Node, Bun and jiti.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const PROVIDER_ID = "cora"
export const PROVIDER_NAME = "Cora"
export const DEFAULT_BASE_URL = "http://localhost:1234/v1"
/** Sent when the endpoint needs no key; local servers ignore it. */
export const PLACEHOLDER_KEY = "cora-local"

export const DEFAULT_API_URL = "http://localhost:8790"

/** Set after `cora login`: models, balance and surveys come from the Cora service. */
export type Service = { apiUrl: string; key: string }
export type Config = { baseUrl: string; apiKey?: string; service?: Service }
type SavedConfig = { baseUrl?: string; apiKey?: string; apiUrl?: string; key?: string }
export type ModelDef = { id: string; name: string; contextWindow: number; maxOutput: number }

export function coraDir(): string {
  return process.env.CORA_HOME || join(homedir(), ".cora")
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T
  } catch {
    return fallback
  }
}

export function writeJson(file: string, value: unknown): void {
  mkdirSync(join(file, ".."), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 })
}

export function configFile(): string {
  return join(coraDir(), "config.json")
}

export function loadConfig(): Config {
  const saved = readJson<SavedConfig>(configFile(), {})
  if (saved.apiUrl && saved.key) {
    const apiUrl = saved.apiUrl.replace(/\/+$/, "")
    return { baseUrl: `${apiUrl}/v1`, apiKey: saved.key, service: { apiUrl, key: saved.key } }
  }
  const baseUrl = (process.env.CORA_BASE_URL || saved.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "")
  const apiKey = process.env.CORA_API_KEY || saved.apiKey || undefined
  return { baseUrl, apiKey }
}

/** Saves the local endpoint; a login, if any, is kept. */
export function saveConfig(config: Pick<Config, "baseUrl" | "apiKey">): void {
  const saved = readJson<SavedConfig>(configFile(), {})
  writeJson(configFile(), { ...saved, baseUrl: config.baseUrl, apiKey: config.apiKey })
}

export function saveLogin(service: Service | undefined): void {
  const { apiUrl: _apiUrl, key: _key, ...local } = readJson<SavedConfig>(configFile(), {})
  writeJson(configFile(), service ? { ...local, apiUrl: service.apiUrl, key: service.key } : local)
}

export function isConfigured(): boolean {
  return existsSync(configFile()) || Boolean(process.env.CORA_BASE_URL)
}

export function outboxFile(): string {
  return join(coraDir(), "outbox.jsonl")
}

/**
 * Records a request to the Cora service before it is sent. If this throws,
 * the caller must not send. The key is a header and is never written here.
 */
export function logOutbox(method: string, url: string, body: unknown): void {
  mkdirSync(coraDir(), { recursive: true })
  const file = outboxFile()
  // Keep the log bounded: start over once it passes 2 MB.
  if (existsSync(file) && statSync(file).size > 2 * 1024 * 1024) writeFileSync(file, "", { mode: 0o600 })
  appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), method, url, body }) + "\n", { mode: 0o600 })
}

/** Cora does nothing in CI or when switched off by environment. */
export function envDisabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.CORA_DISABLE === "1" || Boolean(env.CI)
}

export function displayName(modelId: string): string {
  return `${PROVIDER_NAME} · ${modelId}`
}

/**
 * The only network request Cora's own code makes: read the model list from
 * the configured endpoint. Returns [] when the endpoint is unreachable.
 */
export async function discoverModels(config: Config, timeoutMs = 2500): Promise<ModelDef[]> {
  try {
    if (config.service) logOutbox("GET", `${config.baseUrl}/models`, null)
    const response = await fetch(`${config.baseUrl}/models`, {
      headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return []
    const body = (await response.json()) as { data?: Array<Record<string, unknown>> }
    return (body.data ?? [])
      .map((entry) => String(entry.id ?? ""))
      .filter((id) => id && !/embed/i.test(id))
      .map((id) => ({ id, name: displayName(id), contextWindow: 32768, maxOutput: 8192 }))
  } catch {
    return []
  }
}
