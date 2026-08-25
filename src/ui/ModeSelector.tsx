import React from 'react';
import { Box, Text } from 'ink';
import type { PolycodeConfig } from '../types.js';

export interface ModeOption {
  value: string;
  label: string;
}

export function buildModeOptions(config: PolycodeConfig): ModeOption[] {
  const opts: ModeOption[] = [{ value: 'smart-auto', label: 'Smart Auto (route)' }];
  for (const key of Object.keys(config.swarms)) {
    opts.push({ value: `swarm:${key}`, label: `Swarm · ${config.swarms[key].name}` });
  }
  for (const key of Object.keys(config.agents)) {
    opts.push({ value: `manual:${key}`, label: `Manual · ${config.agents[key].name}` });
  }
  return opts;
}

interface Props {
  options: ModeOption[];
  activeIndex: number;
  highlight: number;
  onConfirm: (i: number) => void;
  onCancel: () => void;
}

export function ModeSelector({
  options,
  activeIndex,
  highlight,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text bold>select mode</Text>
      {options.map((o, i) => (
        <Box key={o.value} paddingLeft={2}>
          <Text color={i === highlight ? 'cyan' : 'gray'}>{i === highlight ? '› ' : '  '}</Text>
          <Text color={i === activeIndex ? 'green' : undefined}>{o.label}</Text>
        </Box>
      ))}
      <Text dimColor>  ↑↓ / digits · enter confirm · esc cancel</Text>
    </Box>
  );
}