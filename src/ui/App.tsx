import React, { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { PolycodeConfig, CopilotResult, RouteResult } from '../types.js';
import { AgentManager } from '../agent-manager.js';
import { optimizePrompt, substitutePlaceholders } from '../prompt-copilot.js';
import { route } from '../router.js';
import { saveConfig } from '../config.js';
import { StatusHeader } from './StatusHeader.js';
import { CopilotView } from './CopilotView.js';
import { SubagentGrid } from './SubagentGrid.js';
import { AgentTerminal } from './AgentTerminal.js';
import { ModeSelector, buildModeOptions, type ModeOption } from './ModeSelector.js';
import { ConfigEditor } from './ConfigEditor.js';

interface Props {
  config: PolycodeConfig;
  configPath: string | null;
  manager: AgentManager;
  noCopilot?: boolean;
}

export function App({ config: initialConfig, configPath, manager, noCopilot = false }: Props) {
  const { exit } = useApp();
  const [config, setConfig] = useState<PolycodeConfig>(initialConfig);
  const [inputValue, setInputValue] = useState('');
  const [mode, setMode] = useState<string>(initialConfig.defaultMode);
  const [copilotResult, setCopilotResult] = useState<CopilotResult | null>(null);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [selectedTabIdx, setSelectedTabIdx] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalHighlight, setModalHighlight] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [, setTick] = useState(0);

  // Re-render on every manager mutation.
  useEffect(() => {
    const onChange = () => setTick((n) => n + 1);
    manager.on('change', onChange);
    return () => {
      manager.off('change', onChange);
    };
  }, [manager]);

  const liveInstances = manager.listInstances();
  const selectedIdx = Math.min(selectedTabIdx, Math.max(0, liveInstances.length - 1));
  const selectedInstance = liveInstances[selectedIdx] ?? null;

  const modeOptions: ModeOption[] = buildModeOptions(config);

  /** Dispatch an already-optimized prompt through the given mode. */
  function dispatch(prompt: string, dispatchMode: string) {
    if (dispatchMode === 'smart-auto') {
      let r: RouteResult;
      try {
        r = route(prompt, config);
      } catch (err) {
        const id = manager.register({
          id: 'route-error',
          agentKey: '',
          name: 'Route Error',
          costBadge: '',
          command: String(err),
        });
        const inst = manager.getInstance(id);
        if (inst) {
          inst.status = 'FAILED';
          inst.logs.push({ stream: 'system', text: String(err), timestamp: Date.now() });
          inst.endedAt = Date.now();
        }
        manager.emit('change');
        return;
      }
      setRouteResult(r);
      const agent = config.agents[r.agentKey];
      if (!agent) return;
      const id = manager.register({
        id: r.agentKey,
        agentKey: r.agentKey,
        name: agent.name,
        costBadge: agent.costBadge,
        command: substitutePlaceholders(agent.cmdTemplate, { prompt }),
      });
      void manager.run(id);
      return;
    }

    if (dispatchMode.startsWith('manual:')) {
      const key = dispatchMode.slice('manual:'.length);
      const agent = config.agents[key];
      if (!agent) return;
      const id = manager.register({
        id: `manual-${key}`,
        agentKey: key,
        name: agent.name,
        costBadge: agent.costBadge,
        command: substitutePlaceholders(agent.cmdTemplate, { prompt }),
      });
      void manager.run(id);
      return;
    }

    if (dispatchMode.startsWith('swarm:')) {
      const swarmKey = dispatchMode.slice('swarm:'.length);
      const swarm = config.swarms[swarmKey];
      if (!swarm) return;
      if (swarm.type === 'sequential') {
        const stages = swarm.stages.map((st) => {
          const a = config.agents[st.agentKey];
          return {
            id: `seq-${swarmKey}-${st.name}`,
            agentKey: st.agentKey,
            name: st.name,
            costBadge: a?.costBadge ?? '',
            command: substitutePlaceholders(st.cmd, { prompt }),
          };
        });
        void manager.runSequential(stages);
      } else {
        const jobs = swarm.subagents.map((sb) => {
          const task = substitutePlaceholders(sb.taskTemplate, { prompt });
          const a = config.agents[sb.agentKey];
          const cmd = a ? substitutePlaceholders(a.cmdTemplate, { prompt: task }) : task;
          return {
            id: `par-${sb.id}`,
            agentKey: sb.agentKey,
            name: sb.name,
            costBadge: a?.costBadge ?? '',
            command: cmd,
          };
        });
        void manager.runParallel(jobs);
      }
    }
  }

  function onSubmit(raw: string) {
    if (!raw.trim()) return;
    setInputValue('');
    setCopilotResult(null);
    setRouteResult(null);

    if (!config.promptEngineer.enabled || noCopilot) {
      dispatch(raw, mode);
      return;
    }
    const agent = config.agents[config.promptEngineer.agentKey];
    if (!agent) {
      dispatch(raw, mode);
      return;
    }

    const copilotId = manager.register({
      id: 'copilot',
      agentKey: config.promptEngineer.agentKey,
      name: 'copilot',
      costBadge: 'OPT',
      command: '',
      refine: true,
    });

    void (async () => {
      const result = await optimizePrompt(raw, config, {
        hooks: {
          onState: (status) => {
            const inst = manager.getInstance(copilotId);
            if (inst) {
              inst.status = status as never;
              manager.emit('change');
            }
          },
          onLog: (line, stream) => {
            const inst = manager.getInstance(copilotId);
            if (inst) {
              inst.logs.push({ stream, text: line, timestamp: Date.now() });
              manager.emit('change');
            }
          },
        },
      });
      const inst = manager.getInstance(copilotId);
      if (inst) {
        inst.status = result.fallback ? 'COMPLETED' : 'COMPLETED';
        inst.endedAt = Date.now();
        inst.exitCode = result.fallback ? 1 : 0;
      }
      manager.emit('change');
      setCopilotResult(result);
      dispatch(result.optimizedPrompt, mode);
    })();
  }

  function onConfirmMode() {
    const target = modeOptions[modalHighlight];
    if (target) setMode(target.value);
    setModalOpen(false);
  }

  const activeModeIndex = Math.max(0, modeOptions.findIndex((o) => o.value === mode));

  // Keyboard shortcuts.
  useInput(
    (input, key) => {
      if (modalOpen) {
        if (key.escape) {
          setModalOpen(false);
          return;
        }
        if (key.return) {
          onConfirmMode();
          return;
        }
        if (key.upArrow) {
          setModalHighlight((h) => (h - 1 + modeOptions.length) % modeOptions.length);
          return;
        }
        if (key.downArrow) {
          setModalHighlight((h) => (h + 1) % modeOptions.length);
          return;
        }
        if (/^[0-9]$/.test(input)) {
          const idx = parseInt(input, 10);
          if (idx >= 0 && idx < modeOptions.length) {
            setModalHighlight(idx);
            onConfirmMode();
          }
          return;
        }
        return;
      }

      if (key.ctrl && input === 'c') {
        void (async () => {
          await manager.killAll();
          exit();
        })();
        return;
      }
      if (key.ctrl && input === 'k') {
        void manager.killAll();
        const anyId = manager.listInstances()[0]?.id;
        if (anyId) {
          const first = manager.getInstance(anyId);
          if (first) {
            first.logs.push({ stream: 'system', text: 'swarm killed by user', timestamp: Date.now() });
            first.logs = first.logs.slice(-2000);
          }
        }
        manager.emit('change');
        return;
      }
      if (key.ctrl && input === 'l') {
        manager.clearAllLogs();
        return;
      }
      if (key.ctrl && input === 'm') {
        setModalOpen((o) => !o);
        return;
      }
      if (key.ctrl && input === 'e') {
        setEditorOpen((o) => !o);
        return;
      }
      if (key.tab) {
        const n = liveInstances.length;
        if (n > 0) {
          setSelectedTabIdx((i) => (key.shift ? (i - 1 + n) % n : (i + 1) % n));
        }
        return;
      }
    },
    { isActive: !modalOpen && !editorOpen },
  );

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} minHeight={process.stdout.rows}>
      <StatusHeader
        configPath={configPath}
        instances={liveInstances}
        copilot={copilotResult}
        route={routeResult}
      />
      {copilotResult ? <CopilotView result={copilotResult} columns={process.stdout.columns} /> : null}
      {editorOpen ? (
        <ConfigEditor
          config={config}
          onClose={() => setEditorOpen(false)}
          onSave={(next) => {
            setConfig(next);
            if (configPath) {
              try {
                saveConfig(configPath, next);
              } catch {
                // saveConfig throws on I/O; ConfigEditor shows its own note
              }
            }
          }}
        />
      ) : modalOpen ? (
        <ModeSelector
          options={modeOptions}
          activeIndex={activeModeIndex}
          highlight={modalHighlight}
          onConfirm={onConfirmMode}
          onCancel={() => setModalOpen(false)}
        />
      ) : (
        <>
          <SubagentGrid
            instances={liveInstances}
            selectedId={selectedInstance?.id ?? null}
            onSelect={(id) => {
              const idx = liveInstances.findIndex((i) => i.id === id);
              if (idx >= 0) setSelectedTabIdx(idx);
            }}
          />
          <AgentTerminal instance={selectedInstance} />
        </>
      )}
      <Text dimColor>Enter spawn • Tab switch • ^E config • ^M mode • ^K kill • ^L clear • ^C quit</Text>
      <Box>
        <Text>&gt; </Text>
        <TextInput
          value={inputValue}
          focus={!modalOpen && !editorOpen}
          onChange={(v) => setInputValue(v.replace(/\t/g, ''))}
          onSubmit={onSubmit}
        />
      </Box>
    </Box>
  );
}