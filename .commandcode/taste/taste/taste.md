# Taste
- Expects finished deliverables to ship with operational documentation (a README covering how to run/operate, CLI commands, config schema, and behavior notes) plus a `.gitignore` for hygiene (node_modules, build output, generated config, logs, editor cruft, scratch). Confidence: 0.6
- Prefers spec-driven work: points the agent at a written plan document (e.g., `docs/PLAN.md`) and expects it implemented faithfully, with gaps (like referenced-but-missing files) filled in proactively. Confidence: 0.6
- Expects the agent to self-refactor and remove cruft before finishing — unused imports/props/refs, no-op placeholder branches, dead code, and leftover scaffolding are actively cleaned up rather than shipped "temporarily". Confidence: 0.8
- Verifies by actually running the built artifact through end-to-end smoke tests (CLI flags, headless runs, process-tree/orphan checks, TTY guards) and re-running build/typecheck after each fix to get a clean current error list, rather than trusting stale type errors or only passing `tsc`. Confidence: 0.8
- Does not want a co-author trailer on commits (explicitly overrides the default co-author convention; "push but put no coauthor"). Confidence: 0.9
- Develops on Windows; project roots live under drive-letter paths (e.g., `D:\Projects\polycode`) — keep commands and paths Windows-compatible. Confidence: 0.7
- Prefers runtime/behavioral settings (agent models, config knobs) to be editable from the app's own UI rather than only hand-editing the config file ("make everything configurable by the ui"). Confidence: 0.5
- Issues terse, one-line imperative commands ("push", "continue") and expects the agent to plan, fill in details, and execute end-to-end autonomously without asking clarifying questions. Confidence: 0.6
