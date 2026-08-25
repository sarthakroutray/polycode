import type { PolycodeConfig, RouteResult, DispatchPlan } from './types.js';
import { ConfigError } from './types.js';

function wordCount(prompt: string): number {
  const trimmed = prompt.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Route a prompt to a tier. Scoring per tier: +2 per distinct keyword found
 * (case-insensitive substring on lowercase prompt); +1 if maxWords != null and
 * wordCount <= maxWords. Ties break toward the LATER tier in the array
 * (config lists low→high, so later = stronger). If every tier scores 0, return
 * the middle-index tier at low confidence.
 */
export function route(prompt: string, config: PolycodeConfig): RouteResult {
  const tiers = config.tiers;
  if (!tiers.length) {
    throw new ConfigError('No tiers defined in config. Add at least one tier.');
  }

  const lower = prompt.toLowerCase();
  let bestIdx = 0;
  let bestScore = -1;
  const scored: number[] = [];

  tiers.forEach((tier, i) => {
    const seen = new Set<string>();
    let score = 0;
    for (const kw of tier.keywords) {
      const k = kw.toLowerCase();
      if (k && !seen.has(k) && lower.includes(k)) {
        seen.add(k);
        score += 2;
      }
    }
    if (tier.maxWords != null && wordCount(prompt) <= tier.maxWords) {
      score += 1;
    }
    scored.push(score);
    // Strictly-greater keeps the first (lowest) tier as initial best; use >=
    // so later tiers win ties.
    if (score >= bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  });

  const anySignal = scored.some((s) => s > 0);
  if (!anySignal) {
    // Zero signals: middle-tier default.
    bestIdx = Math.floor(tiers.length / 2);
    const tier = tiers[bestIdx];
    return {
      tier: tier.id,
      agentKey: tier.agentKey,
      agentName: tier.name,
      confidence: 'low',
      reasons: ['no signals; balanced default'],
    };
  }

  const tier = tiers[bestIdx];
  const reasons: string[] = [];
  scored[bestIdx] && reasons.push(`score ${scored[bestIdx]}`);
  if (!config.agents[tier.agentKey]) {
    throw new ConfigError(
      `Tier "${tier.id}" references agentKey "${tier.agentKey}" which is missing from config.agents.`,
    );
  }
  return {
    tier: tier.id,
    agentKey: tier.agentKey,
    agentName: tier.name,
    confidence: 'high',
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Smart dispatch — scores ALL agents, decides single vs parallel
// ---------------------------------------------------------------------------

interface AgentScore {
  agentKey: string;
  score: number;
  matchedTags: string[];
}

function scoreAgent(prompt: string, agentKey: string, config: PolycodeConfig): AgentScore {
  const agent = config.agents[agentKey];
  if (!agent) return { agentKey, score: 0, matchedTags: [] };

  const lower = prompt.toLowerCase();
  const words = new Set(lower.split(/\s+/));
  const matchedTags: string[] = [];
  let score = 0;

  // +3 per tag match (exact word or substring)
  for (const tag of agent.tags) {
    const t = tag.toLowerCase();
    if (words.has(t) || lower.includes(t)) {
      score += 3;
      matchedTags.push(tag);
    }
  }

  // +1 per description keyword that appears in prompt (up to 3)
  const descWords = agent.description.toLowerCase().split(/\s+/);
  const descHits = new Set<string>();
  for (const dw of descWords) {
    if (dw.length > 3 && (words.has(dw) || lower.includes(dw))) {
      descHits.add(dw);
    }
    if (descHits.size >= 3) break;
  }
  score += descHits.size;

  return { agentKey, score, matchedTags };
}

/**
 * Intelligent multi-agent dispatch. Scores every agent in the config against
 * the prompt using tags and description keywords. Returns a DispatchPlan:
 * - Single agent if one clearly dominates (score > 2x second place)
 * - Parallel agents if multiple score similarly (within 60% of top)
 * - Falls back to tier-based route() if no agent tags match
 */
export function smartDispatch(prompt: string, config: PolycodeConfig): DispatchPlan {
  const agentKeys = Object.keys(config.agents);
  if (!agentKeys.length) {
    throw new ConfigError('No agents defined in config.');
  }

  // Score every agent
  const scores = agentKeys
    .map((key) => scoreAgent(prompt, key, config))
    .filter((s) => s.agentKey !== config.promptEngineer.agentKey) // exclude copilot
    .sort((a, b) => b.score - a.score);

  // No tags matched anything — fall back to tier-based routing
  if (scores.length === 0 || scores[0].score === 0) {
    const fallback = route(prompt, config);
    return {
      agents: [{ agentKey: fallback.agentKey, reason: `tier fallback: ${fallback.reasons.join(', ')}` }],
      parallel: false,
      overallReason: 'no agent tags matched; used tier routing',
    };
  }

  const top = scores[0];
  const second = scores[1];

  // Clear winner: top score > 2x second place
  if (!second || top.score > second.score * 2) {
    return {
      agents: [{ agentKey: top.agentKey, reason: `best match: tags [${top.matchedTags.join(', ')}]` }],
      parallel: false,
      overallReason: `single agent "${top.agentKey}" clearly best (score ${top.score})`,
    };
  }

  // Multiple agents scored similarly — pick those within 60% of top
  const threshold = top.score * 0.6;
  const parallel = scores.filter((s) => s.score >= threshold && s.score > 0);

  if (parallel.length === 1) {
    return {
      agents: [{ agentKey: parallel[0].agentKey, reason: `best match: tags [${parallel[0].matchedTags.join(', ')}]` }],
      parallel: false,
      overallReason: `single agent "${parallel[0].agentKey}" after filtering`,
    };
  }

  // Cap at 4 parallel agents to avoid overload
  const selected = parallel.slice(0, 4);
  return {
    agents: selected.map((s) => ({
      agentKey: s.agentKey,
      reason: `tags [${s.matchedTags.join(', ')}] score ${s.score}`,
    })),
    parallel: true,
    overallReason: `${selected.length} agents scored similarly (top ${top.score}, threshold ${Math.round(threshold)})`,
  };
}