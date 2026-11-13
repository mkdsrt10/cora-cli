// `cora login`: opens the browser and receives the result on a localhost
// port, the way Claude Code and Codex sign in. `--paste` reads a code instead.
import { randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { createInterface } from "node:readline/promises"
import { exchangeCode, openInBrowser, saveLogin, saveState, loadState, type Summary } from "../../core/src/index.ts"

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>Cora</title>
<body style="font:16px system-ui;max-width:28rem;margin:12vh auto;padding:0 1rem">
<h1 style="font-size:1.4rem">You're signed in to Cora</h1><p>You can close this tab and go back to your terminal.</p>`

/** Waits for the browser to come back to http://127.0.0.1:<port>/callback with our state. */
export function waitForCallback(state: string, timeoutMs = 5 * 60_000): Promise<{ port: number; code: Promise<string> }> {
  return new Promise((ready) => {
    let settle: (code: string) => void
    let fail: (error: Error) => void
    const code = new Promise<string>((resolve, reject) => { settle = resolve; fail = reject })
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1")
      const returned = url.searchParams.get("code")
      // Only a callback carrying the state we generated is accepted.
      if (url.pathname !== "/callback" || url.searchParams.get("state") !== state || !returned) {
        res.writeHead(400, { "content-type": "text/plain" })
        return void res.end("This is not the sign-in Cora is waiting for.")
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(DONE_PAGE)
      clearTimeout(timer)
      server.close()
      settle(returned)
    })
    const timer = setTimeout(() => { server.close(); fail(new Error("Sign-in timed out. Run cora login again.")) }, timeoutMs)
    timer.unref()
    server.listen(0, "127.0.0.1", () => ready({ port: (server.address() as { port: number }).port, code }))
  })
}

export async function finishLogin(apiUrl: string, code: string): Promise<Summary> {
  const result = await exchangeCode(apiUrl, code.trim())
  saveLogin({ apiUrl, key: result.key })
  saveState({ ...loadState(), service: { balanceMicro: result.balanceMicro, offer: result.offer, fetchedAt: Date.now() } })
  return result
}

export async function login(apiUrl: string, paste: boolean, open: (url: string) => void = openInBrowser): Promise<Summary> {
  if (paste) {
    console.log(`Open this page, click "Create account", then paste the code here:\n  ${apiUrl}/login`)
    const prompt = createInterface({ input: process.stdin, output: process.stdout })
    const code = await prompt.question("Code: ")
    prompt.close()
    return finishLogin(apiUrl, code)
  }
  const state = randomBytes(24).toString("base64url")
  const { port, code } = await waitForCallback(state)
  const url = `${apiUrl}/login?port=${port}&state=${state}`
  console.log(`Opening your browser to sign in. If it doesn't open, visit:\n  ${url}\n(On a remote machine, use: cora login --paste)`)
  open(url)
  return finishLogin(apiUrl, await code)
}
