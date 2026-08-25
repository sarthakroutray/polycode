import React from 'react';
import { Box, Text } from 'ink';
import type { CopilotResult } from '../types.js';
import { truncate } from './shared.js';

interface Props {
  result: CopilotResult;
  columns: number;
}

export function CopilotView({ result, columns }: Props) {
  const w = Math.max(40, columns - 6);
  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>  </Text>
        {result.fallback ? (
          <Text color="yellow">copilot: fallback — raw prompt used</Text>
        ) : (
          <Text>
            <Text color="cyan">copilot:</Text>{' '}
            {result.rawTokens}→{result.optimizedTokens} tok
            <Text color="green"> ({result.savedPercent}% saved)</Text>
            <Text dimColor> in {result.durationMs}ms</Text>
          </Text>
        )}
        {result.error ? <Text color="red"> · {result.error}</Text> : null}
      </Box>
      <Box>
        <Text dimColor>    raw: </Text>
        <Text dimColor>{truncate(result.rawPrompt, w - 10)}</Text>
      </Box>
      <Box>
        <Text dimColor>    opt: </Text>
        <Text>{truncate(result.optimizedPrompt, w - 10)}</Text>
      </Box>
    </Box>
  );
}