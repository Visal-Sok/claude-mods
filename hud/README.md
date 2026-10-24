# hud

A one-line hud under the Claude Code prompt, in the spot the status line used to be:

```
[~/dotfiles: main*] │ Ctx ▰▱▱▱▱ 21% │ 5H ▰▰▰▱▱ 64% ↻ 2h13m │ Weekly ▰▱▱▱▱ 12% ↻ 3d4h │ Agents 2      󰃀 Opus 5.5 1M
```

| Part | What |
|---|---|
| `[dir: branch*]` | working directory (`~` for home), git branch, `*` when the tree has changes |
| `Ctx` | context window used |
| `5H`, `Weekly` | usage limits, green → yellow at 50% → red at 80%, with the time until each resets |
| `Agents` | subagents running now (yellow when any are) |
| model | the session's model, shortened (`Opus 5.5 1M`) |
| `󰃀` | toggles the [later](../later) pane; shown only when the `later` plugin is installed |

It refreshes every 5 seconds and after every turn. Colours are Tokyo Night; the `󰃀` and meter glyphs
need a [Nerd Font](https://www.nerdfonts.com) in your terminal.

## Install

```
/plugin marketplace add Visal-Sok/claude-mods
/plugin install hud@claude-mods
```

Optional, for the `󰃀` button: `/plugin install later@claude-mods`.

## License

MIT
