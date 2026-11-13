// Pi extension: registers the Cora provider, shows one offer in a widget
// below the editor and a status line in the footer, and adds /cora.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import {
  buildView, discoverModels, envDisabled, handleCommand, loadConfig, PLACEHOLDER_KEY, PROVIDER_ID, PROVIDER_NAME, renderCard,
  renderLine,
} from "../core/src/index.ts"

export default async function (pi: ExtensionAPI) {
  if (envDisabled()) return

  const config = loadConfig()
  const models = await discoverModels(config)
  if (models.length > 0) {
    pi.registerProvider(PROVIDER_ID, {
      name: PROVIDER_NAME,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey ?? PLACEHOLDER_KEY,
      api: "openai-completions",
      models: models.map((model) => ({
        type: "chat",
        id: model.id,
        name: model.name,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: model.contextWindow,
        maxTokens: model.maxOutput,
      })),
    })
  }

  let working = false
  const draw = (ctx: any) => {
    if (!ctx?.hasUI) return
    const view = buildView(working)
    ctx.ui.setStatus("cora", renderLine(view, 60))
    // The widget is the offer only; with no offer it disappears.
    const card = view.offer && !view.offersOff ? renderCard(view).slice(1) : undefined
    ctx.ui.setWidget("cora", card, { placement: "belowEditor" })
  }

  pi.on("session_start", async (_event, ctx) => draw(ctx))
  pi.on("agent_start", async (_event, ctx) => { working = true; draw(ctx) })
  pi.on("agent_settled", async (_event, ctx) => { working = false; draw(ctx) })

  pi.registerCommand("cora", {
    description: "Cora offers and balance: take | snooze | off | on | status",
    handler: async (args, ctx) => {
      const result = await handleCommand(args ?? "status", {
        choice: (title, options) => ctx.ui.select(title, options),
        text: (title) => ctx.ui.input(title, "Type your answer"),
      })
      draw(ctx)
      ctx.ui.notify(result.message, "info")
    },
  })
}
