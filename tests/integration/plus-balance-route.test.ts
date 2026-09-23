/**
 * Plus balance integration tests — Depletion Guard (P1) wiring through
 * `routeAndDelegate`, fail-open behavior, and Balance Probe (P2) containment.
 *
 * Release matrix: Pi Smart Router Plus (account depletion routing policy).
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
import { describe, expect, it, vi } from 'vitest';

import { createStreamSimple } from '../../.pi/extensions/smart-router/index.js';
import type { StreamDelegationDeps } from '../../.pi/extensions/smart-router/types.js';
import {
  BalanceStateStore,
  DEFAULT_PLUS_CONFIG,
  DEFAULT_PLANNING_DELEGATE_CONFIG,
  ExecutionLedger,
  createPlusRuntime,
  type PlusRuntime,
  type RouterHandle,
  type RoutingDecision,
  type RoutingRequest,
} from '../../src/index.js';
import type { ModelProfile } from '../../src/domain/types/index.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeProfile(
  overrides: Partial<ModelProfile> & { id: string; provider: string; tier: ModelProfile['tier'] },
): ModelProfile {
  return {
    capabilities: { reasoning: 0.5, code_gen: 0.5, tool_use: 0.5 },
    pricing: { fallback_cost_per_1m: 1.0 },
    ...overrides,
  };
}

function anthropicFleet(): ModelProfile[] {
  return [
    makeProfile({ id: 'claude-opus', provider: 'anthropic', tier: 'frontier-cloud' }),
    makeProfile({ id: 'claude-haiku', provider: 'anthropic', tier: 'economical-cloud' }),
    makeProfile({ id: 'gpt-econ', provider: 'openai', tier: 'economical-cloud' }),
  ];
}

function singleProviderFleet(): ModelProfile[] {
  return [
    makeProfile({ id: 'claude-opus', provider: 'anthropic', tier: 'frontier-cloud' }),
    makeProfile({ id: 'claude-haiku', provider: 'anthropic', tier: 'economical-cloud' }),
  ];
}

function deepseekFleet(): ModelProfile[] {
  return [
    makeProfile({ id: 'deepseek-v4-pro', provider: 'deepseek', tier: 'economical-cloud' }),
    makeProfile({ id: 'gpt-econ', provider: 'openai', tier: 'economical-cloud' }),
  ];
}

function makeRegistryModel(provider: string, id: string): Model<Api> {
  return {
    name: id,
    api: 'anthropic-messages',
    baseUrl: 'https://example.com',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 8192,
    provider: provider as Model<Api>['provider'],
    id,
  };
}

function createMockRegistry(fleet: readonly ModelProfile[]): ModelRegistry {
  const models = fleet.map((profile) => makeRegistryModel(profile.provider, profile.id));
  return {
    find(provider: string, id: string) {
      return models.find((model) => model.provider === provider && model.id === id);
    },
    getAvailable() {
      return models;
    },
    async getApiKeyAndHeaders() {
      return { ok: true as const, apiKey: 'test-key', headers: undefined, env: undefined };
    },
    async getApiKeyForProvider(provider: string) {
      return `key-for-${provider}`;
    },
  } as unknown as ModelRegistry;
}

function makeAutoModel(): Model<Api> {
  return makeRegistryModel('smart-router', 'auto');
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

function makeErrorStream(model: Model<Api>, errorMessage: string): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const error: AssistantMessage = {
    ...makeAssistantPartial(model),
    content: [],
    stopReason: 'error',
    errorMessage,
  };
  void (async () => {
    stream.push({ type: 'error', reason: 'error', error });
    stream.end(error);
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

function makeDecision(selectedModelId: string): RoutingDecision {
  return {
    request_id: 'plus-balance',
    selected_model_id: selectedModelId,
    tier: 'economical-cloud',
    stage: 'turn_envelope',
    reason_code: 'turn_main_loop',
    routing_latency_ms: 0,
    pin_reason: null,
  };
}

interface DispatchCapture {
  readonly requests: RoutingRequest[];
  readonly effectiveFleets: (readonly ModelProfile[])[];
}

function makeFakeRouter(
  decision: RoutingDecision,
  capture: DispatchCapture,
): RouterHandle {
  return {
    version: 'test',
    middleware: {},
    fleet: [],
    register() {},
    dispatch: {
      async dispatch(request: RoutingRequest, options?: { effectiveFleet?: readonly ModelProfile[] }) {
        capture.requests.push(request);
        capture.effectiveFleets.push(options?.effectiveFleet ?? []);
        return decision;
      },
      recordOutcome() {},
      selectFailover() {
        return undefined;
      },
    },
  } as unknown as RouterHandle;
}

function makeDeps(
  fleet: readonly ModelProfile[],
  router: RouterHandle,
  plus: PlusRuntime,
  delegateStream: StreamDelegationDeps['delegateStream'],
): StreamDelegationDeps {
  return {
    router,
    modelRegistry: createMockRegistry(fleet),
    fleet: [...fleet],
    executionLedger: new ExecutionLedger(),
    ...(delegateStream ? { delegateStream } : {}),
    planningDelegateConfig: DEFAULT_PLANNING_DELEGATE_CONFIG,
    plus,
  };
}

function emptyCapture(): DispatchCapture {
  return { requests: [], effectiveFleets: [] };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Plus Depletion Guard (P1) routing integration', () => {
  it('remembers a 402 billing failure and avoids that account on the next request', async () => {
    const fleet = anthropicFleet();
    const capture = emptyCapture();
    const plus = createPlusRuntime({
      config: DEFAULT_PLUS_CONFIG,
      balanceState: new BalanceStateStore(),
    });

    let call = 0;
    const deps = makeDeps(
      fleet,
      makeFakeRouter(makeDecision('claude-haiku'), capture),
      plus,
      () => {
        call += 1;
        const model = makeRegistryModel('anthropic', 'claude-haiku');
        return call === 1
          ? makeErrorStream(model, 'Error 402: Insufficient Balance')
          : makeSuccessStream(model);
      },
    );
    const streamSimple = createStreamSimple(deps);

    await collectEvents(
      streamSimple(makeAutoModel(), makeContext([userMessage('Fix the README typo')]), {
        sessionId: 'plus-balance-1',
      }),
    );
    await vi.waitFor(() => expect(plus.blockedAccounts()).toHaveLength(1));

    const entry = plus.blockedAccounts()[0]!;
    expect(entry.provider).toBe('anthropic');
    expect(entry.status).toBe('depleted');
    expect(entry.reason).toBe('billing_depleted');
    expect(entry.source).toBe('error');
    expect(entry.modelIds).toEqual(['claude-haiku']);

    // Second request: the depleted account is marked unhealthy before dispatch.
    await collectEvents(
      streamSimple(makeAutoModel(), makeContext([userMessage('Now fix the typo')]), {
        sessionId: 'plus-balance-2',
      }),
    );

    const fleetForSecondRequest = capture.effectiveFleets[1]!;
    expect(fleetForSecondRequest.map((profile) => [profile.id, profile.healthy])).toEqual([
      ['claude-opus', false],
      ['claude-haiku', false],
      ['gpt-econ', undefined],
    ]);
  });

  it('does not mark an account on a plain rate limit', async () => {
    const fleet = anthropicFleet();
    const plus = createPlusRuntime({
      config: DEFAULT_PLUS_CONFIG,
      balanceState: new BalanceStateStore(),
    });
    const model = makeRegistryModel('anthropic', 'claude-haiku');
    const deps = makeDeps(
      fleet,
      makeFakeRouter(makeDecision('claude-haiku'), emptyCapture()),
      plus,
      () => makeErrorStream(model, '429 Rate limit reached, retry later'),
    );

    await collectEvents(
      createStreamSimple(deps)(
        makeAutoModel(),
        makeContext([userMessage('Fix the README typo')]),
        { sessionId: 'plus-balance-ratelimit' },
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(plus.blockedAccounts()).toHaveLength(0);
  });

  it('fails open when every account would be excluded', async () => {
    const fleet = singleProviderFleet();
    const capture = emptyCapture();
    const plus = createPlusRuntime({
      config: DEFAULT_PLUS_CONFIG,
      balanceState: new BalanceStateStore(),
    });
    const model = makeRegistryModel('anthropic', 'claude-haiku');

    const deps = makeDeps(
      fleet,
      makeFakeRouter(makeDecision('claude-haiku'), capture),
      plus,
      () => makeErrorStream(model, 'Error 402: Insufficient Balance'),
    );
    const streamSimple = createStreamSimple(deps);

    await collectEvents(
      streamSimple(makeAutoModel(), makeContext([userMessage('Fix the README typo')]), {
        sessionId: 'plus-balance-failopen-1',
      }),
    );
    await vi.waitFor(() => expect(plus.blockedAccounts()).toHaveLength(1));

    await collectEvents(
      streamSimple(makeAutoModel(), makeContext([userMessage('Fix it again')]), {
        sessionId: 'plus-balance-failopen-2',
      }),
    );

    const fleetForSecondRequest = capture.effectiveFleets[1]!;
    expect(fleetForSecondRequest).toHaveLength(2);
    expect(fleetForSecondRequest.every((profile) => profile.healthy !== false)).toBe(true);
  });

  it('leaves routing untouched when the balance guard is disabled', async () => {
    const fleet = anthropicFleet();
    const capture = emptyCapture();
    const plus = createPlusRuntime({
      config: { ...DEFAULT_PLUS_CONFIG, balanceGuard: false },
      balanceState: new BalanceStateStore(),
    });
    const model = makeRegistryModel('anthropic', 'claude-haiku');

    const deps = makeDeps(
      fleet,
      makeFakeRouter(makeDecision('claude-haiku'), capture),
      plus,
      () => makeErrorStream(model, 'Error 402: Insufficient Balance'),
    );
    const streamSimple = createStreamSimple(deps);

    await collectEvents(
      streamSimple(makeAutoModel(), makeContext([userMessage('Fix the README typo')]), {
        sessionId: 'plus-balance-off-1',
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(plus.blockedAccounts()).toHaveLength(0);

    await collectEvents(
      streamSimple(makeAutoModel(), makeContext([userMessage('Again')]), {
        sessionId: 'plus-balance-off-2',
      }),
    );
    expect(capture.effectiveFleets[1]!.every((profile) => profile.healthy !== false)).toBe(true);
  });
});

describe('Plus Balance Probe (P2) routing containment', () => {
  it('makes no network call while the probe is disabled (default)', async () => {
    const fleet = deepseekFleet();
    const fetchImpl = vi.fn();
    const plus = createPlusRuntime({
      config: DEFAULT_PLUS_CONFIG,
      balanceState: new BalanceStateStore(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const model = makeRegistryModel('deepseek', 'deepseek-v4-pro');

    const deps = makeDeps(
      fleet,
      makeFakeRouter(makeDecision('deepseek-v4-pro'), emptyCapture()),
      plus,
      () => makeSuccessStream(model),
    );

    await collectEvents(
      createStreamSimple(deps)(
        makeAutoModel(),
        makeContext([userMessage('Fix the README typo')]),
        { sessionId: 'plus-probe-off' },
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never blocks routing on a stalled probe', async () => {
    const fleet = deepseekFleet();
    const plus = createPlusRuntime({
      config: { ...DEFAULT_PLUS_CONFIG, balanceProbe: true },
      balanceState: new BalanceStateStore(),
      fetchImpl: (() => new Promise(() => {})) as unknown as typeof fetch,
    });
    const model = makeRegistryModel('deepseek', 'deepseek-v4-pro');

    const deps = makeDeps(
      fleet,
      makeFakeRouter(makeDecision('deepseek-v4-pro'), emptyCapture()),
      plus,
      () => makeSuccessStream(model),
    );

    const events = await collectEvents(
      createStreamSimple(deps)(
        makeAutoModel(),
        makeContext([userMessage('Fix the README typo')]),
        { sessionId: 'plus-probe-stalled' },
      ),
    );

    // Routing completed even though the probe never resolves.
    expect(events.some((event) => event.type === 'done')).toBe(true);
  });
});
