# claude-mods

[Claude Code](https://claude.com/claude-code) mods, in Tokyo Night colours.

| Mod | What |
|---|---|
| [`hud`](hud) | one-line hud under the prompt: dir, branch, context, 5h/weekly usage limits with reset countdowns, running agents, model |
| [`later`](later) | `/later <task>` stashes a task for the current repo; a side pane starts or drops them. hud's `󰃀` button toggles it |

## Install

```
/plugin marketplace add Visal-Sok/claude-mods
/plugin install hud@claude-mods
/plugin install later@claude-mods
```

The icons need a [Nerd Font](https://www.nerdfonts.com) in your terminal.

## Develop

Add a local clone as the marketplace instead, and edits load as you make them:

```
git clone git@github.com:Visal-Sok/claude-mods.git
claude plugin marketplace add ./claude-mods
claude plugin test claude-mods/hud
```

## License

MIT
