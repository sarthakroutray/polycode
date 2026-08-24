import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { CopilotResult, PolycodeConfig, LogStream } from './types.js';

/**
 * Rough token estimate. Approximation only — documents that it is a heuristic
 * with zero extra deps: loosely ~4 chars per token.
 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface OptimizeHooks {
  onState?(status: string): void;
  onLog?(line: string, stream: LogStream): void;
}

export interface CopilotDeps {
  /** Spawn a command capturing stdout/stderr into strings; tree-kills on timeout. */
  spawnCapture(
    cmd: string,
    timeoutMs: number,
    hooks?: OptimizeHooks,
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null; killed: boolean }>;
}

const DEFAULT_SPAWN_CAPTURE: CopilotDeps['spawnCapture'] = (cmd, timeoutMs, hooks) =>
  new Promise((resolve) => {
    let proc: ChildProcess;
    try {
      proc = spawn(cmd, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ stdout: '', stderr: String(err), exitCode: -1, killed: false });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      // Best-effort tree-kill on timeout (Windows taskkill; POSIX fallback).
      if (proc.pid) {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
            shell: false,
            windowsHide: true,
            stdio: 'ignore',
          });
        } else {
          try {
            proc.kill('SIGKILL');
          } catch {
            /* already dead */
          }
        }
      }
    }, timeoutMs);

    const sink = (line: string, stream: 'stdout' | 'stderr') => {
      if (line.length === 0) return;
      hooks?.onLog?.(line, stream);
      if (stream === 'stdout') stdout += line + '\n';
      else stderr += line + '\n';
    };

    proc.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) sink(line, 'stdout');
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) sink(line, 'stderr');
    });

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: proc.exitCode, killed });
    };

    proc.on('error', (err) => {
      stderr = String(err);
      finish();
    });
    proc.on('close', finish);
  });

/**
 * Collapse newlines, escape for embedding inside the template's existing
 * quotes, and substitute {prompt} / {system} for all occurrences. Leaves
 * unknown braces (e.g. {tokens}) untouched.
 */
export function substitutePlaceholders(
  template: string,
  values: { prompt: string; system?: string },
): string {
  const flat = values.prompt.replace(/\s*\n\s*/g, ' ').trim();
  const escaped = flat.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  let out = template.split('{prompt}').join(escaped);
  if (values.system) {
    const sysFlat = values.system.replace(/\s*\n\s*/g, ' ').trim();
    const sysEscaped = sysFlat.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    out = out.split('{system}').join(sysEscaped);
  }
  return out;
}

/**
 * Optimize a raw prompt via the prompt-engineer copilot agent. Never throws on
 * process failure — falls back to the raw prompt. Dispatched even for swarm /
 * pipeline runs (one optimization per submission).
 */
export async function optimizePrompt(
  raw: string,
  config: PolycodeConfig,
  opts?: { deps?: CopilotDeps; hooks?: OptimizeHooks },
): Promise<CopilotResult> {
  const started = Date.now();
  const rawTokens = estimateTokens(raw);
  const engineer = config.promptEngineer;
  const agent = config.agents[engineer.agentKey];

  const fallbackResult = (
    partial: Partial<Omit<CopilotResult, 'fallback'>>,
  ): CopilotResult => ({
    rawPrompt: raw,
    optimizedPrompt: raw,
    rawTokens,
    optimizedTokens: rawTokens,
    savedPercent: 0,
    fallback: true,
    durationMs: Date.now() - started,
    ...partial,
  });

  if (!engineer.enabled || !agent) {
    return fallbackResult({
      error: !engineer.enabled
        ? 'promptEngineer disabled'
        : 'engineer agent missing from config.agents',
    });
  }

  const cmd = substitutePlaceholders(agent.cmdTemplate, { prompt: raw, system: engineer.systemPrompt });
  opts?.hooks?.onState?.('REFINING');
  opts?.hooks?.onLog?.(cmd, 'system');

  const deps = opts?.deps ?? { spawnCapture: DEFAULT_SPAWN_CAPTURE };
  let out: { stdout: string; stderr: string; exitCode: number | null; killed: boolean };
  try {
    out = await deps.spawnCapture(cmd, engineer.timeoutMs, opts?.hooks);
  } catch (err) {
    return fallbackResult({ error: `copilot spawn threw: ${String(err)}` });
  }

  opts?.hooks?.onState?.('COMPLETED');

  if (out.killed) {
    return fallbackResult({ error: `copilot timed out after ${engineer.timeoutMs}ms` });
  }
  if (out.exitCode !== 0) {
    return fallbackResult({
      error: `copilot exited ${out.exitCode}: ${out.stderr.trim() || 'no error output'}`,
    });
  }

  const trimmed = out.stdout.trim();
  const optimized = postProcess(trimmed);
  const optimizedTokens = estimateTokens(optimized);

  const tooLong = optimized.length > raw.length * 3;
  if (!optimized || !optimized.trim() || tooLong) {
    return fallbackResult({
      error: optimized
        ? 'copilot output implausibly long; falling back to raw'
        : 'copilot produced empty output; falling back to raw',
    });
  }

  let savedPercent = Math.round((1 - optimizedTokens / rawTokens) * 100);
  savedPercent = Math.max(0, Math.min(99, savedPercent));

  const preferShorter =
    optimizedTokens > rawTokens ? raw : optimized;

  return {
    rawPrompt: raw,
    optimizedPrompt: preferShorter,
    rawTokens,
    optimizedTokens: estimateTokens(preferShorter),
    savedPercent: preferShorter === raw ? 0 : savedPercent,
    fallback: false,
    durationMs: Date.now() - started,
  };
}

/** Strip fences, leading [COMPRESS & OPTIMIZE]: label, and excessive newlines. */
function postProcess(text: string): string {
  let t = text.trim();
  const fence = /^```[a-zA-Z]*\n?([\s\S]*?)\n?```$/;
  const fenced = t.match(fence);
  if (fenced) t = fenced[1].trim();
  t = t.replace(/^\[COMPRESS\s*&\s*OPTIMIZE\]:\s*/i, '');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}