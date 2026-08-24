import React from 'react';
import { spawn } from 'node:child_process';
import { render } from 'ink';
import { AgentManager } from './agent-manager.js';
import { App } from './ui/App.js';
import { loadpolycodeConfig, initConfig, readPackageVersion } from './config.js';
import { optimizePrompt, substitutePlaceholders } from './prompt-copilot.js';
import { route } from './router.js';
import type { PolycodeConfig, JobSpec } from './types.js';

const HELP = `polycode — multi-agent parallel orchestrator & prompt-engineering copilot

Usage:
  polycode [--config <path>] [--no-copilot]          interactive TUI
  polycode init [--path <path>] [--force]            write a default config
  polycode run "<prompt>" [--mode <mode>] [--config <path>]   headless run
  polycode --help | --version

Modes for --mode:
  smart-auto              route through config tiers (default)
  manual:<agentKey>       run a specific agent
  swarm:<swarmKey>        run a configured swarm (sequential or parallel)

Shortcuts (TUI): Enter spawn • Tab switch • ^M mode • ^K kill • ^L clear • ^C quit
`;

interface ParsedArgs {
  command: 'interactive' | 'init' | 'run' | 'help' | 'version';
  config?: string;
  noCopilot: boolean;
  prompt?: string;
  mode?: string;
  initPath?: string;
  force: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    command: 'interactive',
    noCopilot: false,
    force: false,
  };

  if (argv.includes('--help') || argv.includes('-h')) args.command = 'help';
  if (argv.includes('--version') || argv.includes('-v')) args.command = 'version';

  const readAfter = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
  };

  args.config = readAfter('--config');
  args.mode = readAfter('--mode');
  args.initPath = readAfter('--path');
  args.noCopilot = argv.includes('--no-copilot');
  args.force = argv.includes('--force');

  if (argv.includes('init')) {
    args.command = 'init';
  } else if (argv.includes('run')) {
    args.command = 'run';
    const runIdx = argv.indexOf('run');
    args.prompt = argv[runIdx + 1];
    if (args.prompt === undefined || args.prompt.startsWith('--')) {
      throw new Error('`run` requires a prompt argument: polycode run "<prompt>"');
    }
  }
  return args;
}

function exit(code: number): never {
  process.exit(code);
}

/** Best-effort synchronous tree-kill on process exit (win32 taskkill pass). */
function registerExitBackstop(manager: AgentManager): void {
  process.on('exit', () => {
    for (const inst of manager.listInstances()) {
      if (inst.pid && (inst.status === 'SPAWNED' || inst.status === 'STREAMING')) {
        try {
          spawn('taskkill', ['/PID', String(inst.pid), '/T', '/F'], {
            shell: false,
            windowsHide: true,
            stdio: 'ignore',
          });
        } catch {
          /* ignore */
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// init — write default config
// ---------------------------------------------------------------------------
function handleInit(args: ParsedArgs): void {
  try {
    const written = initConfig(args.initPath, args.force);
    console.log(`polycode: wrote default config to ${written}`);
    exit(0);
  } catch (err) {
    console.error(`polycode: ${(err as Error).message}`);
    exit(1);
  }
}

// ---------------------------------------------------------------------------
// run — headless runner (CI/test path, no Ink)
// ---------------------------------------------------------------------------
async function handleRun(args: ParsedArgs): Promise<void> {
  const load = loadpolycodeConfig(args.config);
  if (load.error) {
    console.error(`polycode: ${load.error}`);
    exit(1);
  }
  const config = load.config as PolycodeConfig;
  const prompt = args.prompt as string;
  const mode = args.mode ?? config.defaultMode;

  const manager = new AgentManager();
  let interrupted = false;
  const teardown = async () => {
    if (interrupted) return;
    interrupted = true;
    await manager.killAll();
  };
  process.on('SIGINT', () => void teardown().finally(() => exit(130)));
  process.on('SIGTERM', () => void teardown().finally(() => exit(130)));
  registerExitBackstop(manager);
  const hatch = setTimeout(() => void teardown(), 600000);
  hatch.unref();

  // Print each instance's logs to stdout as they arrive.
  const printed = new Map<string, number>();
  manager.on('change', () => {
    for (const inst of manager.listInstances()) {
      const from = printed.get(inst.id) ?? 0;
      if (from < inst.logs.length) {
        for (let i = from; i < inst.logs.length; i++) {
          const line = inst.logs[i];
          if (line.stream !== 'system') console.log(`[${inst.name}] ${line.text}`);
        }
        printed.set(inst.id, inst.logs.length);
      }
    }
  });

  // Optimize (unless disabled / --no-copilot).
  const optimizeEnabled = !args.noCopilot && config.promptEngineer.enabled;
  let dispatchPrompt = prompt;
  if (optimizeEnabled && config.agents[config.promptEngineer.agentKey]) {
    const result = await optimizePrompt(prompt, config);
    if (result.fallback) {
      console.warn(`polycode: copilot fell back to raw prompt (${result.error ?? 'no reason'})`);
    } else {
      dispatchPrompt = result.optimizedPrompt;
      console.warn(
        `polycode: optimized ${result.rawTokens}→${result.optimizedTokens} tok (${result.savedPercent}%)`,
      );
    }
  } else if (optimizeEnabled && !config.agents[config.promptEngineer.agentKey]) {
    console.warn('polycode: promptEngineer enabled but agent missing; skipping optimization');
  }

  const plan = buildHeadlessJobs(dispatchPrompt, mode, config);
  if (!plan.jobs.length) {
    console.error('polycode: no jobs matched the requested mode');
    exit(1);
  }

  // Dispatch honoring swarm semantics: sequential stages wait for upstream,
  // parallel subagents run concurrently.
  if (plan.sequential) {
    await manager.runSequential(plan.jobs);
  } else if (plan.jobs.length > 1) {
    await manager.runParallel(plan.jobs);
  } else {
    const id = manager.register(plan.jobs[0]);
    await manager.run(id);
  }

  // Wait a tick so final logs flush.
  await new Promise((r) => setTimeout(r, 100));

  const anyFailed = manager
    .listInstances()
    .some((inst) => (inst.exitCode ?? -1) !== 0);
  if (anyFailed) {
    console.error('polycode: one or more jobs FAILED');
    exit(1);
  }
  exit(0);
}

function buildHeadlessJobs(
  prompt: string,
  mode: string,
  config: PolycodeConfig,
): { jobs: JobSpec[]; sequential: boolean } {
  const out: JobSpec[] = [];
  let sequential = false;
  if (mode === 'smart-auto') {
    const r = route(prompt, config);
    const agent = config.agents[r.agentKey];
    if (agent) {
      out.push({
        id: r.agentKey,
        agentKey: r.agentKey,
        name: agent.name,
        costBadge: agent.costBadge,
        command: substitutePlaceholders(agent.cmdTemplate, { prompt }),
      });
    }
  } else if (mode.startsWith('manual:')) {
    const key = mode.slice('manual:'.length);
    const agent = config.agents[key];
    if (agent) {
      out.push({
        id: `manual-${key}`,
        agentKey: key,
        name: agent.name,
        costBadge: agent.costBadge,
        command: substitutePlaceholders(agent.cmdTemplate, { prompt }),
      });
    }
  } else if (mode.startsWith('swarm:')) {
    const key = mode.slice('swarm:'.length);
    const swarm = config.swarms[key];
    if (swarm) {
      if (swarm.type === 'sequential') {
        sequential = true;
        for (const st of swarm.stages) {
          const a = config.agents[st.agentKey];
          out.push({
            id: `seq-${key}-${st.name}`,
            agentKey: st.agentKey,
            name: st.name,
            costBadge: a?.costBadge ?? '',
            command: substitutePlaceholders(st.cmd, { prompt }),
          });
        }
      } else {
        for (const sb of swarm.subagents) {
          const task = substitutePlaceholders(sb.taskTemplate, { prompt });
          const a = config.agents[sb.agentKey];
          out.push({
            id: `par-${sb.id}`,
            agentKey: sb.agentKey,
            name: sb.name,
            costBadge: a?.costBadge ?? '',
            command: a ? substitutePlaceholders(a.cmdTemplate, { prompt: task }) : task,
          });
        }
      }
    }
  }
  return { jobs: out, sequential };
}

// ---------------------------------------------------------------------------
// interactive
// ---------------------------------------------------------------------------
function handleInteractive(args: ParsedArgs): void {
  const load = loadpolycodeConfig(args.config);
  if (load.error) {
    console.error(`polycode: ${load.error}`);
    exit(1);
  }
  const config = load.config as PolycodeConfig;
  const path = load.path as string;

  const manager = new AgentManager();
  const app = render(
    React.createElement(App, { config, configPath: path, manager, noCopilot: args.noCopilot }),
    { exitOnCtrlC: false },
  );

  const shutdown = async () => {
    await manager.killAll();
    app.unmount();
    exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  registerExitBackstop(manager);

  // Escape hatch: a wedged child must not hang the shell forever.
  const hatch = setTimeout(() => {
    void shutdown();
  }, 600000);
  hatch.unref();
}

// ---------------------------------------------------------------------------
export async function main(): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`polycode: ${(err as Error).message}`);
    exit(2);
  }

  if (args.command === 'version') {
    console.log(readPackageVersion());
    exit(0);
  }
  if (args.command === 'help') {
    console.log(HELP);
    exit(0);
  }
  if (args.command === 'init') {
    handleInit(args);
    return;
  }
  if (args.command === 'run') {
    await handleRun(args);
    return;
  }
  // interactive
  if (!process.stdout.isTTY) {
    console.error('polycode: a TTY is required for interactive mode.');
    console.error('Use `polycode run "<prompt>"` for headless, or `polycode --help`.');
    exit(2);
  }
  handleInteractive(args);
}

await main();