import type { PolycodeConfig, RouteResult } from './types.js';
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