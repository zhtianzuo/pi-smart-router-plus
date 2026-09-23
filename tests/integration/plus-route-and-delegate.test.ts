/**
 * Plus integration tests — Risk Guard routing policy + Planner Read-only Guard
 * lifecycle through `routeAndDelegate` / `createStreamSimple`.
 *
 * Release matrix: Pi Smart Router Plus MVP (Risk Guard, Planner Read-only).
 */

import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type Message,
  type Model,
  createAssistantMessageEventStream,
} from '@earendil-works/pi-ai/compat';
import type { ModelRegistry } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';

import { createStreamSimple } from '../../.pi/extensions/smart-router/index.js';
import type { StreamDelegationDeps } from '../../.pi/extensions/smart-router/types.js';
import {
  DEFAULT_PLUS_CONFIG,
  DEFAULT_PLANNING_DELEGATE_CONFIG,
  ExecutionLedger,
  createPlusRuntime,
  type PlannerToolGate,
  type RouterHandle,
  type RoutingDecision,
  type RoutingRequest,
} from '../../src/index.js';
import { RouterPipeline } from '../../src/domain/pipeline/router-pipeline.js';
import { SessionPinner } from '../../src/domain/pinning/session-pinner.js';
import type { ModelProfile } from '../../src/domain/types/index.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeProfile(
  overrides: Partial<ModelProfile> & { id: string; tier: ModelProfile['tier'] },
): ModelProfile {
  return {
    provider: 'anthropic',
    capabilities: { reasoning: 0.5, code_gen: 0.5, tool_use: 0.5 },
    pricing: { fallback_cost_per_1m: 1.0 },
    ...overrides,
  };
}

const frontier = makeProfile({
  id: 'claude-opus',
  tier: 'frontier-cloud',
  pricing: { fallback_cost_per_1m: 15.0 },
});
const economical = makeProfile({
  id: 'claude-haiku',
  tier: 'economical-cloud',
  pricing: { fallback_cost_per_1m: 1.0 },
});

const FLEET: ModelProfile[] = [frontier, economical];

const FULL_TOOLS = ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'];
const READ_ONLY_TOOLS = ['read', 'grep', 'find', 'ls'];

function makeRegistryModel(id: string): Model<Api> {
  return {
    name: id,
    api: 'anthropic-messages',
    baseUrl: 'https://example.com',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 8192,
    provider: 'anthropic' as Model<Api>['provider'],
    id,
  };
}

const registryModels = [makeRegistryModel('claude-opus'), makeRegistryModel('claude-haiku')];

const modelRegistry = {
  find(provider: string, id: string) {
    return registryModels.find((model) => model.provider === provider && model.id === id);
  },
  getAvailable() {
    return registryModels;
  },
  async getApiKeyAndHeaders() {
    return { ok: true as const, apiKey: 'test-key', headers: undefined, env: undefined };
  },
} as unknown as ModelRegistry;

function makeAutoModel(): Model<Api> {
  return {
    ...makeRegistryModel('auto'),
    provider: 'smart-router' as Model<Api>['provider'],
  };
}

function userMessage(content: string): Message {
  return { role: 'user', content, timestamp: 1 };
}

function makeContext(messages: Message[]): Context {
  return { messages };
}

function makeAssistantPartial(model: Model<Api>): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'routed response' }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 2,
  };
}

function makeSuccessStream(model: Model<Api>): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const partial = makeAssistantPartial(model);
  void (async () => {
    stream.push({ type: 'start', partial });
    stream.push({ type: 'done', reason: 'stop', message: partial });
    stream.end(partial);
  })();
  return stream;
}

async function collectEvents(
  stream: AssistantMessageEventStream,
): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

const PLAIN_DECISION: RoutingDecision = {
  request_id: 'plus-plain',
  selected_model_id: 'claude-haiku',
  tier: 'economical-cloud',
  stage: 'turn_envelope',
  reason_code: 'turn_main_loop',
  routing_latency_ms: 0,
  pin_reason: null,
};

function makeFakeRouter(
  decision: RoutingDecision,
  onDispatch?: (request: RoutingRequest) => void,
): RouterHandle {
  return {
    version: 'test',
    middleware: {},
    fleet: FLEET,
    register() {},
    dispatch: {
      async dispatch(request: RoutingRequest) {
        onDispatch?.(request);
        return decision;
      },
      recordOutcome() {},
      selectFailover() {
        return undefined;
      },
    },
  } as unknown as RouterHandle;
}

function createRecordingGate(initial: string[] = FULL_TOOLS) {
  const calls: string[][] = [];
  let current = [...initial];
  const gate: PlannerToolGate = {
    getActiveTools: () => [...current],
    setActiveTools: (toolNames) => {
      calls.push([...toolNames]);
      current = [...toolNames];
    },
  };
  return { gate, calls, current: () => current };
}

/** Warm an economical pin, then route a planning turn → planning_delegate. */
async function makePlanningDecision(sessionId: string): Promise<RoutingDecision> {
  const pinner = new SessionPinner();
  const pipeline = new RouterPipeline(FLEET, { sessionPinner: pinner });

  await pipeline.route({
    request_id: `${sessionId}-warm`,
    session_id: sessionId,
    prompt_text: 'Continue working on the auth module',
    turn_type: 'main_loop',
  });

  return pipeline.route({
    request_id: `${sessionId}-plan`,
    session_id: sessionId,
    prompt_text: 'Plan the refactor',
    turn_type: 'planning',
  });
}

function makeDeps(
  router: RouterHandle,
  plus: ReturnType<typeof createPlusRuntime>,
  spawnPlanningDelegate?: StreamDelegationDeps['spawnPlanningDelegate'],
): StreamDelegationDeps {
  return {
    router,
    modelRegistry,
    fleet: FLEET,
    executionLedger: new ExecutionLedger(),
    delegateStream: () => makeSuccessStream(makeRegistryModel('claude-haiku')),
    ...(spawnPlanningDelegate ? { spawnPlanningDelegate } : {}),
    planningDelegateConfig: DEFAULT_PLANNING_DELEGATE_CONFIG,
    plus,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('@release', () => {
  describe('Plus Risk Guard routing policy', () => {
    it('forces planning and records risk for a HIGH-risk prompt', async () => {
      const dispatched: RoutingRequest[] = [];
      const plus = createPlusRuntime({ config: DEFAULT_PLUS_CONFIG });
      const streamSimple = createStreamSimple(
        makeDeps(makeFakeRouter(PLAIN_DECISION, (request) => dispatched.push(request)), plus, undefined),
      );

      await collectEvents(
        streamSimple(
          makeAutoModel(),
          makeContext([userMessage('Rotate the production database credentials')]),
          { sessionId: 'plus-high' },
        ),
      );

      expect(dispatched).toHaveLength(1);
      expect(dispatched[0]?.turn_type).toBe('planning');
      const snapshot = plus.taskState.get('plus-high');
      expect(snapshot?.risk.level).toBe('high');
      expect(snapshot?.planningForced).toBe(true);
    });

    it('preserves the upstream turn type for a LOW-risk prompt', async () => {
      const dispatched: RoutingRequest[] = [];
      const plus = createPlusRuntime({ config: DEFAULT_PLUS_CONFIG });
      const streamSimple = createStreamSimple(
        makeDeps(makeFakeRouter(PLAIN_DECISION, (request) => dispatched.push(request)), plus, undefined),
      );

      await collectEvents(
        streamSimple(
          makeAutoModel(),
          makeContext([userMessage('Fix the README typo')]),
          { sessionId: 'plus-low' },
        ),
      );

      expect(dispatched[0]?.turn_type).toBe('main_loop');
      expect(plus.taskState.get('plus-low')?.planningForced).toBe(false);
    });

    it('does not rewrite an executor tool_result turn even when risk is HIGH', async () => {
      const dispatched: RoutingRequest[] = [];
      const plus = createPlusRuntime({ config: DEFAULT_PLUS_CONFIG });
      const streamSimple = createStreamSimple(
        makeDeps(makeFakeRouter(PLAIN_DECISION, (request) => dispatched.push(request)), plus, undefined),
      );

      const messages: Message[] = [
        userMessage('force push production'),
        {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'call-1',
              name: 'bash',
              arguments: { command: 'git push --force origin main' },
            },
          ],
          api: 'anthropic-messages',
          provider: 'anthropic',
          model: 'claude-haiku',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'toolUse',
          timestamp: 2,
        },
        {
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'bash',
          content: [{ type: 'text', text: 'rejected by remote' }],
          isError: true,
          timestamp: 3,
        },
      ];

      await collectEvents(
        streamSimple(makeAutoModel(), makeContext(messages), { sessionId: 'plus-tool-result' }),
      );

      expect(dispatched[0]?.turn_type).toBe('tool_result');
      expect(plus.taskState.get('plus-tool-result')?.risk.level).toBe('high');
      expect(plus.taskState.get('plus-tool-result')?.planningForced).toBe(false);
    });

    it('leaves routing untouched when riskGuard is disabled', async () => {
      const dispatched: RoutingRequest[] = [];
      const plus = createPlusRuntime({
        config: { ...DEFAULT_PLUS_CONFIG, riskGuard: false },
      });
      const streamSimple = createStreamSimple(
        makeDeps(makeFakeRouter(PLAIN_DECISION, (request) => dispatched.push(request)), plus, undefined),
      );

      await collectEvents(
        streamSimple(
          makeAutoModel(),
          makeContext([userMessage('delete the production database')]),
          { sessionId: 'plus-disabled' },
        ),
      );

      expect(dispatched[0]?.turn_type).toBe('main_loop');
      expect(plus.taskState.get('plus-disabled')?.risk.level).toBe('low');
    });
  });

  describe('Plus Planner Read-only Guard lifecycle', () => {
    it('applies the read-only window and restores executor tools on the delegate path', async () => {
      const sessionId = 'plus-guard-success';
      const planningDecision = await makePlanningDecision(sessionId);
      expect(planningDecision.reason_code).toBe('planning_delegate');

      const { gate, calls, current } = createRecordingGate();
      const plus = createPlusRuntime({ config: DEFAULT_PLUS_CONFIG, gate });
      const streamSimple = createStreamSimple(
        makeDeps(makeFakeRouter(planningDecision), plus, async () => ({
          ok: true,
          observationText: 'Plan: keep it small.',
        })),
      );

      await collectEvents(
        streamSimple(
          makeAutoModel(),
          makeContext([userMessage('Plan the refactor')]),
          { sessionId },
        ),
      );

      expect(calls).toEqual([READ_ONLY_TOOLS, FULL_TOOLS]);
      expect(current()).toEqual(FULL_TOOLS);
      expect(plus.plannerGuard.isActive()).toBe(false);
      expect(plus.taskState.get(sessionId)?.planningReadOnlyApplied).toBe(true);
    });

    it('restores executor tools when the planning delegate reports failure', async () => {
      const sessionId = 'plus-guard-failure';
      const planningDecision = await makePlanningDecision(sessionId);

      const { gate, calls, current } = createRecordingGate();
      const plus = createPlusRuntime({ config: DEFAULT_PLUS_CONFIG, gate });
      const streamSimple = createStreamSimple(
        makeDeps(makeFakeRouter(planningDecision), plus, async () => ({
          ok: false,
          reason: 'worker unavailable',
        })),
      );

      await collectEvents(
        streamSimple(
          makeAutoModel(),
          makeContext([userMessage('Plan the refactor')]),
          { sessionId },
        ),
      );

      expect(calls).toEqual([READ_ONLY_TOOLS, FULL_TOOLS]);
      expect(current()).toEqual(FULL_TOOLS);
      expect(plus.plannerGuard.isActive()).toBe(false);
    });

    it('restores executor tools when the planning delegate throws', async () => {
      const sessionId = 'plus-guard-throw';
      const planningDecision = await makePlanningDecision(sessionId);

      const { gate, calls, current } = createRecordingGate();
      const plus = createPlusRuntime({ config: DEFAULT_PLUS_CONFIG, gate });
      const streamSimple = createStreamSimple(
        makeDeps(makeFakeRouter(planningDecision), plus, async () => {
          throw new Error('planning blew up');
        }),
      );

      await collectEvents(
        streamSimple(
          makeAutoModel(),
          makeContext([userMessage('Plan the refactor')]),
          { sessionId },
        ),
      );

      expect(calls).toEqual([READ_ONLY_TOOLS, FULL_TOOLS]);
      expect(current()).toEqual(FULL_TOOLS);
      expect(plus.plannerGuard.isActive()).toBe(false);
    });

    it('skips the read-only window when plannerReadOnly is disabled', async () => {
      const sessionId = 'plus-guard-off';
      const planningDecision = await makePlanningDecision(sessionId);

      const { gate, calls } = createRecordingGate();
      const plus = createPlusRuntime({
        config: { ...DEFAULT_PLUS_CONFIG, plannerReadOnly: false },
        gate,
      });
      const streamSimple = createStreamSimple(
        makeDeps(makeFakeRouter(planningDecision), plus, async () => ({
          ok: true,
          observationText: 'Plan: keep it small.',
        })),
      );

      await collectEvents(
        streamSimple(
          makeAutoModel(),
          makeContext([userMessage('Plan the refactor')]),
          { sessionId },
        ),
      );

      expect(calls).toEqual([]);
      expect(plus.taskState.get(sessionId)?.planningReadOnlyApplied).toBe(false);
    });
  });
});
