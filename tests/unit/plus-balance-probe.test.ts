/**
 * Plus Balance Probe (P2) tests — documented-endpoint parsing, HTTP/parse
 * failure containment (fail open) and refresh orchestration.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  BALANCE_PROBE_ADAPTERS,
  findBalanceAdapter,
  probeProviderBalance,
} from '../../src/plus/balance-adapters.js';
import { BalanceProber } from '../../src/plus/balance-probe.js';
import { BalanceStateStore, fingerprintCredential } from '../../src/plus/balance-state.js';
import type { PlusCredentialPort } from '../../src/plus/balance-types.js';
import type { ModelProfile } from '../../src/domain/types/index.js';

const deepseek = findBalanceAdapter('deepseek')!;
const openrouter = findBalanceAdapter('openrouter')!;
const minimax = findBalanceAdapter('minimax-cn')!;

const FLEET: ModelProfile[] = [
  {
    id: 'deepseek-v4-pro',
    provider: 'deepseek',
    tier: 'economical-cloud',
    capabilities: { reasoning: 0.5, code_gen: 0.5, tool_use: 0.5 },
    pricing: { fallback_cost_per_1m: 1 },
  },
];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Plus Balance Probe — documented endpoint parsing', () => {
  it('parses a healthy DeepSeek balance', () => {
    const outcome = deepseek.parse(
      { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '110.00' }] },
      0,
    );
    expect(outcome.parsed).toBe(true);
    expect(outcome.depleted).toBe(false);
    expect(outcome.low).toBe(false);
    expect(outcome.balance).toEqual({ currency: 'CNY', total: '110.00', available: true });
  });

  it('treats DeepSeek is_available=false or zero balance as depleted', () => {
    const unavailableFlag = deepseek.parse(
      { is_available: false, balance_infos: [{ currency: 'CNY', total_balance: '0.00' }] },
      0,
    );
    expect(unavailableFlag.depleted).toBe(true);
    expect(unavailableFlag.reason).toBe('billing_depleted');

    const zero = deepseek.parse({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: '0' }] }, 0);
    expect(zero.depleted).toBe(true);
  });

  it('marks DeepSeek low below the configured threshold', () => {
    const outcome = deepseek.parse(
      { is_available: true, balance_infos: [{ currency: 'USD', total_balance: '0.5' }] },
      1,
    );
    expect(outcome.depleted).toBe(false);
    expect(outcome.low).toBe(true);
    expect(outcome.reason).toBe('balance_low');
  });

  it('fails open on an unrecognized DeepSeek payload', () => {
    expect(deepseek.parse({ unexpected: true }, 0).parsed).toBe(false);
    expect(deepseek.parse(null, 0).parsed).toBe(false);
  });

  it('reads the OpenRouter per-key spend limit', () => {
    const outcome = openrouter.parse(
      { data: { limit: 100, limit_remaining: 74.5, usage: 25.5, is_free_tier: false } },
      0,
    );
    expect(outcome.parsed).toBe(true);
    expect(outcome.depleted).toBe(false);
    expect(outcome.low).toBe(false);
    expect(outcome.balance).toEqual({ currency: 'USD', total: '74.5', available: true });
    // Healthy outcomes carry no detail (they are not persisted).
    expect(outcome.detail).toBeNull();
  });

  it('marks an exhausted OpenRouter key limit as depleted', () => {
    for (const remaining of [0, -0.5]) {
      const outcome = openrouter.parse({ data: { limit_remaining: remaining } }, 0);
      expect(outcome.parsed, String(remaining)).toBe(true);
      expect(outcome.depleted, String(remaining)).toBe(true);
      expect(outcome.reason).toBe('billing_depleted');
      expect(outcome.detail).toBe(`limit_remaining=${remaining}`);
    }
  });

  it('marks a low OpenRouter key limit as low', () => {
    const outcome = openrouter.parse({ data: { limit_remaining: 0.5 } }, 1);
    expect(outcome.depleted).toBe(false);
    expect(outcome.low).toBe(true);
    expect(outcome.reason).toBe('balance_low');
  });

  it('fails open for an unlimited OpenRouter key (limit_remaining null/missing)', () => {
    for (const payload of [
      { data: { limit: null, limit_remaining: null, usage: 25.5 } },
      { data: { usage: 25.5 } },
    ]) {
      const outcome = openrouter.parse(payload, 0);
      expect(outcome.parsed, JSON.stringify(payload)).toBe(false);
      expect(outcome.depleted).toBe(false);
      expect(outcome.detail).toBe('limit_remaining not set');
    }
  });

  it('fails open on an unrecognized OpenRouter payload', () => {
    expect(openrouter.parse({}, 0).parsed).toBe(false);
    expect(openrouter.parse({ data: {} }, 0).parsed).toBe(false);
    expect(openrouter.parse({ data: { limit_remaining: 'n/a' } }, 0)).toMatchObject({
      parsed: false,
      depleted: false,
      detail: 'unrecognized response',
    });
    // The old /credits shape must no longer be treated as a balance.
    expect(openrouter.parse({ data: { total_credits: 10, total_usage: 10 } }, 0).parsed).toBe(
      false,
    );
  });

  it('surfaces the free-tier flag without changing the classification', () => {
    const outcome = openrouter.parse({ data: { limit_remaining: 0, is_free_tier: true } }, 0);
    expect(outcome.depleted).toBe(true);
    expect(outcome.detail).toBe('limit_remaining=0 free_tier');
  });

  it('uses the documented OpenRouter endpoint', () => {
    expect(openrouter.endpoint).toBe('https://openrouter.ai/api/v1/key');
  });

  it('reads MiniMax Token Plan quota tolerantly and takes the binding window', () => {
    const exhausted = minimax.parse({ token_plan: { remains: 0 } }, 0);
    expect(exhausted.parsed).toBe(true);
    expect(exhausted.depleted).toBe(true);
    expect(exhausted.reason).toBe('quota_window_exhausted');
    expect(exhausted.detail).toContain('remains=0');

    const binding = minimax.parse(
      { data: [{ weekly_remains: 100 }, { five_hour_remains: 20 }] },
      0,
    );
    expect(binding.parsed).toBe(true);
    expect(binding.depleted).toBe(false);
    expect(binding.balance?.total).toBe('20');
  });

  it('fails open on an unrecognized MiniMax payload (schema is unpublished)', () => {
    expect(minimax.parse({ foo: 'bar' }, 0).parsed).toBe(false);
    expect(minimax.parse({ data: { total_usage: 500 } }, 0).parsed).toBe(false);
  });

  it('registers exactly the documented providers', () => {
    expect(BALANCE_PROBE_ADAPTERS.map((adapter) => adapter.provider)).toEqual([
      'deepseek',
      'openrouter',
      'minimax-cn',
    ]);
    expect(findBalanceAdapter('unknown-provider')).toBeUndefined();
  });
});

describe('Plus Balance Probe — request failure containment', () => {
  const key = 'sk-test-key-value';

  async function probeWith(fetchImpl: typeof fetch, minBalance = 0) {
    return probeProviderBalance(deepseek, key, { minBalance, fetchImpl });
  }

  it('sends the credential only in the Authorization header', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      calls.push({ url: String(input), init });
      return jsonResponse({ is_available: true, balance_infos: [] });
    }) as typeof fetch;

    await probeWith(fetchImpl, 0);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.deepseek.com/user/balance');
    expect(calls[0]!.init?.method).toBe('GET');
    expect((calls[0]!.init?.headers as Record<string, string>)['authorization']).toBe(
      `Bearer ${key}`,
    );
    expect(deepseek.endpoint).toBe('https://api.deepseek.com/user/balance');
  });

  it('never marks depleted on HTTP errors (wrong key kind, moved endpoint, transient)', async () => {
    for (const status of [400, 401, 403, 404, 429, 500, 503]) {
      const outcome = await probeWith((async () => jsonResponse({}, status)) as typeof fetch);
      expect(outcome.parsed, String(status)).toBe(false);
      expect(outcome.depleted, String(status)).toBe(false);
      expect(outcome.detail).toBe(`http ${status}`);
    }
  });

  it('never marks depleted on a non-JSON body', async () => {
    const outcome = await probeWith(
      (async () => new Response('<html>nope</html>', { status: 200 })) as typeof fetch,
    );
    expect(outcome.parsed).toBe(false);
    expect(outcome.depleted).toBe(false);
    expect(outcome.detail).toBe('non-JSON response');
  });

  it('never marks depleted on a network failure or timeout', async () => {
    const network = await probeWith((async () => {
      throw new Error('ECONNRESET');
    }) as typeof fetch);
    expect(network.detail).toBe('request failed');

    const timeout = await probeWith((async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    }) as typeof fetch);
    expect(timeout.detail).toBe('timeout');
    expect(timeout.depleted).toBe(false);
  });

  it('parses a successful response', async () => {
    const outcome = await probeWith(
      (async () =>
        jsonResponse({
          is_available: true,
          balance_infos: [{ currency: 'CNY', total_balance: '42.00' }],
        })) as typeof fetch,
    );
    expect(outcome.parsed).toBe(true);
    expect(outcome.balance?.total).toBe('42.00');
  });
});

describe('Plus Balance Probe — refresh orchestration', () => {
  function makeCredentials(key: string | undefined): PlusCredentialPort {
    return { getApiKeyForProvider: async () => key };
  }

  it('does nothing while disabled (P2 is opt-in)', async () => {
    const fetchImpl = vi.fn();
    const prober = new BalanceProber(new BalanceStateStore(), makeCredentials('key-a'), {
      enabled: false,
      ttlMs: 0,
      minBalance: 0,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    prober.maybeRefresh(FLEET);
    await prober.refresh(FLEET);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('records a parsed depletion and clears it on a parsed healthy answer', async () => {
    const store = new BalanceStateStore();
    let payload: unknown = {
      is_available: false,
      balance_infos: [{ currency: 'CNY', total_balance: '0.00' }],
    };
    const prober = new BalanceProber(store, makeCredentials('key-account'), {
      enabled: true,
      ttlMs: 0,
      minBalance: 0,
      fetchImpl: (async () => jsonResponse(payload)) as typeof fetch,
    });

    await prober.refresh(FLEET);
    const entry = store.get('deepseek', fingerprintCredential('key-account'));
    expect(entry?.status).toBe('depleted');
    expect(entry?.source).toBe('probe');
    expect(entry?.modelIds).toEqual(['deepseek-v4-pro']);

    payload = { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '10.00' }] };
    await prober.refresh(FLEET);
    expect(store.get('deepseek', fingerprintCredential('key-account'))).toBeUndefined();
  });

  it('leaves existing state untouched when the probe cannot be parsed', async () => {
    const store = new BalanceStateStore();
    const fingerprint = fingerprintCredential('key-account');
    store.put({
      provider: 'deepseek',
      fingerprint,
      status: 'depleted',
      reason: 'billing_depleted',
      source: 'error',
      observedAt: new Date(0).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      modelIds: ['deepseek-v4-pro'],
      balance: null,
      detail: 'insufficient balance',
    });

    const prober = new BalanceProber(store, makeCredentials('key-account'), {
      enabled: true,
      ttlMs: 0,
      minBalance: 0,
      fetchImpl: (async () => jsonResponse({}, 401)) as typeof fetch,
    });

    await prober.refresh(FLEET);
    expect(store.get('deepseek', fingerprint)?.detail).toBe('insufficient balance');
  });

  it('skips providers without a credential', async () => {
    const fetchImpl = vi.fn();
    const prober = new BalanceProber(new BalanceStateStore(), makeCredentials(undefined), {
      enabled: true,
      ttlMs: 0,
      minBalance: 0,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const results = await prober.refresh(FLEET);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(results[0]?.outcome.detail).toBe('no credential');
  });

  it('rate-limits refreshes to one round per TTL', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ is_available: true, balance_infos: [] }));
    let now = 1_000_000;
    const prober = new BalanceProber(new BalanceStateStore(), makeCredentials('key-a'), {
      enabled: true,
      ttlMs: 600_000,
      minBalance: 0,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => now,
    });

    prober.maybeRefresh(FLEET);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    prober.maybeRefresh(FLEET);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 600_001;
    prober.maybeRefresh(FLEET);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });
});
