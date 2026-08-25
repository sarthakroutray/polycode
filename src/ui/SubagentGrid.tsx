import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { AgentInstance } from '../types.js';
import { STATUS_COLOR, elapsed } from './shared.js';

const STATUS_LABEL: Record<string, string> = {
  IDLE: 'idle',
  REFINING: 'refining',
  SPAWNED: 'spawned',
  STREAMING: 'streaming',
  COMPLETED: 'done',
  FAILED: 'failed',
  KILLED: 'killed',
};

interface Props {
  instances: AgentInstance[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function SubagentGrid({ instances, selectedId, onSelect }: Props) {
  const [now, setNow] = useState(Date.now());

  const hasActive = instances.some((i) =>
    ['SPAWNED', 'STREAMING', 'REFINING'].includes(i.status),
  );

  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasActive]);

  if (instances.length === 0) return null;

  return (
    <Box flexDirection="column">
      {instances.map((inst) => {
        const sel = inst.id === selectedId;
        return (
          <Box key={inst.id} paddingLeft={2}>
            <Text color={sel ? 'cyan' : 'gray'}>{sel ? '› ' : '  '}</Text>
            <Box width={16}>
              <Text bold={sel}>{inst.name}</Text>
            </Box>
            <Box width={8}>
              <Text dimColor>{inst.costBadge || '·'}</Text>
            </Box>
            <Box width={12}>
              <Text color={STATUS_COLOR[inst.status]}>
                {STATUS_LABEL[inst.status] ?? inst.status}
              </Text>
            </Box>
            <Text dimColor>{elapsed(inst.startedAt, now)}</Text>
          </Box>
        );
      })}
    </Box>
  );
}