// opencode server part: registers the Cora provider in memory.
// No opencode config file is edited, and the default model is not changed.
import { statSync } from "node:fs"
import { Model, Plugin, Provider } from "@opencode/plugin"
import {
  configFile, discoverModels, envDisabled, loadConfig, PLACEHOLDER_KEY, PROVIDER_ID, PROVIDER_NAME,
} from "../core/src/index.ts"

function configStamp(): number {
  try {
    return statSync(configFile()).mtimeMs
  } catch {
    return 0
  }
}

export default Plugin.define({
  id: "cora",
  async setup(ctx) {
    if (envDisabled()) return
    const providerID = Provider.ID.make(PROVIDER_ID)

    /** Reads the endpoint and its models; undefined when nothing is being served. */
    const load = async () => {
      const config = loadConfig()
      const found = await discoverModels(config)
      if (found.length === 0) return undefined
      return {
        info: {
          ...Provider.Info.empty(providerID),
          name: PROVIDER_NAME,
          activation: "enabled" as const,
          package: "@opencode/ai/providers/openai-compatible",
          settings: { baseURL: config.baseUrl, apiKey: config.apiKey ?? PLACEHOLDER_KEY },
        },
        models: found.map((model) => ({ ...Model.Info.default(providerID, Model.ID.make(model.id)), name: model.name })),
      }
    }

    const source = { provider: await load(), stamp: configStamp() }
    await ctx.provider.transform((editor) => {
      if (source.provider) editor.add(source.provider)
    })

    // opencode's server outlives a `cora login` or `cora setup`. When Cora's
    // config file changes, re-read it so the provider follows the new endpoint.
    const timer = setInterval(() => {
      const stamp = configStamp()
      if (stamp === source.stamp) return
      source.stamp = stamp
      void load().then((provider) => {
        source.provider = provider
        return ctx.provider.reload()
      }).catch(() => {})
    }, 5000)
    return () => clearInterval(timer)
  },
})
