import React from 'react';
import { Box, Text, useStdout } from 'ink';
import type { AgentInstance, LogLine } from '../types.js';
import { truncate } from './shared.js';

const LOG_STYLE: Record<LogLine['stream'], { color?: string; dimColor?: boolean }> = {
  stdout: {},
  stderr: { color: 'red' },
  system: { color: 'cyan', dimColor: true },
};

interface Props {
  instance: AgentInstance | null;
}

export function AgentTerminal({ instance }: Props) {
  const { stdout } = useStdout();
  const height = Math.max(3, (stdout?.rows ?? 14) - 8);
  const visible = height - 2;
  const logs: LogLine[] = instance ? instance.logs.slice(-visible) : [];

  return (
    <Box borderStyle="round" flexDirection="column" height={height} paddingX={1} flexGrow={0}>
      <Text bold dimColor>
        {instance
          ? `$ ${truncate(instance.command, 80)}${
              instance.endedAt != null ? `   [exit ${instance.exitCode ?? '?'}]` : ''
            }`
          : '— no agent selected —'}
      </Text>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {logs.map((l, i) => (
          <Text key={i} {...LOG_STYLE[l.stream]}>
            {l.text}
          </Text>
        ))}
      </Box>
    </Box>
  );
}