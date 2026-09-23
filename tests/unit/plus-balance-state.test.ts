/**
 * Plus balance state tests — credential fingerprinting, TTL, persistence and
 * per-account isolation.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BALANCE_STATE_VERSION,
  BalanceStateStore,
  UNKNOWN_FINGERPRINT,
  balanceStateKey,
  fingerprintCredential,
} from '../../src/plus/balance-state.js';
import type { BalanceEntry, BalanceStatus } from '../../src/plus/balance-types.js';

const FP_A = fingerprintCredential('key-account-a');
const FP_B = fingerprintCredential('key-account-b');

function makeEntry(
  overrides: Partial<BalanceEntry> & { status: BalanceStatus },
): BalanceEntry {
  return {
    provider: 'deepseek',
    fingerprint: FP_A,
    reason: 'billing_depleted',
    source: 'error',
    observedAt: new Date(0).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    modelIds: ['deepseek-v4-pro'],
    balance: null,
    detail: null,
    ...overrides,
  };
}

describe('Plus credential fingerprint', () => {
  it('is stable, truncated and does not contain the credential', () => {
    const fingerprint = fingerprintCredential('sk-super-secret-value');
    expect(fingerprint).toMatch(/^fp_[0-9a-f]{12}$/);
    expect(fingerprint).toBe(fingerprintCredential('sk-super-secret-value'));
    expect(fingerprint).not.toContain('super-secret');
    expect(fingerprint.length).toBe(15);
  });

  it('separates different credentials', () => {
    expect(FP_A).not.toBe(FP_B);
    expect(balanceStateKey('deepseek', FP_A)).toBe(`deepseek|${FP_A}`);
  });

  it('exposes an explicit unknown marker', () => {
    expect(UNKNOWN_FINGERPRINT).toBe('fp_unknown');
  });
});

describe('Plus balance state store (in memory)', () => {
  it('records, reads and lists entries', () => {
    const store = new BalanceStateStore();
    store.put(makeEntry({ status: 'depleted' }));

    expect(store.size).toBe(1);
    expect(store.get('deepseek', FP_A)?.status).toBe('depleted');
    expect(store.list()).toHaveLength(1);
  });

  it('expires entries by TTL', () => {
    const now = Date.now();
    const store = new BalanceStateStore();
    store.put(
      makeEntry({
        status: 'depleted',
        observedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 1_000).toISOString(),
      }),
    );

    expect(store.get('deepseek', FP_A, now + 500)).toBeDefined();
    expect(store.get('deepseek', FP_A, now + 1_500)).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('removes the entry when status is ok', () => {
    const store = new BalanceStateStore();
    store.put(makeEntry({ status: 'depleted' }));
    store.put(makeEntry({ status: 'ok' }));

    expect(store.size).toBe(0);
    expect(store.get('deepseek', FP_A)).toBeUndefined();
  });

  it('keeps accounts of the same provider isolated', () => {
    const store = new BalanceStateStore();
    store.put(makeEntry({ status: 'depleted', fingerprint: FP_A }));

    expect(store.get('deepseek', FP_A)).toBeDefined();
    expect(store.get('deepseek', FP_B)).toBeUndefined();
  });

  it('clears one provider or everything', () => {
    const store = new BalanceStateStore();
    store.put(makeEntry({ status: 'depleted', fingerprint: FP_A }));
    store.put(makeEntry({ status: 'depleted', fingerprint: FP_B, provider: 'openrouter' }));

    expect(store.clear('deepseek')).toBe(1);
    expect(store.size).toBe(1);
    expect(store.clear()).toBe(1);
    expect(store.size).toBe(0);
  });

  it('clears a single account', () => {
    const store = new BalanceStateStore();
    store.put(makeEntry({ status: 'depleted', fingerprint: FP_A }));
    store.put(makeEntry({ status: 'low', fingerprint: FP_B }));

    expect(store.clear('deepseek', FP_A)).toBe(1);
    expect(store.get('deepseek', FP_A)).toBeUndefined();
    expect(store.get('deepseek', FP_B)).toBeDefined();
  });
});

describe('Plus balance state store (sidecar)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'plus-balance-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists and reloads entries', () => {
    const path = join(dir, 'plus-balance.json');
    const first = new BalanceStateStore(path);
    first.put(makeEntry({ status: 'depleted', detail: 'insufficient balance' }));

    const second = new BalanceStateStore(path);
    const entry = second.get('deepseek', FP_A);
    expect(entry?.status).toBe('depleted');
    expect(entry?.detail).toBe('insufficient balance');
    expect(entry?.modelIds).toEqual(['deepseek-v4-pro']);
  });

  it('never persists the credential itself', () => {
    const path = join(dir, 'plus-balance.json');
    const store = new BalanceStateStore(path);
    store.put(makeEntry({ status: 'depleted' }));

    const raw = readFileSync(path, 'utf8');
    expect(raw).not.toContain('key-account-a');
    expect(raw).toContain(FP_A);
    expect(JSON.parse(raw)).toMatchObject({ version: BALANCE_STATE_VERSION });
  });

  it('fails open on a corrupt state file', () => {
    const path = join(dir, 'plus-balance.json');
    writeFileSync(path, '{ not json', 'utf8');

    const store = new BalanceStateStore(path);
    expect(store.list()).toEqual([]);
    expect(store.get('deepseek', FP_A)).toBeUndefined();
  });

  it('fails open on an unwritable state path', () => {
    const store = new BalanceStateStore(join(dir, 'missing-dir', 'nested', 'state.json'));
    expect(() => store.put(makeEntry({ status: 'depleted' }))).not.toThrow();
    expect(store.get('deepseek', FP_A)?.status).toBe('depleted');
  });
});
