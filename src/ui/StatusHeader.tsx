import React from 'react';
import { Box, Text } from 'ink';
import type { AgentInstance } from '../types.js';
import type { CopilotResult, RouteResult } from '../types.js';

interface Props {
  configPath: string | null;
  instances: AgentInstance[];
  copilot: CopilotResult | null;
  route: RouteResult | null;
}

export function StatusHeader({ configPath, instances, copilot, route }: Props) {
  const active = instances.filter((i) =>
    ['SPAWNED', 'STREAMING', 'REFINING'].includes(i.status),
  ).length;

  return (
    <Box>
      <Text bold>polycode</Text>
      <Text dimColor>
        {' '}
        · {configPath ?? 'no config'} · {active}/{instances.length} active
      </Text>
      {copilot && !copilot.fallback ? (
        <Text>
          {' '}
          · <Text color="green">Saved {copilot.savedPercent}%</Text>
          <Text dimColor>
            {' '}
            {copilot.rawTokens}→{copilot.optimizedTokens} tok
          </Text>
        </Text>
      ) : null}
      {route ? (
        <Text>
          {' '}
          · <Text color="cyan">[{route.agentName}]</Text>
        </Text>
      ) : null}
    </Box>
  );
}