// opencode server part: registers the Cora provider in memory.
// No opencode config file is edited, and the default model is not changed.
import { Model, Plugin, Provider } from "@opencode/plugin"
import {
  discoverModels, envDisabled, loadConfig, PLACEHOLDER_KEY, PROVIDER_ID, PROVIDER_NAME,
} from "../core/src/index.ts"

export default Plugin.define({
  id: "cora",
  async setup(ctx) {
    if (envDisabled()) return
    const config = loadConfig()
    const found = await discoverModels(config)
    if (found.length === 0) return

    const providerID = Provider.ID.make(PROVIDER_ID)
    const models = found.map((model) => ({
      ...Model.Info.default(providerID, Model.ID.make(model.id)),
      name: model.name,
    }))
    await ctx.provider.transform((editor) => {
      editor.add({
        info: {
          ...Provider.Info.empty(providerID),
          name: PROVIDER_NAME,
          activation: "enabled",
          package: "@opencode/ai/providers/openai-compatible",
          settings: { baseURL: config.baseUrl, apiKey: config.apiKey ?? PLACEHOLDER_KEY },
        },
        models,
      })
    })
  },
})
