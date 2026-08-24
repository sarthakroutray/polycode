import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { AgentInstance } from '../types.js';
import { STATUS_COLOR, elapsed } from './shared.js';

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

  if (instances.length === 0) return <Box />;
  const half = Math.ceil(instances.length / 2);
  const left = instances.slice(0, half);
  const right = instances.slice(half);

  const Tile = ({ inst }: { inst: AgentInstance }) => {
    const selected = inst.id === selectedId;
    return (
      <Box borderStyle={selected ? 'round' : 'round'} borderColor={selected ? 'cyan' : 'gray'}>
        <Box flexDirection="column" paddingX={1} flexGrow={1}>
          <Box justifyContent="space-between">
            <Text bold>{inst.name}</Text>
            <Text dimColor>{inst.costBadge ? `[${inst.costBadge}] ` : ''}{elapsed(inst.startedAt, now)}</Text>
          </Box>
          <Text color={STATUS_COLOR[inst.status]}>{inst.status}</Text>
        </Box>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row">
        <Box flexDirection="column" flexGrow={1}>
          {left.map((i) => (
            <Tile key={i.id} inst={i} />
          ))}
        </Box>
        <Box width={1} />
        <Box flexDirection="column" flexGrow={1}>
          {right.map((i) => (
            <Tile key={i.id} inst={i} />
          ))}
        </Box>
      </Box>
    </Box>
  );
}