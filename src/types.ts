import { z } from 'zod';

// ---------------------------------------------------------------------------
// Agent / tier / swarm status
// ---------------------------------------------------------------------------

export type AgentStatus =
  | 'IDLE'
  | 'REFINING'
  | 'SPAWNED'
  | 'STREAMING'
  | 'COMPLETED'
  | 'FAILED'
  | 'KILLED';

const TERMINAL: ReadonlySet<AgentStatus> = new Set(['COMPLETED', 'FAILED', 'KILLED']);
const ACTIVE: ReadonlySet<AgentStatus> = new Set(['SPAWNED', 'STREAMING', 'REFINING']);

export function isTerminalStatus(s: AgentStatus): boolean {
  return TERMINAL.has(s);
}

export function isActiveStatus(s: AgentStatus): boolean {
  return ACTIVE.has(s);
}

// ---------------------------------------------------------------------------
// Zod schemas (single source of truth — derive TS types via z.infer)
// ---------------------------------------------------------------------------

export const agentDefSchema = z.object({
  name: z.string().min(1),
  costBadge: z.string().default(''),
  description: z.string().default(''),
  cmdTemplate: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

export const tierSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  color: z.string().default('white'),
  costBadge: z.string().default(''),
  agentKey: z.string().min(1),
  maxWords: z.number().int().nonnegative().nullable().default(null),
  keywords: z.array(z.string()).default([]),
});

export const swarmStageSchema = z.object({
  agentKey: z.string().min(1),
  name: z.string().min(1),
  cmd: z.string().min(1),
});

export const swarmSubagentSchema = z.object({
  id: z.string().min(1),
  agentKey: z.string().min(1),
  name: z.string().min(1),
  taskTemplate: z.string().min(1),
});

export const swarmSchema = z.discriminatedUnion('type', [
  z.object({
    name: z.string().min(1),
    type: z.literal('sequential'),
    stages: z.array(swarmStageSchema).min(1),
  }),
  z.object({
    name: z.string().min(1),
    type: z.literal('parallel'),
    subagents: z.array(swarmSubagentSchema).min(1),
  }),
]);

export const promptEngineerSchema = z.object({
  enabled: z.boolean().default(true),
  agentKey: z.string().min(1),
  systemPrompt: z.string().default(''),
  timeoutMs: z.number().int().positive().default(30000),
});

export const polycodeConfigSchema = z.object({
  $schema: z.string().optional(),
  defaultMode: z.string().default('smart-auto'),
  promptEngineer: promptEngineerSchema.default({
    enabled: true,
    agentKey: 'copilot',
    systemPrompt: '',
    timeoutMs: 30000,
  }),
  agents: z.record(z.string(), agentDefSchema).default({}),
  tiers: z.array(tierSchema).default([]),
  swarms: z.record(z.string(), swarmSchema).default({}),
});

export type AgentDef = z.infer<typeof agentDefSchema>;
export type Tier = z.infer<typeof tierSchema>;
export type SwarmStage = z.infer<typeof swarmStageSchema>;
export type SwarmSubagent = z.infer<typeof swarmSubagentSchema>;
export type Swarm = z.infer<typeof swarmSchema>;
export type PromptEngineer = z.infer<typeof promptEngineerSchema>;
export type PolycodeConfig = z.infer<typeof polycodeConfigSchema>;

// ---------------------------------------------------------------------------
// Runtime types (not config)
// ---------------------------------------------------------------------------

export type LogStream = 'stdout' | 'stderr' | 'system';

export interface LogLine {
  stream: LogStream;
  text: string;
  timestamp: number;
}

export interface AgentInstance {
  id: string;
  name: string;
  agentKey: string;
  costBadge: string;
  status: AgentStatus;
  command: string;
  pid: number | null;
  startedAt: number | null;
  endedAt: number | null;
  exitCode: number | null;
  logs: LogLine[];
}

/** Commands arrive fully substituted — the manager never does templating. */
export interface JobSpec {
  id: string;
  agentKey: string;
  name: string;
  costBadge: string;
  command: string;
  refine?: boolean;
}

export interface CopilotResult {
  rawPrompt: string;
  optimizedPrompt: string;
  rawTokens: number;
  optimizedTokens: number;
  savedPercent: number;
  fallback: boolean;
  error?: string;
  durationMs: number;
}

export interface RouteResult {
  tier: string;
  agentKey: string;
  agentName: string;
  confidence: 'high' | 'low';
  reasons: string[];
}

/** Multi-agent dispatch plan from smartDispatch(). */
export interface DispatchPlan {
  agents: Array<{ agentKey: string; reason: string }>;
  parallel: boolean;
  overallReason: string;
}

/** Error type for genuine configuration bugs the user must fix. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface RunOptions {
  cwd?: string;
}