# Taste

## Workflow
- Expects finished deliverables to ship with operational documentation (a README covering how to run/operate, CLI commands, config schema, and behavior notes) plus a `.gitignore` for hygiene (node_modules, build output, generated config, logs, editor cruft, scratch). Confidence: 0.6
- Prefers spec-driven work: points the agent at a written plan document (e.g., `docs/PLAN.md`) and expects it implemented faithfully, with gaps (like referenced-but-missing files) filled in proactively. Confidence: 0.6
- Expects the agent to self-refactor and remove cruft before finishing — unused imports/props/refs, no-op placeholder branches, dead code, and leftover scaffolding are actively cleaned up rather than shipped "temporarily". Confidence: 0.8
- Verifies by actually running the built artifact through end-to-end smoke tests (CLI flags, headless runs, process-tree/orphan checks, TTY guards) and re-running build/typecheck after each fix to get a clean current error list, rather than trusting stale type errors or only passing `tsc`. Confidence: 0.8

## Environment
- Develops on Windows; project roots live under drive-letter paths (e.g., `D:\Projects\polycode`) — keep commands and paths Windows-compatible. Confidence: 0.7
