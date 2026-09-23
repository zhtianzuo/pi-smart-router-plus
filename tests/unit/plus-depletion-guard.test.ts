/**
 * Plus Depletion Guard (P1) tests — deterministic classification of billing /
 * quota exhaustion plus the fleet policy that marks accounts unhealthy.
 */

import { describe, expect, it } from 'vitest';

import {
  BILLING_DEPLETED_TTL_MS,
  QUOTA_WINDOW_TTL_MS,
  fingerprintCredential,
} from '../../src/plus/balance-state.js';
import type { BalanceEntry } from '../../src/plus/balance-types.js';
import {
  applyFleetBalancePolicy,
  classifyDepletionError,
  resolveBlockedProviders,
  sanitizeDetail,
  type BlockedProvider,
} from '../../src/plus/depletion-guard.js';
import type { ModelProfile } from '../../src/domain/types/index.js';

function makeProfile(
  overrides: Partial<ModelProfile> & { id: string; provider: string },
): ModelProfile {
  return {
    tier: 'economical-cloud',
    capabilities: { reasoning: 0.5, code_gen: 0.5, tool_use: 0.5 },
    pricing: { fallback_cost_per_1m: 1 },
    ...overrides,
  };
}

const FLEET: ModelProfile[] = [
  makeProfile({ id: 'deepseek-v4-pro', provider: 'deepseek' }),
  makeProfile({ id: 'minimax-m3', provider: 'minimax-cn' }),
];

function blockedMap(
  entries: readonly { provider: string; status: 'low' | 'depleted' }[],
): Map<string, BlockedProvider> {
  return new Map(
    entries.map((item) => [
      item.provider,
      {
        provider: item.provider,
        fingerprint: fingerprintCredential(`key-${item.provider}`),
        status: item.status,
        reason: item.status === 'depleted' ? 'billing_depleted' : 'balance_low',
        detail: null,
      },
    ]),
  );
}

describe('Plus Depletion Guard — classification', () => {
  it('classifies HTTP 402 as billing depleted with the long TTL', () => {
    const result = classifyDepletionError({ statusCode: 402, message: 'Payment Required' });
    expect(result.depleted).toBe(true);
    expect(result.reason).toBe('billing_depleted');
    expect(result.ttlMs).toBe(BILLING_DEPLETED_TTL_MS);
  });

  it('classifies billing error codes as billing depleted', () => {
    for (const code of ['insufficient_quota', 'insufficient_balance', 'payment_required']) {
      expect(classifyDepletionError({ code }).reason).toBe('billing_depleted');
    }
  });

  it('classifies billing messages (EN + ZH) as billing depleted', () => {
    for (const message of [
      'Insufficient Balance',
      'You have no credits remaining',
      'Your credit balance is too low to access the API',
      'out of credits',
      '余额不足，请充值',
      '账户欠费',
    ]) {
      const result = classifyDepletionError({ message });
      expect(result.reason, message).toBe('billing_depleted');
    }
  });

  it('classifies subscription usage-limit errors as quota window exhaustion', () => {
    for (const input of [
      { code: 'resource_exhausted' },
      { code: 'usage_limit_exceeded' },
      { message: "You've hit your usage limit. Switch to Auto for more usage." },
      { message: 'quota exceeded' },
      { message: '配额已用尽' },
    ]) {
      const result = classifyDepletionError(input);
      expect(result.depleted, JSON.stringify(input)).toBe(true);
      expect(result.reason).toBe('quota_window_exhausted');
      expect(result.ttlMs).toBe(QUOTA_WINDOW_TTL_MS);
    }
  });

  it('prefers the billing class when a code proves billing exhaustion', () => {
    const result = classifyDepletionError({
      statusCode: 429,
      code: 'insufficient_quota',
      message: 'quota exceeded',
    });
    expect(result.reason).toBe('billing_depleted');
  });

  it('uses the raw message when parsing produced nothing', () => {
    const result = classifyDepletionError({}, 'Error 402: Insufficient Balance');
    expect(result.reason).toBe('billing_depleted');
  });

  it('does NOT classify plain rate limits, auth failures or infra errors', () => {
    for (const input of [
      { statusCode: 429, code: 'rate_limit_exceeded', message: 'Rate limit reached, retry later' },
      { statusCode: 401, message: 'Invalid API key' },
      { statusCode: 403, message: 'Forbidden' },
      { statusCode: 500, message: 'Internal server error' },
      { statusCode: 503, message: 'Service unavailable' },
      { code: 'ECONNRESET' },
      {},
    ]) {
      const result = classifyDepletionError(input);
      expect(result.depleted, JSON.stringify(input)).toBe(false);
      expect(result.reason).toBeNull();
      expect(result.ttlMs).toBeNull();
    }
  });
});

describe('Plus Depletion Guard — detail sanitizing', () => {
  it('redacts credential-looking text', () => {
    const bearer = sanitizeDetail('Bearer sk-abcdef123456 rejected');
    expect(bearer).not.toContain('sk-abcdef123456');
    expect(bearer).toContain('[redacted]');

    const apiKey = sanitizeDetail('api_key=sk-live-0123456789abcdef');
    expect(apiKey).not.toContain('sk-live');
    expect(apiKey).toContain('[redacted]');
  });

  it('truncates long messages and collapses whitespace', () => {
    const detail = sanitizeDetail(`a\n\n${'x'.repeat(400)}`);
    expect(detail).not.toBeNull();
    expect(detail!.length).toBeLessThanOrEqual(160);
    expect(detail).not.toContain('\n');
  });

  it('returns null for empty input', () => {
    expect(sanitizeDetail(undefined)).toBeNull();
    expect(sanitizeDetail('   ')).toBeNull();
  });
});

describe('Plus Depletion Guard — fleet policy', () => {
  it('is a no-op when nothing is blocked', () => {
    const result = applyFleetBalancePolicy(FLEET, new Map());
    expect(result.fleet).toBe(FLEET);
    expect(result.excludedModelIds).toEqual([]);
    expect(result.failOpen).toBe(false);
  });

  it('marks blocked accounts unhealthy and leaves other models untouched', () => {
    const result = applyFleetBalancePolicy(FLEET, blockedMap([{ provider: 'deepseek', status: 'depleted' }]));

    expect(result.failOpen).toBe(false);
    expect(result.excludedModelIds).toEqual(['deepseek-v4-pro']);

    const deepseek = result.fleet.find((profile) => profile.provider === 'deepseek');
    const minimax = result.fleet.find((profile) => profile.provider === 'minimax-cn');
    expect(deepseek?.healthy).toBe(false);
    // Untouched profiles keep their identity (no needless churn).
    expect(minimax).toBe(FLEET[1]);
  });

  it('treats low balance the same as depleted', () => {
    const result = applyFleetBalancePolicy(FLEET, blockedMap([{ provider: 'minimax-cn', status: 'low' }]));
    expect(result.excludedModelIds).toEqual(['minimax-m3']);
    expect(result.fleet.find((profile) => profile.provider === 'minimax-cn')?.healthy).toBe(false);
  });

  it('fails open when every account is blocked', () => {
    const result = applyFleetBalancePolicy(
      FLEET,
      blockedMap([
        { provider: 'deepseek', status: 'depleted' },
        { provider: 'minimax-cn', status: 'depleted' },
      ]),
    );
    expect(result.failOpen).toBe(true);
    expect(result.fleet).toBe(FLEET);
    expect(result.excludedModelIds).toEqual([]);
  });

  it('does not clone an already-unhealthy model', () => {
    const unhealthy = makeProfile({ id: 'deepseek-v4-pro', provider: 'deepseek', healthy: false });
    const result = applyFleetBalancePolicy(
      [unhealthy, FLEET[1]!],
      blockedMap([{ provider: 'deepseek', status: 'depleted' }]),
    );
    expect(result.fleet[0]).toBe(unhealthy);
  });
});

describe('Plus Depletion Guard — blocked provider resolution', () => {
  const fpDeepseek = fingerprintCredential('key-deepseek');
  const fpOther = fingerprintCredential('key-deepseek-other-account');

  function entryFor(fingerprint: string, status: 'low' | 'depleted'): BalanceEntry {
    return {
      provider: 'deepseek',
      fingerprint,
      status,
      reason: 'billing_depleted',
      source: 'error',
      observedAt: new Date(0).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      modelIds: ['deepseek-v4-pro'],
      balance: null,
      detail: null,
    };
  }

  it('blocks the provider whose active fingerprint is depleted', () => {
    const fingerprintMap = new Map([['deepseek', fpDeepseek]]);
    const lookup = (provider: string, fingerprint: string) =>
      provider === 'deepseek' && fingerprint === fpDeepseek
        ? entryFor(fpDeepseek, 'depleted')
        : undefined;

    const blocked = resolveBlockedProviders(FLEET, fingerprintMap, lookup);
    expect([...blocked.keys()]).toEqual(['deepseek']);
    expect(blocked.get('deepseek')?.status).toBe('depleted');
  });

  it('does not block another account of the same provider', () => {
    const fingerprintMap = new Map([['deepseek', fpOther]]);
    const lookup = (provider: string, fingerprint: string) =>
      provider === 'deepseek' && fingerprint === fpDeepseek
        ? entryFor(fpDeepseek, 'depleted')
        : undefined;

    expect(resolveBlockedProviders(FLEET, fingerprintMap, lookup).size).toBe(0);
  });

  it('skips providers without a resolved fingerprint', () => {
    const blocked = resolveBlockedProviders(FLEET, new Map(), () => entryFor(fpDeepseek, 'depleted'));
    expect(blocked.size).toBe(0);
  });
});
