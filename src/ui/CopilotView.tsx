import React from 'react';
import { Box, Text } from 'ink';
import type { CopilotResult } from '../types.js';

interface Props {
  result: CopilotResult;
  columns: number;
}

function Panel({ title, text }: { title: string; text: string }) {
  return (
    <Box borderStyle="round" flexDirection="column" paddingX={1}>
      <Text bold>{title}</Text>
      <Box flexShrink={0} minHeight={3}>
        <Text wrap="wrap">{text}</Text>
      </Box>
    </Box>
  );
}

export function CopilotView({ result, columns }: Props) {
  const sideBySide = columns >= 110;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection={sideBySide ? 'row' : 'column'} flexGrow={0}>
        <Box width={sideBySide ? '50%' : undefined}>
          <Panel title={`Raw (${result.rawTokens} tok)`} text={result.rawPrompt} />
        </Box>
        {sideBySide ? <Box width={1} /> : null}
        <Box width={sideBySide ? '50%' : undefined}>
          <Panel
            title={`Optimized (${result.optimizedTokens} tok)${result.fallback ? ' — raw' : ''}`}
            text={result.optimizedPrompt}
          />
        </Box>
      </Box>
      <Text dimColor>
        {result.fallback ? (
          <Text color="yellow">⚠ fallback — raw prompt used</Text>
        ) : (
          `optimized in ${result.durationMs}ms`
        )}
        {result.error ? <Text color="red"> ({result.error})</Text> : null}
      </Text>
    </Box>
  );
}