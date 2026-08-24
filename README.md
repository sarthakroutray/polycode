# polycode

A multi-agent parallel orchestrator with an intermediary **Prompt-Engineering
Copilot** over arbitrary terminal coding CLIs. You point it at existing CLI
binaries (`codex`, `cmd`, custom agents) — `polycode` handles the prompt
optimization, routing, orchestration, and a live terminal UI.

## Quick start

```bash
npm install
npm run build            # compiles TypeScript into dist/

# Create a config once
node bin/polycode.js init           # writes ./polycode.config.json

# Launch the interactive TUI
node bin/polycode.js
```

> `init` refuses to overwrite an existing config — add `--force` to replace it.

## Requirements

- Node.js `>=18.17`
- A terminal (CLI/ink), and an interactive shell that is a TTY for the TUI
- The agent CLIs you reference in `polycode.config.json` available on `PATH`

## Build & scripts

| Script | What it does |
|---|---|
| `npm run build` | `tsc` → `dist/` |
| `npm run typecheck` | `tsc --noEmit` only |
| `npm run dev` | run the TUI straight from source with `tsx` |
| `npm start` | build then run |

## CLI

```
polycode [--config <path>] [--no-copilot]          interactive TUI
polycode init [--path <path>] [--force]            write a default config
polycode run "<prompt>" [--mode <mode>] [--config <path>]   headless run
polycode --help | --version
```

- `--config <path>` — explicit config file (defaults to `./polycode.config.json`,
  then `~/.config/polycode/config.json`).
- `--no-copilot` — bypass prompt optimization and dispatch the raw prompt.
- `run` is the headless/CI path: it prints each agent's output as it arrives,
  emits optimization stats/warnings on stderr, and exits `1` if any job fails.

### Modes (`--mode`)

| Mode | Meaning |
|---|---|
| `smart-auto` | Route the prompt through the configured tiers |
| `manual:<agentKey>` | Run one specific agent with the prompt |
| `swarm:<swarmKey>` | Run a configured swarm — stages run in order (sequential) or concurrently (parallel) |

## Interactive TUI

Top-to-bottom: status header → raw/optimized diff → agent grid → live log
terminal → mode bar → prompt input.

| Key | Action |
|---|---|
| `Enter` | Optimize (if enabled) and dispatch the typed prompt |
| `Tab` / `Shift+Tab` | Cycle the selected log tab |
| `Ctrl+M` | Toggle the mode picker (digits or arrows to select) |
| `Ctrl+K` | Kill all running agents (stay in app) |
| `Ctrl+L` | Clear all logs |
| `Ctrl+C` | Kill all agents and quit |

## configuration

Everything behavioral lives in `polycode.config.json` (zero hardcoding). A
generated default is written by `init` and also tracked at
[`docs/polycode.config.example.json`](docs/polycode.config.example.json).

Key shape:

- **`promptEngineer`** — the copilot: `enabled`, `agentKey`, `systemPrompt`,
  `timeoutMs`. When enabled, every submission goes through the copilot first
  (one optimization feeds all stages/subagents).
- **`agents`** — map of `<agentKey>` → `{ name, costBadge, description,
  cmdTemplate }`. `cmdTemplate` contains `{prompt}` (and optionally `{system}`)
  placeholders which are substituted. Multi-line prompts are flattened and
  escaped so they survive a single-line `shell: true` command.
- **`tiers`** — ordered low→high for routing. Each has `keywords`, optional
  `maxWords`, a `color`, and `agentKey`. Higher scores win; ties go to the
  later (stronger) tier; no keyword match falls back to the middle tier.
- **`swarms`** — named pipelines. `sequential` (`stages`) or `parallel`
  (`subagents`).

### Example agent definition

```json
{
  "agentKey": {
    "name": "workhorse",
    "costBadge": "WORK",
    "description": "Executes straightforward requests",
    "cmdTemplate": "codex -p \"{prompt}\""
  }
}
```

## Behavior notes

- Agent output is capped in a 2000-line ring buffer; the UI re-renders off a
  single `change` event.
- Failures are instance statuses + exit codes, never thrown — a swarm member
  failing (or the copilot timeout/erroring) falls back gracefully.
- No orphan processes: agents are tree-killed via `taskkill /T /F` on Windows
  (SIGTERM→SIGKILL on POSIX), with signal and exit backstops for teardown.

## License

MIT