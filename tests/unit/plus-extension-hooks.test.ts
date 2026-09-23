/**
 * Plus extension wiring tests.
 *
 * The planner read-only guard must be enforced at the tool layer through pi's
 * `tool_call` hook, and Risk Guard must record/notify on HIGH-risk tool calls.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { wireSmartRouterExtension } from '../../.pi/extensions/smart-router/extension-setup.js';
import type {
  SmartRouterRuntime,
  StreamDelegationDeps,
} from '../../.pi/extensions/smart-router/types.js';
import { DEFAULT_PLUS_CONFIG, createPlusRuntime } from '../../src/index.js';

type ToolCallHandler = (
  event: { toolName: string; input: Record<string, unknown> },
  ctx: unknown,
) => { block?: boolean; reason?: string } | undefined;

const FULL_TOOLS = ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'];

function createHarness() {
  const hooks = new Map<string, ToolCallHandler>();
  let active = [...FULL_TOOLS];
  const provider = vi.fn();
  const command = vi.fn();

  const pi = {
    registerProvider: provider,
    registerCommand: command,
    on: (event: string, handler: ToolCallHandler) => {
      hooks.set(event, handler);
    },
    getActiveTools: () => [...active],
    setActiveTools: (toolNames: string[]) => {
      active = [...toolNames];
    },
  };

  const plus = createPlusRuntime({ config: DEFAULT_PLUS_CONFIG });
  const runtime = {
    plus,
    setLmuStatus: undefined,
    sessionPinner: {},
    streamDeps: {} as StreamDelegationDeps,
  } as unknown as SmartRouterRuntime;

  const notify = vi.fn();
  const ctx = {
    sessionManager: { getSessionId: () => 'session-1' },
    ui: { notify },
  };

  return { pi, plus, runtime, notify, ctx, hooks, active: () => active };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Plus extension wiring', () => {
  it('registers the tool_call hook and binds pi tool permissions', async () => {
    const harness = createHarness();
    await wireSmartRouterExtension(
      harness.pi as never,
      harness.runtime,
      { fn: undefined },
    );

    expect(harness.hooks.has('tool_call')).toBe(true);

    harness.plus.plannerGuard.enter('session-1');
    expect(harness.active()).toEqual(['read', 'grep', 'find', 'ls']);
    harness.plus.plannerGuard.exit('session-1');
    expect(harness.active()).toEqual(FULL_TOOLS);
  });

  it('allows write tools outside the planner window', async () => {
    const harness = createHarness();
    await wireSmartRouterExtension(harness.pi as never, harness.runtime, {
      fn: undefined,
    });
    const handler = harness.hooks.get('tool_call')!;

    const result = handler({ toolName: 'write', input: { path: 'a.ts' } }, harness.ctx);

    expect(result).toBeUndefined();
  });

  it('blocks write tools while the planner window is open', async () => {
    const harness = createHarness();
    await wireSmartRouterExtension(harness.pi as never, harness.runtime, {
      fn: undefined,
    });
    const handler = harness.hooks.get('tool_call')!;

    harness.plus.plannerGuard.enter('session-1');

    expect(handler({ toolName: 'write', input: { path: 'a.ts' } }, harness.ctx)).toMatchObject(
      { block: true },
    );
    expect(handler({ toolName: 'edit', input: { path: 'a.ts' } }, harness.ctx)).toMatchObject({
      block: true,
    });
    expect(
      handler({ toolName: 'bash', input: { command: 'git commit -m x' } }, harness.ctx),
    ).toMatchObject({ block: true });
    expect(
      handler({ toolName: 'bash', input: { command: 'git status' } }, harness.ctx),
    ).toBeUndefined();
    expect(handler({ toolName: 'read', input: { path: 'a.ts' } }, harness.ctx)).toBeUndefined();
  });

  it('does not block another session streaming concurrently', async () => {
    const harness = createHarness();
    await wireSmartRouterExtension(harness.pi as never, harness.runtime, {
      fn: undefined,
    });
    const handler = harness.hooks.get('tool_call')!;

    harness.plus.plannerGuard.enter('session-1');

    const otherSessionCtx = {
      sessionManager: { getSessionId: () => 'session-2' },
      ui: { notify: harness.notify },
    };

    expect(
      handler({ toolName: 'write', input: { path: 'b.ts' } }, otherSessionCtx),
    ).toBeUndefined();
  });

  it('records and notifies on HIGH-risk tool calls without blocking', async () => {
    const harness = createHarness();
    await wireSmartRouterExtension(harness.pi as never, harness.runtime, {
      fn: undefined,
    });
    const handler = harness.hooks.get('tool_call')!;

    const result = handler(
      { toolName: 'bash', input: { command: 'git push --force origin main' } },
      harness.ctx,
    );

    expect(result).toBeUndefined();
    expect(harness.notify).toHaveBeenCalledTimes(1);
    expect(harness.notify.mock.calls[0]?.[0]).toContain('Risk Guard: HIGH');
    const snapshot = harness.plus.taskState.get('session-1');
    expect(snapshot?.risk.level).toBe('high');
  });

  it('does not notify for LOW-risk tool calls', async () => {
    const harness = createHarness();
    await wireSmartRouterExtension(harness.pi as never, harness.runtime, {
      fn: undefined,
    });
    const handler = harness.hooks.get('tool_call')!;

    handler({ toolName: 'read', input: { path: 'a.ts' } }, harness.ctx);

    expect(harness.notify).not.toHaveBeenCalled();
  });
});
