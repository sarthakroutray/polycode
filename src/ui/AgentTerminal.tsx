import React from 'react';
import { Box, Text, useStdout } from 'ink';
import type { AgentInstance, LogLine } from '../types.js';
import { truncate } from './shared.js';

interface Props {
  instance: AgentInstance | null;
}

export function AgentTerminal({ instance }: Props) {
  const { stdout } = useStdout();
  const height = Math.max(3, (stdout?.rows ?? 14) - 10);
  const visible = height - 1;
  const logs: LogLine[] = instance ? instance.logs.slice(-visible) : [];

  return (
    <Box flexDirection="column" height={height} paddingLeft={2}>
      <Text dimColor>
        {instance
          ? `$ ${truncate(instance.command, 80)}${
              instance.endedAt != null ? `  [exit ${instance.exitCode ?? '?'}]` : ''
            }`
          : '— no agent selected —'}
      </Text>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {logs.map((l, i) => (
          <Text
            key={i}
            color={l.stream === 'stderr' ? 'red' : l.stream === 'system' ? 'cyan' : undefined}
            dimColor={l.stream === 'system'}
          >
            {l.text}
          </Text>
        ))}
      </Box>
    </Box>
  );
}