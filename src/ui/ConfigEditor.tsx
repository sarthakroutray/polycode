import React, { useMemo, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import TextInput from 'ink-text-input';
import { polycodeConfigSchema } from '../types.js';
import type { PolycodeConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Path helpers — fields are addressed by dotted paths into the draft config.
// ---------------------------------------------------------------------------

function getPath(obj: unknown, path: string): unknown {
  let cur: any = obj;
  for (const seg of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Immutable set: returns a NEW root object with the path updated. */
function setPath(root: PolycodeConfig, path: string, value: unknown): PolycodeConfig {
  const segs = path.split('.');
  const clone = (node: any, i: number): any => {
    if (i === segs.length) return value;
    const key = segs[i];
    const next = Array.isArray(node) ? [...node] : { ...node };
    next[key] = clone(next[key], i + 1);
    return next;
  };
  return clone(root, 0);
}

function uniqueKey(existing: string[], base: string): string {
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// ---------------------------------------------------------------------------
// Row model
// ---------------------------------------------------------------------------

type FieldType = 'string' | 'number' | 'bool' | 'csv';

type Row =
  | { kind: 'section'; label: string }
  | { kind: 'field'; path: string; label: string; type: FieldType }
  | { kind: 'action'; label: string; op: string };

const SECTION_COLOR: Record<string, string> = {
  general: 'cyan',
  agents: 'green',
  tiers: 'yellow',
  swarms: 'magenta',
};

export function buildRows(config: PolycodeConfig): Row[] {
  const rows: Row[] = [];

  rows.push({ kind: 'section', label: 'general' });
  rows.push({ kind: 'field', path: 'defaultMode', label: 'defaultMode', type: 'string' });
  rows.push({ kind: 'field', path: 'promptEngineer.enabled', label: 'copilot enabled', type: 'bool' });
  rows.push({ kind: 'field', path: 'promptEngineer.agentKey', label: 'copilot agent', type: 'string' });
  rows.push({ kind: 'field', path: 'promptEngineer.timeoutMs', label: 'copilot timeoutMs', type: 'number' });
  rows.push({ kind: 'field', path: 'promptEngineer.systemPrompt', label: 'copilot systemPrompt', type: 'string' });

  rows.push({ kind: 'section', label: 'agents' });
  for (const key of Object.keys(config.agents)) {
    rows.push({ kind: 'field', path: `agents.${key}.name`, label: `${key}.name`, type: 'string' });
    rows.push({ kind: 'field', path: `agents.${key}.costBadge`, label: `${key}.costBadge`, type: 'string' });
    rows.push({
      kind: 'field',
      path: `agents.${key}.description`,
      label: `${key}.description`,
      type: 'string',
    });
    rows.push({
      kind: 'field',
      path: `agents.${key}.cmdTemplate`,
      label: `${key}.cmdTemplate`,
      type: 'string',
    });
    rows.push({ kind: 'action', label: `delete agent ${key}`, op: `del-agent:${key}` });
  }
  rows.push({ kind: 'action', label: '+ add agent', op: 'add-agent' });

  rows.push({ kind: 'section', label: 'tiers' });
  config.tiers.forEach((t, i) => {
    rows.push({ kind: 'field', path: `tiers.${i}.id`, label: `tier ${i} id`, type: 'string' });
    rows.push({ kind: 'field', path: `tiers.${i}.name`, label: `tier ${i} name`, type: 'string' });
    rows.push({ kind: 'field', path: `tiers.${i}.color`, label: `tier ${i} color`, type: 'string' });
    rows.push({ kind: 'field', path: `tiers.${i}.costBadge`, label: `tier ${i} costBadge`, type: 'string' });
    rows.push({ kind: 'field', path: `tiers.${i}.agentKey`, label: `tier ${i} agent`, type: 'string' });
    rows.push({ kind: 'field', path: `tiers.${i}.maxWords`, label: `tier ${i} maxWords`, type: 'number' });
    rows.push({
      kind: 'field',
      path: `tiers.${i}.keywords`,
      label: `tier ${i} keywords (csv)`,
      type: 'csv',
    });
    rows.push({ kind: 'action', label: `delete tier ${i}`, op: `del-tier:${i}` });
  });
  rows.push({ kind: 'action', label: '+ add tier', op: 'add-tier' });

  rows.push({ kind: 'section', label: 'swarms' });
  for (const key of Object.keys(config.swarms)) {
    const swarm = config.swarms[key];
    rows.push({ kind: 'field', path: `swarms.${key}.name`, label: `${key}.name (${swarm.type})`, type: 'string' });
    if (swarm.type === 'sequential') {
      swarm.stages.forEach((st, i) => {
        rows.push({
          kind: 'field',
          path: `swarms.${key}.stages.${i}.name`,
          label: `${key}.stage${i}.name`,
          type: 'string',
        });
        rows.push({
          kind: 'field',
          path: `swarms.${key}.stages.${i}.agentKey`,
          label: `${key}.stage${i}.agent`,
          type: 'string',
        });
        rows.push({
          kind: 'field',
          path: `swarms.${key}.stages.${i}.cmd`,
          label: `${key}.stage${i}.cmd`,
          type: 'string',
        });
        rows.push({ kind: 'action', label: `delete ${key} stage ${i}`, op: `del-stage:${key}:${i}` });
      });
      rows.push({ kind: 'action', label: `+ add ${key} stage`, op: `add-stage:${key}` });
    } else {
      swarm.subagents.forEach((sb, i) => {
        rows.push({
          kind: 'field',
          path: `swarms.${key}.subagents.${i}.name`,
          label: `${key}.sub${i}.name`,
          type: 'string',
        });
        rows.push({
          kind: 'field',
          path: `swarms.${key}.subagents.${i}.agentKey`,
          label: `${key}.sub${i}.agent`,
          type: 'string',
        });
        rows.push({
          kind: 'field',
          path: `swarms.${key}.subagents.${i}.taskTemplate`,
          label: `${key}.sub${i}.taskTemplate`,
          type: 'string',
        });
        rows.push({ kind: 'action', label: `delete ${key} sub ${i}`, op: `del-sub:${key}:${i}` });
      });
      rows.push({ kind: 'action', label: `+ add ${key} subagent`, op: `add-sub:${key}` });
    }
    rows.push({ kind: 'action', label: `delete swarm ${key}`, op: `del-swarm:${key}` });
  }
  rows.push({ kind: 'action', label: '+ add swarm (parallel)', op: 'add-swarm' });

  return rows;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function agentRefs(config: PolycodeConfig, key: string): string[] {
  const refs: string[] = [];
  if (config.promptEngineer.agentKey === key) refs.push('promptEngineer');
  config.tiers.forEach((t) => {
    if (t.agentKey === key) refs.push(`tier "${t.id}"`);
  });
  for (const [sk, sw] of Object.entries(config.swarms)) {
    if (sw.type === 'sequential') {
      sw.stages.forEach((st, i) => {
        if (st.agentKey === key) refs.push(`swarm "${sk}" stage ${i}`);
      });
    } else {
      sw.subagents.forEach((sb, i) => {
        if (sb.agentKey === key) refs.push(`swarm "${sk}" sub ${i}`);
      });
    }
  }
  return refs;
}

function applyAction(config: PolycodeConfig, op: string): { config: PolycodeConfig; note?: string } {
  const [verb, arg1, arg2] = op.split(':');
  switch (verb) {
    case 'add-agent': {
      const key = uniqueKey(Object.keys(config.agents), 'new-agent');
      return {
        config: setPath(config, `agents.${key}`, {
          name: key,
          costBadge: '',
          description: '',
          cmdTemplate: 'echo "{prompt}"',
        }),
        note: `added agent "${key}"`,
      };
    }
    case 'del-agent': {
      const refs = agentRefs(config, arg1);
      if (refs.length) {
        return { config, note: `cannot delete "${arg1}" — referenced by ${refs.join(', ')}` };
      }
      const agents = { ...config.agents };
      delete agents[arg1];
      return { config: { ...config, agents }, note: `deleted agent "${arg1}"` };
    }
    case 'add-tier': {
      const t = {
        id: uniqueKey(config.tiers.map((x) => x.id), 'new-tier'),
        name: 'New Tier',
        color: 'white',
        costBadge: '',
        agentKey: Object.keys(config.agents)[0] ?? '',
        maxWords: null,
        keywords: [] as string[],
      };
      return { config: { ...config, tiers: [...config.tiers, t] }, note: `added tier "${t.id}"` };
    }
    case 'del-tier': {
      const i = Number(arg1);
      return {
        config: { ...config, tiers: config.tiers.filter((_, j) => j !== i) },
        note: `deleted tier ${i}`,
      };
    }
    case 'add-swarm': {
      const key = uniqueKey(Object.keys(config.swarms), 'new-swarm');
      const firstAgent = Object.keys(config.agents)[0] ?? '';
      return {
        config: setPath(config, `swarms.${key}`, {
          name: key,
          type: 'parallel',
          subagents: [
            { id: 'sub-1', agentKey: firstAgent, name: 'Subagent 1', taskTemplate: '{prompt}' },
          ],
        }),
        note: `added swarm "${key}"`,
      };
    }
    case 'del-swarm': {
      const swarms = { ...config.swarms };
      delete swarms[arg1];
      return { config: { ...config, swarms }, note: `deleted swarm "${arg1}"` };
    }
    case 'add-stage': {
      const swarm = config.swarms[arg1];
      if (!swarm || swarm.type !== 'sequential') return { config, note: 'not a sequential swarm' };
      const firstAgent = Object.keys(config.agents)[0] ?? '';
      const stages = [
        ...swarm.stages,
        { agentKey: firstAgent, name: `Stage ${swarm.stages.length + 1}`, cmd: 'echo "{prompt}"' },
      ];
      return {
        config: setPath(config, `swarms.${arg1}.stages`, stages),
        note: `added stage to "${arg1}"`,
      };
    }
    case 'del-stage': {
      const swarm = config.swarms[arg1];
      if (!swarm || swarm.type !== 'sequential') return { config };
      return {
        config: setPath(
          config,
          `swarms.${arg1}.stages`,
          swarm.stages.filter((_, j) => j !== Number(arg2)),
        ),
        note: `deleted stage ${arg2} of "${arg1}"`,
      };
    }
    case 'add-sub': {
      const swarm = config.swarms[arg1];
      if (!swarm || swarm.type !== 'parallel') return { config, note: 'not a parallel swarm' };
      const firstAgent = Object.keys(config.agents)[0] ?? '';
      const subs = [
        ...swarm.subagents,
        {
          id: uniqueKey(swarm.subagents.map((s) => s.id), `sub-${swarm.subagents.length + 1}`),
          agentKey: firstAgent,
          name: `Subagent ${swarm.subagents.length + 1}`,
          taskTemplate: '{prompt}',
        },
      ];
      return {
        config: setPath(config, `swarms.${arg1}.subagents`, subs),
        note: `added subagent to "${arg1}"`,
      };
    }
    case 'del-sub': {
      const swarm = config.swarms[arg1];
      if (!swarm || swarm.type !== 'parallel') return { config };
      return {
        config: setPath(
          config,
          `swarms.${arg1}.subagents`,
          swarm.subagents.filter((_, j) => j !== Number(arg2)),
        ),
        note: `deleted sub ${arg2} of "${arg1}"`,
      };
    }
    default:
      return { config };
  }
}

/** Convert raw text-input content to a field value by type. */
function coerce(type: FieldType, raw: string): { ok: true; value: unknown } | { ok: false; why: string } {
  switch (type) {
    case 'string':
      return { ok: true, value: raw };
    case 'number': {
      const t = raw.trim();
      if (t === '') return { ok: true, value: null };
      const n = Number(t);
      if (!Number.isFinite(n)) return { ok: false, why: `"${raw}" is not a number` };
      return { ok: true, value: Math.trunc(n) };
    }
    case 'bool':
      return { ok: true, value: raw === 'true' };
    case 'csv':
      return { ok: true, value: raw.split(',').map((s) => s.trim()).filter(Boolean) };
  }
}

function displayValue(type: FieldType, value: unknown): string {
  if (value == null) return type === 'number' ? '(null)' : '';
  if (type === 'bool') return String(value);
  if (type === 'csv') return Array.isArray(value) ? value.join(', ') : String(value);
  return String(value);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  config: PolycodeConfig;
  onClose: () => void;
  onSave: (next: PolycodeConfig) => void;
}

export function ConfigEditor({ config, onClose, onSave }: Props) {
  const { stdout } = useStdout();
  const rows = useMemo(() => buildRows(config), [config]);
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState<{ row: number; seed: string } | null>(null);
  const [draft, setDraft] = useState<PolycodeConfig>(config);
  const [note, setNote] = useState('');

  const height = Math.max(8, (stdout?.rows ?? 24) - 9);
  const width = stdout?.columns ?? 80;

  // Windowed scroll around the cursor.
  let start = 0;
  if (rows.length > height) {
    start = Math.min(Math.max(0, cursor - Math.floor(height / 2)), rows.length - height);
  }
  const visible = rows.slice(start, start + height);

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  function move(delta: number) {
    setCursor((c) => Math.min(rows.length - 1, Math.max(0, c + delta)));
  }

  function beginEdit(idx: number) {
    const row = rows[idx];
    if (!row) return;
    if (row.kind === 'section') return;
    if (row.kind === 'action') {
      run(row.op);
      return;
    }
    if (row.type === 'bool') {
      const next = !getPath(draft, row.path);
      setDraft(setPath(draft, row.path, next));
      setNote(`${row.path} → ${next}`);
      return;
    }
    setEditing({ row: idx, seed: displayValue(row.type, getPath(draft, row.path)) });
  }

  function run(op: string) {
    const res = applyAction(draft, op);
    setDraft(res.config);
    setNote(res.note ?? op);
  }

  function commitEdit(raw: string) {
    if (!editing) return;
    const row = rows[editing.row];
    setEditing(null);
    if (!row || row.kind !== 'field') return;
    const coerced = coerce(row.type, raw);
    if (!coerced.ok) {
      setNote(coerced.why);
      return;
    }
    setDraft(setPath(draft, row.path, coerced.value));
    setNote(`${row.path} → ${row.type === 'csv' ? `[${(coerced.value as string[]).join(', ')}]` : String(coerced.value)}`);
  }

  function save() {
    const parsed = polycodeConfigSchema.safeParse(draft);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setNote(`invalid: ${issue.path.join('.') || '(root)'} — ${issue.message}`);
      return;
    }
    onSave(parsed.data);
    setDraft(parsed.data);
    setNote('saved ✓');
  }

  React.useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={dirty ? 'yellow' : 'gray'} paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color={dirty ? 'yellow' : undefined}>
          config editor{dirty ? ' (unsaved changes)' : ''}
        </Text>
        <Text dimColor>j/k or ↑↓ move · enter edit/toggle · ctrl+s save · esc close</Text>
      </Box>
      <Box flexDirection="column" height={height}>
        {visible.map((row, vi) => {
          const idx = start + vi;
          const active = idx === cursor;
          if (row.kind === 'section') {
            return (
              <Box key={`s:${row.label}`} marginTop={idx === 0 ? 0 : 1}>
                <Text bold color={SECTION_COLOR[row.label] ?? 'white'}>
                  ── {row.label}
                </Text>
              </Box>
            );
          }
          if (row.kind === 'action') {
            return (
              <Box key={`a:${row.op}`} paddingLeft={2}>
                <Text color={active ? 'cyan' : 'gray'}>{active ? '› ' : '  '}{row.label}</Text>
              </Box>
            );
          }
          const value = displayValue(row.type, getPath(draft, row.path));
          const isEditing = editing?.row === idx;
          return (
            <Box key={`f:${row.path}`} paddingLeft={2}>
              <Text color={active ? 'cyan' : 'gray'}>{active ? '› ' : '  '}</Text>
              <Box width={Math.min(34, Math.floor(width * 0.4))} flexShrink={0}>
                <Text>{row.label}</Text>
              </Box>
              {isEditing ? (
                <TextInput value={editing.seed} onChange={() => {}} onSubmit={commitEdit} focus />
              ) : (
                <Text
                  color={
                    row.type === 'bool'
                      ? value === 'true'
                        ? 'green'
                        : 'red'
                      : value === '' || value === '(null)'
                        ? 'dim'
                        : undefined
                  }
                >
                  {row.type === 'bool'
                    ? value === 'true'
                      ? '[✓] yes'
                      : '[ ] no'
                    : value === ''
                      ? '(empty)'
                      : truncate(value, Math.max(10, width - 44))}
                </Text>
              )}
            </Box>
          );
        })}
      </Box>
      <Box justifyContent="space-between">
        <Text dimColor>
          {cursor + 1}/{rows.length}
          {dirty ? ' · ctrl+s to write file' : ''}
        </Text>
        <Text color="yellow" dimColor={!note}>{truncate(note, Math.max(20, width - 30))}</Text>
      </Box>
    </Box>
  );
}

function truncate(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length <= width) return text;
  return text.slice(0, Math.max(0, width - 1)) + '…';
}

/**
 * Keyboard handling for the editor lives outside the component body (called
 * from App's useInput) because ink delivers every keystroke to ALL active
 * useInput handlers — centralizing avoids double-handling with TextInput.
 */
export function handleEditorKeys(
  input: string,
  key: { upArrow?: boolean; downArrow?: boolean; escape?: boolean; return?: boolean; tab?: boolean; shift?: boolean; ctrl?: boolean },
  api: {
    editing: boolean;
    cursor: number;
    rowCount: number;
    moveCursor(delta: number): void;
    beginEdit(): void;
    save(): void;
    close(): void;
  },
): void {
  if (api.editing) {
    // While a TextInput owns the keyboard we only intercept escapes/saves;
    // printable keys and Enter flow through to ink-text-input.
    if (key.ctrl && input === 's') api.save();
    if (key.escape) api.close();
    return;
  }
  if (key.ctrl && input === 's') {
    api.save();
    return;
  }
  if (key.escape) {
    api.close();
    return;
  }
  if (key.upArrow) {
    api.moveCursor(-1);
    return;
  }
  if (key.downArrow) {
    api.moveCursor(1);
    return;
  }
  if (input === 'k') {
    api.moveCursor(-1);
    return;
  }
  if (input === 'j') {
    api.moveCursor(1);
    return;
  }
  if (key.tab) {
    api.moveCursor(key.shift ? -5 : 5);
    return;
  }
  if (key.return) {
    api.beginEdit();
  }
}