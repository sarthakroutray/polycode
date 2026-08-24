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
  const active = instances.filter((i) => ['SPAWNED', 'STREAMING', 'REFINING'].includes(i.status)).length;

  return (
    <Box justifyContent="space-between">
      <Text dimColor>polycode · {configPath ? configPath : 'no config'}</Text>
      <Text>
        {active}/{instances.length} active
        {copilot && !copilot.fallback ? (
          <Text>
            {'  '}Saved {copilot.savedPercent}% • {copilot.rawTokens}→{copilot.optimizedTokens} tok
          </Text>
        ) : null}
        {route ? <Text>{'  '}[{route.agentName}]</Text> : null}
      </Text>
    </Box>
  );
}