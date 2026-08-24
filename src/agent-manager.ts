import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type {
  AgentInstance,
  AgentStatus,
  JobSpec,
  LogLine,
  LogStream,
  RunOptions,
} from './types.js';
import { isActiveStatus, isTerminalStatus } from './types.js';

const MAX_LOGS = 2000;

interface RegistryEntry {
  instance: AgentInstance;
  proc: ChildProcess | null;
}

export interface ParallelSummary {
  succeeded: number;
  failed: number;
  results: PromiseSettledResult<{ exitCode: number | null }>[];
}

/**
 * Spawn registry + orchestrator. Emits a single 'change' event on every
 * mutation; consumers re-render off it with a shallow read (never deep-clone
 * logs per event).
 */
export class AgentManager extends EventEmitter {
  private registry = new Map<string, RegistryEntry>();

  listInstances(): AgentInstance[] {
    return [...this.registry.values()].map((e) => e.instance);
  }

  getInstance(id: string): AgentInstance | undefined {
    return this.registry.get(id)?.instance;
  }

  /** Create an instance. Auto-generates a unique id if the slug collides. */
  register(spec: JobSpec): string {
    let id = slugify(spec.id);
    let n = 2;
    while (this.registry.has(id)) {
      id = `${slugify(spec.id)}-${n}`;
      n += 1;
    }
    const instance: AgentInstance = {
      id,
      name: spec.name,
      agentKey: spec.agentKey,
      costBadge: spec.costBadge,
      status: spec.refine ? 'REFINING' : 'IDLE',
      command: spec.command,
      pid: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      logs: [],
    };
    this.registry.set(id, { instance, proc: null });
    this.emit('change');
    return id;
  }

  /** Spawn + stream an instance. Never rejects on non-zero exit. */
  async run(id: string, opts: RunOptions = {}): Promise<{ exitCode: number | null }> {
    const entry = this.registry.get(id);
    if (!entry) throw new Error(`Unknown instance: ${id}`);
    const { instance } = entry;
    const s = instance.status;

    // Already terminal or actively running.
    if (isTerminalStatus(s)) return { exitCode: instance.exitCode };
    if (s === 'SPAWNED' || s === 'STREAMING') return { exitCode: null };

    instance.status = 'SPAWNED';
    instance.startedAt = Date.now();
    this.emit('change');

    let proc: ChildProcess;
    try {
      proc = spawn(instance.command, {
        shell: true,
        cwd: opts.cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      instance.status = 'FAILED';
      instance.exitCode = -1;
      instance.endedAt = Date.now();
      this.pushLog(id, `spawn failed: ${String(err)}`, 'system');
      this.emit('change');
      return { exitCode: -1 };
    }

    entry.proc = proc;
    instance.pid = proc.pid ?? null;

    if (proc.stdout) {
      proc.stdout.on('data', (chunk: Buffer) => this.handleData(id, chunk, 'stdout'));
    }
    if (proc.stderr) {
      proc.stderr.on('data', (chunk: Buffer) => this.handleData(id, chunk, 'stderr'));
    }
    proc.on('error', (err) => {
      this.pushLog(id, `process error: ${String(err)}`, 'system');
    });
    proc.on('close', (code) => {
      // Flush any buffered partial line on close.
      const leftover = this.partial[id];
      if (leftover) {
        delete this.partial[id];
        this.pushLog(id, leftover, 'stdout');
      }
      if (instance.status === 'KILLED') {
        // Already recorded as killed by killTree.
      } else {
        instance.status = code === 0 ? 'COMPLETED' : 'FAILED';
      }
      instance.exitCode = code;
      instance.endedAt = Date.now();
      entry.proc = null;
      this.emit('change');
    });

    return new Promise((resolve) => {
      proc.once('close', () => resolve({ exitCode: proc.exitCode }));
    });
  }

  private handleData(id: string, chunk: Buffer, stream: 'stdout' | 'stderr') {
    const instance = this.getInstance(id);
    if (!instance) return;
    if (instance.status !== 'STREAMING' && isActiveStatus(instance.status)) {
      instance.status = 'STREAMING';
    }
    const text = chunk.toString();
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isLast = i === lines.length - 1;
      if (isLast && /[^\r\n]$/.test(text) && line) {
        // Partial trailing line — buffer it, append on next chunk/end.
        this.partial[id] = (this.partial[id] ?? '') + line;
      } else if (line) {
        const merged = (this.partial[id] ?? '') + line;
        delete this.partial[id];
        this.pushLog(id, merged, stream);
      }
    }
    this.emit('change');
  }

  private partial: Record<string, string> = {};

  private pushLog(id: string, text: string, stream: LogStream) {
    const instance = this.getInstance(id);
    if (!instance) return;
    const line: LogLine = { stream, text, timestamp: Date.now() };
    instance.logs.push(line);
    if (instance.logs.length > MAX_LOGS) {
      instance.logs.splice(0, instance.logs.length - MAX_LOGS);
    }
  }

  /**
   * Kill a whole process tree. Windows (primary target) uses taskkill /T /F;
   * POSIX falls back to SIGTERM → SIGKILL escalation.
   */
  async killTree(id: string): Promise<void> {
    const entry = this.registry.get(id);
    if (!entry) return;
    const { instance } = entry;
    if (!isActiveStatus(instance.status) || instance.status === 'REFINING') {
      // REFINING has no process yet — mark KILLED if it's still refining.
      if (instance.status === 'REFINING' && !isTerminalStatus(instance.status)) {
        instance.status = 'KILLED';
        this.emit('change');
      }
      return;
    }
    const pid = entry.proc?.pid;
    if (pid == null) return;

    await this.treeKill(pid, instance.id);

    if (!isTerminalStatus(instance.status)) {
      instance.status = 'KILLED';
    }
    instance.endedAt = Date.now();
    entry.proc = null;
    this.emit('change');
  }

  /** Kill every active instance. Idempotent. */
  async killAll(): Promise<void> {
    const ids = [...this.registry.keys()];
    await Promise.all(ids.map((id) => this.killTree(id)));
  }

  /** Empty an instance's logs, keeping the instance. */
  clearLogs(id: string) {
    const instance = this.getInstance(id);
    if (!instance) return;
    instance.logs = [];
    this.pushLog(id, 'logs cleared', 'system');
    this.emit('change');
  }

  clearAllLogs() {
    for (const id of this.registry.keys()) this.clearLogs(id);
  }

  // -------------------------------------------------------------------------
  // Orchestration helpers
  // -------------------------------------------------------------------------

  async runParallel(specs: JobSpec[]): Promise<ParallelSummary> {
    const ids = specs.map((s) => this.register(s));
    const results = await Promise.allSettled(
      ids.map((id) => this.run(id)),
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value.exitCode === 0).length;
    return { succeeded, failed: results.length - succeeded, results };
  }

  async runSequential(
    stages: JobSpec[],
    opts: { continueOnError?: boolean } = {},
  ): Promise<ParallelSummary> {
    const ids: string[] = [];
    const results: PromiseSettledResult<{ exitCode: number | null }>[] = [];
    for (const stage of stages) {
      const id = this.register(stage);
      ids.push(id);
      let res: PromiseSettledResult<{ exitCode: number | null }>;
      try {
        const value = await this.run(id);
        res = { status: 'fulfilled', value };
      } catch (err) {
        res = { status: 'rejected', reason: err };
      }
      results.push(res);
      const failed = res.status === 'rejected' || (res.status === 'fulfilled' && res.value.exitCode !== 0);
      if (failed && !opts.continueOnError) {
        // Mark remaining stages as skipped.
        const rest = stages.slice(results.length);
        for (const sk of rest) {
          const skipId = this.register(sk);
          const skip = this.getInstance(skipId);
          if (skip) {
            skip.status = 'KILLED';
            this.pushLog(skipId, 'skipped: upstream stage failed', 'system');
          }
        }
        break;
      }
    }
    const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value.exitCode === 0).length;
    return { succeeded, failed: results.length - succeeded, results };
  }

  /** Tree-kill by pid, honoring the platform. Windows uses taskkill /T /F; POSIX SIGTERM→SIGKILL. */
  private treeKill(pid: number, id: string): Promise<void> {
    if (process.platform === 'win32') {
      return new Promise((resolve) => {
        const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
          shell: false,
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.on('close', () => resolve());
        killer.on('error', () => resolve());
      });
    }
    // POSIX: SIGTERM, escalate to SIGKILL after 1500ms.
    return new Promise((resolve) => {
      const findProc = () => this.registry.get(id)?.proc ?? null;
      try {
        findProc()?.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          findProc()?.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 1500);
      resolve();
    });
  }
}

function slugify(s: string): string {
  const cleaned = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'task';
}