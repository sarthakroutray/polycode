# PLAN — `polycode`: Multi-Agent Parallel Orchestrator & Prompt-Engineering Copilot

**Audience:** implementation agent / engineer. This document is the complete, self-contained
specification. Implement exactly this; do not add extra scope. All behavioral detail lives here —
the original master prompt's config snippet is preserved in `docs/polycode.config.example.json`.

---

## 1. Goal

A production-ready `npx` package that acts as an **autonomous multi-agent orchestrator with an
intermediary Prompt-Engineering Copilot** over arbitrary terminal coding CLIs. You do not implement
the codeline AI logic — you orchestrate *existing* CLI binaries (e.g. `codex`, `cmd`,
`antigravity`, or mock `node -e "..."` during tests) by spawning them as child processes.

**Core workflow:** user types a raw instruction → Prompt Optimizer Agent ("copilot") compresses &
structures it → the optimized prompt is dispatched to a "tier-routed" agent, a sequential pipeline
(`Plan → Build → Audit`), or a parallel swarm of 2–3 subagents — with a live Ink (React-terminal)
UI showing agent states, per-agent log tabs, and before/after token metrics.

## 2. Locked decisions (already agreed with user)

| Decision | Value |
|---|---|
| Scaffold location | Repo root (`D:\Projects\polycode`), NOT a subfolder |
| Package name | `polycode`; binaries: `polycode` **and** `polycode` (both → `bin/polycode.js`) |
| Text input | `ink-text-input` dependency (NOT hand-rolled) |
| Repo state | Currently empty except `.git/`. No prior code exists. |

## 3. Verified dependency reality (npm registry, checked 2026-08-25)

**Do not guess versions.** Verified facts:

- `ink-text-input` has **no version 6.1.0**. Latest is **6.0.0**; it peers `ink >=5, react >=18`
  and brings `chalk@^5` + `type-fest@^4`.
- `ink-text-input@5.0.1` peers `ink ^4` — avoid; pin `@^6.0.0`.
- `ink` latest is `7.1.1`, but **`ink@^5.2.0` is the battle-tested line for React 18**; peers
  `react >=18`. Use `ink@^5.2.0` + `react@^18.3.1` + `@types/react@^18`.
- `zod` latest is 4.x, but pin **`zod@^3.23.8`** for a stable, well-known API (`.discriminatedUnion`,
  `.record(keySchema, valueSchema)`, `.default()` work as documented; no v4 migration surprises).
- Environment: Windows (`win32`), PowerShell 7, Node `v24.11.1`, npm `11.10.0`.

Dev deps: `typescript@^5.6`, `@types/node@^22`, `@types/react@^18`, `tsx@^4` (dev runner only).

## 4. Project structure (implement exactly)

```
├── package.json
├── tsconfig.json
├── bin/
│   └── polycode.js
├── docs/
│   └── PLAN.md, polycode.config.example.json   (already present)
└── src/
    ├── types.ts              # Agent, Swarm, Tier, Copilot state interfaces + zod schemas
    ├── config.ts             # Config loader, validation, `polycode init` generator
    ├── prompt-copilot.ts     # Prompt optimizer, token metrics, template substitution
    ├── router.ts             # Tier scoring / intent routing
    ├── agent-manager.ts      # Spawn registry, stream buffers, parallel/sequential runs, tree-kill
    ├── ui/
    │   ├── App.tsx           # Ink root: keyboard shortcuts, orchestration glue
    │   ├── CopilotView.tsx   # Raw vs optimized prompt diff + token metrics
    │   ├── SubagentGrid.tsx  # Status tiles for all instances
    │   ├── AgentTerminal.tsx # Live log stream of selected tab
    │   ├── ModeSelector.tsx  # Smart-auto vs swarm mode picker
    │   ├── StatusHeader.tsx  # Config path, active count, cost badges, savings %
    │   └── shared.ts         # (small addition) status→color maps, helpers
    └── cli.tsx               # Entry: flag parsing, TTY/headless dispatch
```

A tiny `ui/shared.ts` (color maps) is an acceptable addition; everything else must match the
structure above.

## 5. Scaffold files

### package.json
- `name: "polycode"`, `type: "module"`, `license: "MIT"`, `engines.node: ">=18.17"`
- `bin: { "polycode": "bin/polycode.js", "polycode": "bin/polycode.js" }`
- `files: ["bin", "dist"]`
- scripts: `build: "tsc"`, `dev: "tsx src/cli.tsx"`, `start: "npm run build && node bin/polycode.js"`,
  `typecheck: "tsc --noEmit"`

### tsconfig.json
- `target/lib: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `jsx: react-jsx`,
  `strict: true`, `skipLibCheck: true`, `esModuleInterop: true`, `outDir: dist`, `rootDir: src`,
  `resolveJsonModule: true`, `declaration: false`, `sourceMap: true`; include `["src"]`.

> ⚠️ **NodeNext ESM rule:** every relative import in `src/**` MUST use the `.js` extension even
> when the source file is `.ts`/`.tsx` (e.g. `import { App } from './ui/App.js'`). Missing `.js`
> extensions will compile but crash at runtime. Verify `dist/` output imports after build.

### bin/polycode.js
Shebang `#!/usr/bin/env node`; `existsSync` guard on `../dist/cli.js` (friendly error → run
`npm run build`); then `await import('../dist/cli.js')` inside try/catch; on uncaught, print
stack and `process.exit(1)`. No other logic.

## 6. Module specifications

### 6.1 `src/types.ts`
- `AgentStatus` enum-type: `'IDLE' | 'REFINING' | 'SPAWNED' | 'STREAMING' | 'COMPLETED' |
  'FAILED' | 'KILLED'`. Helpers: `isTerminalStatus(s)` (COMPLETED/FAILED/KILLED),
  `isActiveStatus(s)` (SPAWNED/STREAMING/REFINING).
- **Zod schemas** (single source of truth; derive TS types with `z.infer`):
  - `agentDefSchema`: `{ name: string! , costBadge: string = '', description: string = '',
    cmdTemplate: string! }`.
  - `tierSchema`: `{ id!, name!, color = 'white', costBadge = '', agentKey!, maxWords:
    number|null = null, keywords: string[] = [] }`.
  - `swarmStageSchema`: `{ agentKey!, name!, cmd! }`; `swarmSubagentSchema`: `{ id!, agentKey!,
    name!, taskTemplate! }`.
  - `swarmSchema = z.discriminatedUnion('type', [ {name!, type:'sequential', stages: [≥1]},
    {name!, type:'parallel', subagents: [≥1]} ])`.
  - `promptEngineerSchema`: `{ enabled = true, agentKey!, systemPrompt = '', timeoutMs = 30000 }`.
  - `polycodeConfigSchema`: `{ $schema?: string, defaultMode = 'smart-auto', promptEngineer =
    default, agents: Record<string, AgentDef> = {}, tiers: Tier[] = [], swarms:
    Record<string, Swarm> = {} }`.
- Runtime types: `LogLine { stream: 'stdout'|'stderr'|'system'; text: string; timestamp: number }`;
  `AgentInstance { id, name, agentKey, costBadge, status, command, pid:number|null, startedAt,
  endedAt, exitCode: number|null, logs: LogLine[] }`;
  `JobSpec { id, agentKey, name, costBadge, command, refine?: boolean }` (commands arrive fully
  substituted — manager never does templating);
  `CopilotResult { rawPrompt, optimizedPrompt, rawTokens, optimizedTokens, savedPercent,
  fallback: boolean, error?: string, durationMs }`;
  `RouteResult { tier, agentKey, agentName, confidence: 'high'|'low', reasons: string[] }`.

### 6.2 `src/config.ts`
- `resolveConfigPath(explicit?): string | null` — order: `explicit` → `./polycode.config.json` →
  `~/.config/polycode/config.json`; return first that exists, else null.
- `loadpolycodeConfig(explicit?): { config, path } | { error }` — read file, JSON.parse, validate with
  `polycodeConfigSchema.safeParse`; on failure return human-readable error listing every
  `issue.path → issue.message`. Never throw for config problems; throw only for I/O where
  appropriate.
- `generateDefaultConfig()` — returns the **exact config object** mirrored in
  `docs/polycode.config.example.json` (copilot/router/architect/builder/workhorse/auditor agents,
  3 tiers, `full-pipeline` sequential + `parallel-tri-agent` swarms). Keep the two files in sync.
- `initConfig(targetPath?)` — create `./polycode.config.json` (default), refuse to overwrite without
  an explicit force flag; print the written path.

### 6.3 `src/prompt-copilot.ts`
Key exports:
- `estimateTokens(text): number` — heuristic `max(1, ceil(text.length / 4))`. Document that it is
  an approximation; zero extra deps.
- `substitutePlaceholders(template, { prompt, system? }): string` —
  - First-collapse newlines:`prompt.replace(/\s*\n\s*/g, ' ').trim()` (multi-line text breaks
    `cmd.exe`/`sh -c` single-line commands — always flatten).
  - Escape for embedding inside the template's existing quotes: replace `\` → `\\`, `"` → `\"`,
    then substitute for ALL occurrences of `{prompt}` and `{system}`. Do **not** add surrounding
    quotes — templates already carry them (e.g. `-p "{prompt}"`).
  - Also handle `{tokens}`-style future placeholders by leaving unknown braces untouched.
- `optimizePrompt(raw, config, hooks?): Promise<CopilotResult>`
  - If `!config.promptEngineer.enabled` or the `agentKey` is missing from `config.agents` →
    return immediately with `fallback: true` and `optimizedPrompt = raw`.
  - Render copilot command: substitute `{prompt}` = raw and `{system}` = `systemPrompt` into the
    engineer agent's `cmdTemplate`.
  - Spawn via helper `spawnCapture(cmd, timeoutMs)` (local, uses `child_process.spawn` with
    `{ shell: true }`, collects stdout/stderr strings, kills on timeout — with **tree-kill**,
    see §6.5).
  - Hooks (`{ onState?(status), onLog?(line: string, stream) }`) stream copilot output so the UI
    can show a REFINING tile.
  - Post-process stdout: trim; if wrapped in ``` fences, strip them; strip a leading
    `[COMPRESS & OPTIMIZE]:` label if the model echoed it; collapse 3+ consecutive newlines to 1.
  - Guard: if post-processed output is empty, whitespace-only, or longer than ~3× raw length
    (copilot malfunctioned) → fallback to raw with `error` message.
  - Compute `savedPercent = round((1 - optTok / rawTok) * 100)`, clamped to 0..99; if negative,
    report 0 and prefer the shorter of the two prompts for dispatch.
  - Timeout/exit-error → `fallback: true`, `error` populated; **never throw**.

### 6.4 `src/router.ts`
- `route(prompt, config): RouteResult`.
- Scoring per tier: `+2` per distinct keyword found (case-insensitive substring on lowercase
  prompt); `+1` if `maxWords != null && wordCount <= maxWords` (word count =
  `prompt.trim().split(/\s+/).length`).
- Pick max score; **ties break toward the later tier in the array** (config lists low→high, so
  later = stronger tier; document this precedence rule).
- If every tier scores 0 (no keyword hits): return the middle-index tier with
  `confidence: 'low'` and reason `no signals; balanced default`. Configs with exactly 3 tiers
  always get the middle tier here.
- Attach the tier's `agentKey`; if that key is missing from `config.agents`, throw a
  `ConfigError` (this is a genuine config bug the user must fix).

### 6.5 `src/agent-manager.ts` — the heart of the tool
`class AgentManager extends EventEmitter`:

- **Registry:** `Map<string, { instance: AgentInstance; proc: ChildProcess | null }>`;
  ring-buffer logs: cap `logs` at 2000 lines (shift-drop from front).
- **Events:** emit single `'change'` on every mutation (add/update/state/log/clear). The UI
  re-renders off this one event with a shallow read of the registry — do NOT deep-clone logs per
  event (perf).
- `register(spec: JobSpec): string` — creates instance, initial status `REFINING` if `spec.refine`
  else `IDLE`; auto-id generation: slug of `spec.id` + `-2`, `-3`… if colliding.
- `async run(id, opts?): Promise<{ exitCode: number | null }>` — set SPAWNED (+`startedAt`), then
  `spawn(command, { shell: true, cwd: opts.cwd })`. On first stdout/stderr chunk → STREAMING.
  `data` handlers append `LogLine`s (split on `\n`, keep partial line buffer). On `close(code)`:
  if not already KILLED, set COMPLETED (code 0) or FAILED (else), `endedAt`, emit. Resolve;
  never reject on non-zero exit.
- `killTree(id)` —
  - **Windows is the primary target OS:** if `proc?.pid`, run
    `spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: false, windowsHide: true,
    stdio: 'ignore' })` (kills the whole process tree; `proc.kill()` does NOT kill grandchildren
    spawned via `shell: true`).
  - POSIX fallback: `proc.kill('SIGTERM')`, escalate to `SIGKILL` after 1500 ms if still alive
    (spawn fresh `taskkill` on win as well in the escalation path).
  - Mark KILLED unless a terminal status was already recorded.
- `killAll(): Promise<void>` — kill every instance whose status is active; idempotent.
- `clearLogs(id)` / `clearAllLogs()` — keep instance, empty `logs`, append a `stream:'system'`
  marker line.
- Orchestration helpers (used by both UI and headless runner):
  - `runParallel(specs)` → `register` all, `const results = await Promise.allSettled(specs.map(s =>
    this.run(id)))`; return aggregated summary `{ succeeded, failed, results }`.
  - `runSequential(stages, { continueOnError = false })` → for each stage, register + `await
    run`; if FAILED/KILLED and `!continueOnError`, register remaining stages as KILLED with a
    system log line "skipped: upstream stage failed", and stop.
- `listInstances(): AgentInstance[]`, `getInstance(id)`.
- Name the exported placeholder-templating concern **outside** this file (lives in
  prompt-copilot) — manager only accepts final command strings.

### 6.6 `src/cli.tsx`
Manual flag parsing (no CLI dep):
- `polycode [--config <path>] [--no-copilot]` → interactive TUI.
- `polycode init [--path <p>] [--force]` → `initConfig`.
- `polycode run "<prompt>" [--mode <modeId>] [--config <path>]` → **headless** runner (no Ink):
  load config, optimize, dispatch by mode, print each instance's logs to stdout as they arrive,
  exit with code 1 if any required job FAILED. This is the CI/test path — keep it small.
- `--help`, `--version` (read version from `package.json` via
  `readFileSync(new URL('../package.json', import.meta.url), 'utf8')`).
- TTY guard: if `!process.stdout.isTTY` and not `run`/`init`, print help + exit 2.
- Interactive: `render(<App …/> , { exitOnCtrlC: false })`; handle Ctrl+C **inside** App so
  `manager.killAll()` runs before exit. Additionally register
  `process.on('SIGINT' | 'SIGTERM', ...) → killAll()` as an OS-level backstop, and a
  `setTimeout(() => process.exit(1), 1500).unref()` escape hatch so a wedged child can't hang
  the shell.

### 6.7 UI (`src/ui/`)
Ink layout (top→bottom): `StatusHeader` → hint/status line → `CopilotView` (only after first
optimization) → `SubagentGrid` → `AgentTerminal` (fixed height ≈ 12 rows) → mode bar → prompt
input.

- **`StatusHeader`** — config path (dim), running count `active/total`, last copilot savings
  (`Saved 52% • 142→68 tok`), current tier cost badge when routed.
- **`CopilotView`** — two bordered boxes stacked vertically when `process.stdout.columns < 110`
  else side-by-side: "Raw (N tok)" vs "Optimized (M tok)", wrapped text, plus metrics line with
  fallback badge (`⚠ fallback — raw prompt used`) when `result.fallback`.
- **`SubagentGrid`** — one bordered tile per instance: name, `[COST]` badge, status badge, elapsed
  `mm:ss` (1000 ms interval re-render while any active instance exists); selected tile has cyan
  border, others gray; status colors: IDLE gray, REFINING cyan, SPAWNED yellow, STREAMING green,
  COMPLETED green, FAILED red, KILLED yellowBright.
- **`AgentTerminal`** — shows selected instance's `logs.slice(-visible)` where `visible` = box
  height − 2; stderr red, system cyan-dim, stdout default; auto-follow tail. Header shows command
  (truncated to width) + exit code when terminal.
- **`ModeSelector`** — modal, opened with **Ctrl+M**: list = `smart-auto` + every config swarm
  key + `manual:<agentKey>` for each agent. Up/Down or digits to pick, Enter confirm, Esc cancel.
  While open, render it as an overlay replacing the normal grid area and set the text input's
  `focus={false}`.
- **`App.tsx`** — owns: `inputValue`, `mode` (default `config.defaultMode`), `copilotResult`,
  `selectedTabIdx`, `modalOpen`; a `forceUpdate` counter subscribed once (useEffect) to
  `manager.on('change')` (re-render pattern: read latest instances directly from manager; auto-
  select newly added instances).
  - **Submit (Enter via `<TextInput onSubmit>`):**
    1. Guard empty/whitespace; clear input.
    2. Register a copilot instance `('copilot', refine: true)` only when engineer enabled; call
       `optimizePrompt(raw, config, hooks→push into that instance)`; store `CopilotResult`.
    3. Dispatch on `mode`:
       - `smart-auto` → `route()` → single `JobSpec` from `agent.cmdTemplate` (⊘ `{prompt}` =
         optimized); run.
       - `manual:<key>` → same without routing.
       - `swarm:<key>` `sequential` → stages' `cmd` with `{prompt}` substituted →
         `runSequential`.
       - `swarm:<key>` `parallel` → each subagent's `taskTemplate` substituted = the *task*,
         then that task substituted into its agent's `cmdTemplate` → `runParallel`.
    4. All dispatch is fire-and-forget async (do not block UI); errors land in the instance log.
  - **Shortcuts (single `useInput`):**
    - `Ctrl+C` → `await manager.killAll()` then `app.exit()` (render with `exitOnCtrlC: false`).
    - `Ctrl+K` → killAll (stay in app), system log "swarm killed by user".
    - `Ctrl+L` → clear all logs.
    - `Ctrl+M` → toggle mode modal.
    - `Tab` / `Shift+Tab` → cycle selected tab ±1 through instance list.
  - **ink-text-input Tab quirk:** a Tab keystroke ALSO reaches the input (would insert `\t`).
    Neutralize with `onChange={v => setValue(v.replace(/\t/g, ''))}` in App, and perform tab
    cycling in the same render pass — order of side effects is safe because state updates batch.
  - Do NOT hijack arrow keys globally (ink-text-input needs them for cursor movement) — that's
    why mode switching is a modal, not arrow-key cycling.
  - Shortcut hint bar under the input: `Enter spawn • Tab switch • ^M mode • ^K kill • ^L clear
    • ^C quit`.

## 7. Orchestration rules that must hold

1. **Zero hardcoding** outside defaults: agent cmds, tiers, swarm stages, the copilot's
   systemPrompt — all only from `polycode.config.json`. Code may reference *semantics* (engineer
   key from `promptEngineer.agentKey`), never baked-in command strings.
2. Every dispatch passes through `optimizePrompt` first (unless `--no-copilot` / `enabled:false`),
   even swarm/pipeline dispatches (one optimization per submission; the optimized prompt feeds
   all stages/subagents).
3. Manager functions never throw on process failure — failures are instance statuses + exit
   codes.
4. No orphan processes: every spawn is registered before listeners attach; killAll + signal
   backstops guarantee teardown; also `process.on('exit')` best-effort sync `taskkill` pass on
   win32.
5. Ring buffers + single 'change' event + no deep-cloning = UI stays cheap even under noisy CLIs.

## 8. Verification checklist (must pass before "done")

```bash
npm install
npm run build            # tsc clean, no errors, check dist/ imports all have .js extensions
node bin/polycode.js --help
node bin/polycode.js init   # writes ./polycode.config.json; rejects second run without --force
```

Headless smoke (uses only node as a "fake agent" — no real AI CLIs installed):

1. Create a temp test config whose agents are
   `"cmdTemplate": "node -e \"process.stdout.write('{prompt}')\"",` with `promptEngineer.enabled:
   false`, then:
   `node bin/polycode.js run "hello world" --config test.json --mode manual:<key>` → must print
   `hello world` and exit 0.
2. Parallel swarm test: 3 subagents using `node -e "setTimeout(()=>console.log('<id>'), N)"` with
   staggered N → all three outputs appear; exit 0.
3. Kill test: subagent running `node -e "setInterval(()=>{},999)"` under `run`, send SIGINT to
   polycode → cmd window returns, no orphan `node` remains:
   `Get-Process node | Where-Object {$_.CommandLine -match 'setInterval'}` in PowerShell must be
   empty afterwards.
4. Copilot fallback test: `promptEngineer.enabled: true` pointing at a non-existent binary → run
   must still dispatch the raw prompt and exit 0 (fallback path).
5. Interactive check: `node bin/polycode.js` → type prompt, Enter, watch: copilot tile (REFINING →
   COMPLETED), routed tile SPAWNED→STREAMING→COMPLETED, Tab cycles tabs, ^K kills, ^L clears, ^M
   mode modal, ^C exit-with-kill.

## 9. Known gotchas (don't rediscover these)

- **`.js` extension on all relative imports** (NodeNext) — including `.tsx` sources.
- `ink-text-input` **6.0.0 is the newest that exists**; `^6.1.0` does not resolve (this document
  was written after hitting exactly that failure).
- Windows multi-line prompts will corrupt `shell: true` command lines — always flatten newlines in
  `substitutePlaceholders`.
- `spawn(..., { shell: true })` on Windows wraps in `cmd.exe`; killing the direct child leaves
  grandchildren alive → **always tree-kill via `taskkill /T /F`**.
- Double-escaping: templates already contain `"{prompt}"` — substitute the *inner* escaped text
  only; never add your own quotes.
- Ink: `render(...)` with `exitOnCtrlC: false`, handle ^C manually or children outlive the UI.
- Ink boxes: give the log box a bounded height or Ink will grow it unbounded and push the input
  off screen.
- `Promise.allSettled`, not `Promise.all` — one failing swarm member must not reject the rest nor
  skip their teardown.
- htop-style "update timestamps every second": the interval must only run while ≥1 active
  instance; clear it in `useEffect` cleanup to avoid post-exit setState warnings.

## 10. Out of scope (do not build)

- Real streaming tokenization, npm publishing steps, unit-test framework setup
  (manual headless checks suffice), config hot-reload, mouse support, Windows Unicode/nerd-font
  extras.
