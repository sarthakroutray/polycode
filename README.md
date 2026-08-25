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
| `Ctrl+E` | Toggle the config editor (edit agents, tiers, swarms, copilot) |
| `Ctrl+M` | Toggle the mode picker (digits or arrows to select) |
| `Ctrl+K` | Kill all running agents (stay in app) |
| `Ctrl+L` | Clear all logs |
| `Ctrl+C` | Kill all agents and quit |

### Config editor (`Ctrl+E`)

Every field in `polycode.config.json` is editable live from the TUI. The editor
is organized into sections:

- **General** — `defaultMode`, copilot enabled/agent/timeout/systemPrompt
- **Agents** — each agent's `name`, `costBadge`, `description`, `cmdTemplate`
  (which embeds the model, e.g. `codex -m deepseek-v4-flash -p "{prompt}"`)
- **Tiers** — routing tiers with `id`, `name`, `color`, `agentKey`, `maxWords`,
  `keywords`
- **Swarms** — swarm `name`, sequential stages (`agentKey`, `cmd`), parallel
  subagents (`agentKey`, `taskTemplate`)

Navigate with `↑`/`↓` (or `j`/`k`), press `Enter` to edit a field inline or
toggle a boolean, `Tab` to page down. `a` adds new entries, `d` deletes the
selected entry (blocked if the agent is still referenced by tiers/swarms).
`Ctrl+S` writes the config to disk and applies it immediately. `Esc` closes the
editor (unsaved changes are discarded).

## configuration

Everything behavioral lives in `polycode.config.json` (zero hardcoding). A
generated default is written by `init` and also tracked at
[`docs/polycode.config.example.json`](docs/polycode.config.example.json).

Key shape:

- **`promptEngineer`** — the copilot: `enabled`, `agentKey`, `systemPrompt`,
  `timeoutMs`. When enabled, every submission goes through the copilot first
  (one optimization feeds all stages/subagents).
- **`agents`** — map of `<agentKey>` → `{ name, costBadge, description,
  cmdTemplate, tags }`. `cmdTemplate` contains `{prompt}` (and optionally `{system}`)
  placeholders which are substituted. Multi-line prompts are flattened and
  escaped so they survive a single-line `shell: true` command. `tags` is an
  array of capability keywords used by smart dispatch.
- **`tiers`** — ordered low→high for routing. Each has `keywords`, optional
  `maxWords`, a `color`, and `agentKey`. Higher scores win; ties go to the
  later (stronger) tier; no keyword match falls back to the middle tier.
- **`swarms`** — named pipelines. `sequential` (`stages`) or `parallel`
  (`subagents`).

### Example agent definition

```json
{
  "workhorse-flash": {
    "name": "workhorse-flash",
    "costBadge": "WORK",
    "description": "Fast execution — agy.exe 3.7 Flash.",
    "cmdTemplate": "agy.exe -p \"{prompt}\" -m 3.7-flash",
    "tags": ["fast", "quick", "simple", "fix", "typo"]
  }
}
```

### Smart dispatch (`smart-auto` mode)

When using `smart-auto` mode, the orchestrator scores **every agent** against
the prompt using their `tags` and `description` keywords. It then decides:

- **Single agent** — if one agent clearly dominates (score > 2x second place)
- **Parallel agents** — if multiple agents score similarly (within 60% of top),
  up to 4 agents are spawned concurrently

This lets you define multiple workhorse agents with different strengths (fast
vs deep-reasoning vs heavy-refactoring) and the orchestrator automatically picks
the best one — or combines them when the task spans multiple domains.

Example: "refactor the complex algorithm and debug the reasoning logic" would
spawn both the `workhorse-ox` (tags: refactor, complex) and `workhorse-deepseek`
(tags: reasoning, debug, algorithm) in parallel.

## Behavior notes

- Agent output is capped in a 2000-line ring buffer; the UI re-renders off a
  single `change` event.
- Failures are instance statuses + exit codes, never thrown — a swarm member
  failing (or the copilot timeout/erroring) falls back gracefully.
- No orphan processes: agents are tree-killed via `taskkill /T /F` on Windows
  (SIGTERM→SIGKILL on POSIX), with signal and exit backstops for teardown.

## License

MIT