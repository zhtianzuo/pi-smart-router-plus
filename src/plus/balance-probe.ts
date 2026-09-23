/**
 * Balance probe orchestration (Plus P2).
 *
 * Off by default. When enabled it refreshes provider balances at most once per
 * TTL: `maybeRefresh()` is fire-and-forget from the routing hot path (never
 * awaited, never blocks TTFT), while `/smart-router balance --refresh` awaits.
 *
 * Fail-open everywhere: no credential, HTTP error, timeout, non-JSON body or
 * unrecognized schema leaves existing state untouched.
 */

import type { ModelProfile } from '../domain/types/index.js';

import {
  BALANCE_PROBE_ADAPTERS,
  findBalanceAdapter,
  probeProviderBalance,
} from './balance-adapters.js';
import {
  type BalanceStateStore,
  PROBE_STATUS_TTL_MS,
  fingerprintCredential,
} from './balance-state.js';
import type {
  BalanceProbeAdapter,
  BalanceProbeOutcome,
  BalanceStatus,
  PlusCredentialPort,
} from './balance-types.js';

export interface BalanceProbeRunResult {
  readonly provider: string;
  readonly outcome: BalanceProbeOutcome;
}

export interface BalanceProberOptions {
  readonly enabled: boolean;
  readonly ttlMs: number;
  readonly minBalance: number;
  readonly timeoutMs?: number | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly adapters?: readonly BalanceProbeAdapter[] | undefined;
  readonly now?: (() => number) | undefined;
}

function modelIdsFor(fleet: readonly ModelProfile[], provider: string): string[] {
  return fleet
    .filter((profile) => profile.provider === provider)
    .map((profile) => profile.id);
}

export class BalanceProber {
  private inFlight = false;
  private lastStartedAt = 0;

  constructor(
    private readonly store: BalanceStateStore,
    private readonly credentials: PlusCredentialPort,
    private readonly options: BalanceProberOptions,
  ) {}

  get enabled(): boolean {
    return this.options.enabled;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private adapters(): readonly BalanceProbeAdapter[] {
    return this.options.adapters ?? BALANCE_PROBE_ADAPTERS;
  }

  /** Fire-and-forget refresh for the routing hot path. */
  maybeRefresh(fleet: readonly ModelProfile[]): void {
    if (!this.options.enabled || this.inFlight) {
      return;
    }
    if (this.now() - this.lastStartedAt < this.options.ttlMs) {
      return;
    }
    void this.refresh(fleet);
  }

  /** Awaited refresh (command path). Never throws. */
  async refresh(fleet: readonly ModelProfile[]): Promise<readonly BalanceProbeRunResult[]> {
    if (!this.options.enabled || this.inFlight) {
      return [];
    }
    this.inFlight = true;
    this.lastStartedAt = this.now();

    const results: BalanceProbeRunResult[] = [];
    try {
      const providers = [...new Set(fleet.map((profile) => profile.provider))].sort();
      for (const provider of providers) {
        const adapter = findBalanceAdapter(provider, this.adapters());
        if (!adapter) {
          continue;
        }
        results.push({
          provider,
          outcome: await this.probeProvider(provider, adapter, fleet),
        });
      }
    } catch {
      // Probing must never surface as a routing or command failure.
    } finally {
      this.inFlight = false;
    }
    return results;
  }

  private async probeProvider(
    provider: string,
    adapter: BalanceProbeAdapter,
    fleet: readonly ModelProfile[],
  ): Promise<BalanceProbeOutcome> {
    let apiKey: string | undefined;
    try {
      apiKey = await this.credentials.getApiKeyForProvider(provider);
    } catch {
      apiKey = undefined;
    }
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      return {
        ok: false,
        parsed: false,
        depleted: false,
        low: false,
        balance: null,
        detail: 'no credential',
        reason: null,
      };
    }

    const outcome = await probeProviderBalance(adapter, apiKey, {
      minBalance: this.options.minBalance,
      ...(this.options.timeoutMs !== undefined
        ? { timeoutMs: this.options.timeoutMs }
        : {}),
      ...(this.options.fetchImpl !== undefined ? { fetchImpl: this.options.fetchImpl } : {}),
    });

    this.recordOutcome(provider, apiKey, outcome, modelIdsFor(fleet, provider));
    return outcome;
  }

  private recordOutcome(
    provider: string,
    apiKey: string,
    outcome: BalanceProbeOutcome,
    modelIds: readonly string[],
  ): void {
    if (!outcome.parsed) {
      // Fail open: only a *parsed* answer may change state.
      return;
    }
    const now = this.now();
    const status: BalanceStatus = outcome.depleted ? 'depleted' : outcome.low ? 'low' : 'ok';
    this.store.put({
      provider,
      fingerprint: fingerprintCredential(apiKey),
      status,
      reason: outcome.reason ?? 'balance_low',
      source: 'probe',
      observedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + PROBE_STATUS_TTL_MS).toISOString(),
      modelIds: [...modelIds],
      balance: outcome.balance,
      detail: outcome.detail,
    });
  }
}
