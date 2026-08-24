import type { AgentStatus } from '../types.js';

/** Ink `color` prop per agent status. */
export const STATUS_COLOR: Record<AgentStatus, string> = {
  IDLE: 'gray',
  REFINING: 'cyan',
  SPAWNED: 'yellow',
  STREAMING: 'green',
  COMPLETED: 'green',
  FAILED: 'red',
  KILLED: 'yellowBright',
};

export function elapsed(startedAt: number | null, now = Date.now()): string {
  if (startedAt == null) return '0:00';
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

export function truncate(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length <= width) return text;
  return text.slice(0, Math.max(0, width - 1)) + '…';
}