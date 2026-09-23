/**
 * Plus task state, status formatting and command parsing tests.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_PLUS_CONFIG } from '../../src/index.js';
import {
  PlusTaskState,
  formatPlusStatus,
  formatRiskReport,
} from '../../src/plus/task-state.js';
import {
  SMART_ROUTER_FULL_INVOCATIONS,
  SMART_ROUTER_USAGE,
} from '../../.pi/extensions/smart-router/commands.js';
import {
  formatPlusStatusMessage,
  formatRiskMessage,
  parseSmartRouterArgs,
} from '../../.pi/extensions/smart-router/command-formatters.js';
import type { SmartRouterRuntime } from '../../.pi/extensions/smart-router/types.js';

function fakeRuntime(plus?: unknown): SmartRouterRuntime {
  return { plus } as unknown as SmartRouterRuntime;
}

describe('Plus task state', () => {
  it('starts empty and records risk per session', () => {
    const state = new PlusTaskState();
    expect(state.size).toBe(0);
    expect(state.get('s1')).toBeUndefined();

    state.recordRisk('s1', { level: 'high', reasons: ['force push'] }, {
      sessionId: 's1',
      turnType: 'planning',
      planningForced: true,
    });

    const snapshot = state.get('s1');
    expect(snapshot?.risk).toEqual({ level: 'high', reasons: ['force push'] });
    expect(snapshot?.planningForced).toBe(true);
    expect(snapshot?.turnType).toBe('planning');
    expect(state.get('other')).toBeUndefined();
    expect(state.size).toBe(1);
  });

  it('records routing decisions and planning-guard status', () => {
    const state = new PlusTaskState();
    state.recordRisk('s1', { level: 'low', reasons: [] });
    state.recordDecision('s1', {
      stage: 'turn_envelope',
      reasonCode: 'planning_delegate',
      selectedModelId: 'claude-haiku',
    });
    state.recordPlanningGuard('s1', true);

    const snapshot = state.get('s1');
    expect(snapshot?.routeStage).toBe('turn_envelope');
    expect(snapshot?.reasonCode).toBe('planning_delegate');
    expect(snapshot?.selectedModelId).toBe('claude-haiku');
    expect(snapshot?.planningReadOnlyApplied).toBe(true);
  });

  it('clears one session or everything', () => {
    const state = new PlusTaskState();
    state.recordRisk('a', { level: 'low', reasons: [] });
    state.recordRisk('b', { level: 'low', reasons: [] });

    state.clear('a');
    expect(state.get('a')).toBeUndefined();
    expect(state.get('b')).toBeDefined();

    state.clear();
    expect(state.size).toBe(0);
  });

  it('returns defensive copies', () => {
    const state = new PlusTaskState();
    state.recordRisk('s1', { level: 'high', reasons: ['force push'] });
    const snapshot = state.get('s1');
    expect(snapshot).toBeDefined();
    expect(state.get('s1')).not.toBe(snapshot);
  });
});

describe('Plus status formatting', () => {
  it('reports the documented four flags on the first lines', () => {
    const lines = formatPlusStatus(DEFAULT_PLUS_CONFIG).split('\n');
    expect(lines.slice(0, 4)).toEqual([
      'Risk Guard: ON',
      'Planner Read-only: ON',
      'Verification: OFF',
      'Reviewer: OFF',
    ]);
  });

  it('reports disabled flags', () => {
    const text = formatPlusStatus({
      riskGuard: false,
      plannerReadOnly: false,
      verification: true,
      reviewer: true,
    });
    expect(text).toContain('Risk Guard: OFF');
    expect(text).toContain('Planner Read-only: OFF');
    expect(text).toContain('Verification: ON');
    expect(text).toContain('Reviewer: ON');
  });

  it('appends last-task detail when available', () => {
    const text = formatPlusStatus(DEFAULT_PLUS_CONFIG, {
      taskId: 's1',
      sessionId: 's1',
      risk: { level: 'high', reasons: ['force push', 'production deployment'] },
      turnType: 'planning',
      routeStage: 'turn_envelope',
      reasonCode: 'planning_delegate',
      selectedModelId: 'claude-haiku',
      planningForced: true,
      planningReadOnlyApplied: true,
      updatedAt: new Date(0).toISOString(),
    });
    expect(text).toContain('Last task risk: HIGH');
    expect(text).toContain('Reasons: force push, production deployment');
    expect(text).toContain('Planning forced: yes');
    expect(text).toContain('Planner read-only applied: yes');
  });

  it('renders the risk report with reasons', () => {
    expect(
      formatRiskReport({
        taskId: 's1',
        sessionId: 's1',
        risk: { level: 'high', reasons: ['production deployment', 'force push'] },
        turnType: 'planning',
        routeStage: null,
        reasonCode: null,
        selectedModelId: null,
        planningForced: false,
        planningReadOnlyApplied: false,
        updatedAt: new Date(0).toISOString(),
      }),
    ).toBe('Risk: HIGH\n\nReasons:\n- production deployment\n- force push');
  });

  it('renders a LOW risk report when no task has been seen', () => {
    expect(formatRiskReport()).toBe('Risk: LOW\n\nReasons:\n- (none)');
  });
});

describe('Plus command parsing', () => {
  it('parses plus-status and risk', () => {
    expect(parseSmartRouterArgs('plus-status')).toEqual({ command: 'plus-status' });
    expect(parseSmartRouterArgs('risk')).toEqual({ command: 'risk' });
  });

  it('rejects trailing arguments', () => {
    expect(() => parseSmartRouterArgs('plus-status now')).toThrow(/Usage:/);
    expect(() => parseSmartRouterArgs('risk high')).toThrow(/Usage:/);
  });

  it('documents the new subcommands in usage text', () => {
    expect(SMART_ROUTER_USAGE).toContain('plus-status');
    expect(SMART_ROUTER_USAGE).toContain('risk');
  });

  it('keeps completions and parsing in sync for every invocation', () => {
    for (const invocation of SMART_ROUTER_FULL_INVOCATIONS) {
      expect(() => parseSmartRouterArgs(invocation)).not.toThrow();
    }
  });
});

describe('Plus command formatting against a runtime', () => {
  it('formats plus-status for a runtime without a Plus layer', () => {
    const lines = formatPlusStatusMessage(fakeRuntime(), 's1').split('\n');
    expect(lines.slice(0, 4)).toEqual([
      'Risk Guard: ON',
      'Planner Read-only: ON',
      'Verification: OFF',
      'Reviewer: OFF',
    ]);
  });

  it('formats plus-status and risk from a wired Plus runtime', () => {
    const state = new PlusTaskState();
    state.recordRisk('s1', { level: 'high', reasons: ['force push'] }, {
      sessionId: 's1',
      planningForced: true,
    });
    const runtime = fakeRuntime({ config: DEFAULT_PLUS_CONFIG, taskState: state });

    expect(formatPlusStatusMessage(runtime, 's1')).toContain('Last task risk: HIGH');
    expect(formatRiskMessage(runtime, 's1')).toBe('Risk: HIGH\n\nReasons:\n- force push');
  });
});
