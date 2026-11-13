/** @jsxImportSource @opentui/solid */
// opencode TUI part: one offer card in the sidebar, one status line in the
// prompt footer, and the /cora command. Never a popup, never in the transcript.
import { Plugin } from "@opencode/plugin/tui"
import { createSignal, For } from "solid-js"
import { buildView, envDisabled, handleCommand, renderCard, renderLine, type Asker } from "../core/src/index.ts"

const STARTED = ["session.execution.started"] as const
const ENDED = ["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"] as const

export default Plugin.define({
  id: "cora.tui",
  setup(context) {
    if (envDisabled()) return

    const [working, setWorking] = createSignal(false)
    const [view, setView] = createSignal(buildView(false))
    const refresh = () => setView(buildView(working()))

    const stops = [
      ...STARTED.map((type) => context.data.on(type, () => { setWorking(true); refresh() })),
      ...ENDED.map((type) => context.data.on(type, () => { setWorking(false); refresh() })),
    ]
    // Picks up changes made by `cora` in another terminal, and expired snoozes.
    const timer = setInterval(refresh, 15_000)

    // Questions use opencode's own dialogs, and only after the user runs /cora take.
    const asker: Asker = {
      choice: (title, options) =>
        context.ui.dialog.select({ title, options: options.map((option) => ({ title: option, value: option })) }),
      text: (title) => context.ui.dialog.prompt({ title, placeholder: "Type your answer" }),
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "cora.command",
          title: "Cora: offers and balance",
          group: "Cora",
          palette: true,
          slash: { name: "cora", arguments: true },
          run: async (input?: string) => {
            const result = await handleCommand(input ?? "status", asker)
            refresh()
            context.ui.toast.show({ title: "Cora", message: result.message })
          },
        },
      ],
    }))

    context.ui.slot({
      append: "sidebar.content",
      render: () => (
        <box flexDirection="column" marginTop={1}>
          <For each={renderCard(view())}>{(line) => <text fg={context.theme.text.base}>{line}</text>}</For>
        </box>
      ),
    })
    context.ui.slot({
      append: "prompt.footer.status",
      render: () => <text fg={context.theme.text.base}>{renderLine(view(), 38)}</text>,
    })

    return () => {
      clearInterval(timer)
      stops.forEach((stop) => stop())
    }
  },
})
