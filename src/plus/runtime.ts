/**
 * Plus runtime — composition of Risk Guard, Planner Read-only Guard and the
 * account-level Depletion Guard (P1) / Balance Probe (P2).
 *
 * Additive layer only: it never routes, never selects models and never calls an
 * LLM. Route decisions stay with upstream pi-smart-router.
 */

import { join } from 'node:path';

import type { ModelProfile, RoutingDecision, RoutingRequest } from '../domain/types/index.js';

import {
  BALANCE_PROBE_TIMEOUT_MS,
} from './balance-adapters.js';
import { BalanceProber } from './balance-probe.js';
import {
  type BalanceStateStore,
  BalanceStateStore as BalanceStateStoreImpl,
  UNKNOWN_FINGERPRINT,
  fingerprintCredential,
} from './balance-state.js';
import type {
  BalanceEntry,
  BalanceReasonCode,
  BalanceStatus,
  PlusCredentialPort,
} from './balance-types.js';
import { resolvePlusConfig } from './config.js';
import {
  applyFleetBalancePolicy,
  classifyDepletionError,
  resolveBlockedProviders,
  type ProviderErrorLike,
} from './depletion-guard.js';
import {
  PlannerReadonlyGuard,
  type PlannerToolGate,
} from './planner-readonly.js';
import {
  applyRiskGuardToRequest,
  classifyRisk,
  extractToolCallSurface,
  riskInputFromToolCall,
} from './risk-guard.js';
import { PlusTaskState } from './task-state.js';
import type { PlusConfig, RiskDecision } from './types.js';

const LOW_RISK: RiskDecision = { level: 'low', reasons: [] };

/** Credential fingerprint cache lifetime (picks up key rotation eventually). */
const FINGERPRINT_TTL_MS = 5 * 60 * 1000;
/** How long a failed credential lookup is remembered. */
const FINGERPRINT_MISS_TTL_MS = 60 * 1000;

export const PLUS_BALANCE_STATE_PATH = '.pi-smart-router/plus-balance.json';

export interface PlusRiskApplication {
  readonly request: RoutingRequest;
  readonly risk: RiskDecision;
  readonly planningForced: boolean;
}

export interface ToolCallRiskRecord {
  readonly risk: RiskDecision;
  readonly blocked: boolean;
  readonly reason: string | null;
}

export interface PlusRuntimeOptions {
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly config?: PlusConfig | undefined;
  readonly gate?: PlannerToolGate | undefined;
  readonly plannerGuard?: PlannerReadonlyGuard | undefined;
  readonly taskState?: PlusTaskState | undefined;
  readonly balanceState?: BalanceStateStore | undefined;
  readonly balanceStatePath?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly now?: (() => number) | undefined;
}

export class PlusRuntime {
  readonly config: PlusConfig;
  readonly taskState: PlusTaskState;
  readonly plannerGuard: PlannerReadonlyGuard;
  readonly balanceState: BalanceStateStore;
  private readonly balanceProber: BalanceProber;
  private readonly now: () => number;
  private readonly fingerprints = new Map<string, { value: string; at: number }>();
  private credentials: PlusCredentialPort | undefined;

  constructor(options?: PlusRuntimeOptions) {
    this.config =
      options?.config ?? resolvePlusConfig({ cwd: options?.cwd, env: options?.env });
    this.taskState = options?.taskState ?? new PlusTaskState();
    this.plannerGuard = options?.plannerGuard ?? new PlannerReadonlyGuard();
    if (options?.gate) {
      this.plannerGuard.bindGate(options.gate);
    }
    this.now = options?.now ?? (() => Date.now());

    const statePath =
      options?.balanceStatePath ??
      (options?.cwd !== undefined ? join(options.cwd, PLUS_BALANCE_STATE_PATH) : null);
    this.balanceState =
      options?.balanceState ?? new BalanceStateStoreImpl(statePath);

    this.balanceProber = new BalanceProber(
      this.balanceState,
      {
        getApiKeyForProvider: (provider) =>
          this.credentials?.getApiKeyForProvider(provider) ?? Promise.resolve(undefined),
      },
      {
        enabled: this.config.balanceProbe,
        ttlMs: this.config.balanceProbeTtlSeconds * 1000,
        minBalance: this.config.minBalance,
        timeoutMs: BALANCE_PROBE_TIMEOUT_MS,
        ...(options?.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
        ...(options?.now !== undefined ? { now: options.now } : {}),
      },
    );
  }

  // ─── Risk Guard ─────────────────────────────────────────────────────────────

  /** Classify risk for a routed turn and apply the planning policy. */
  applyRisk(
    request: RoutingRequest,
    messages: readonly unknown[] = [],
  ): PlusRiskApplication {
    const application = applyRiskGuardToRequest(
      request,
      {
        prompt: request.prompt_text,
        commands: extractToolCallSurface(messages),
      },
      this.config,
    );

    this.taskState.recordRisk(request.session_id, application.risk, {
      sessionId: request.session_id,
      turnType: application.request.turn_type ?? request.turn_type ?? 'unknown',
      planningForced: application.planningForced,
    });

    return application;
  }

  recordDecision(
    sessionId: string | undefined,
    decision: Pick<RoutingDecision, 'stage' | 'reason_code' | 'selected_model_id'>,
  ): void {
    this.taskState.recordDecision(sessionId, {
      stage: decision.stage,
      reasonCode: decision.reason_code,
      selectedModelId: decision.selected_model_id,
    });
  }

  recordPlanningGuard(sessionId: string | undefined, applied: boolean): void {
    this.taskState.recordPlanningGuard(sessionId, applied);
  }

  evaluateToolCall(
    toolName: string,
    input: unknown,
    sessionId?: string | undefined,
  ): ToolCallRiskRecord {
    const planner = this.plannerGuard.evaluateToolCall(toolName, input, sessionId);
    if (planner.blocked) {
      return { risk: LOW_RISK, blocked: true, reason: planner.reason };
    }

    const risk = this.config.riskGuard
      ? classifyRisk(riskInputFromToolCall(toolName, input))
      : LOW_RISK;
    return { risk, blocked: false, reason: null };
  }

  // ─── Depletion Guard (P1) ───────────────────────────────────────────────────

  /**
   * Mark models whose account is depleted/low as `healthy: false` for this
   * request. Never empties the fleet (fail-open).
   */
  async applyBalancePolicy(
    fleet: readonly ModelProfile[],
    credentials: PlusCredentialPort,
  ): Promise<readonly ModelProfile[]> {
    if (!this.config.balanceGuard) {
      return fleet;
    }
    this.credentials = credentials;

    try {
      const blocked = await this.resolveBlocked(fleet, credentials);
      if (blocked.size === 0) {
        return fleet;
      }
      const result = applyFleetBalancePolicy(fleet, blocked);
      if (result.failOpen) {
        console.warn(
          '[smart-router plus] balance policy fail-open: every model account is depleted; using the full fleet',
        );
        return fleet;
      }
      console.warn(
        '[smart-router plus] balance policy excluded models',
        JSON.stringify({ excluded: result.excludedModelIds }),
      );
      return result.fleet;
    } catch {
      // Fail open: balance policy must never break routing.
      return fleet;
    }
  }

  /**
   * Remember a provider error that proves the account has no money/quota left.
   * Callers use `void` — this never throws and never blocks.
   */
  async recordProviderError(
    model: { readonly provider: string; readonly id: string },
    error: ProviderErrorLike,
    credentials: PlusCredentialPort,
    rawText?: string | undefined,
  ): Promise<void> {
    if (!this.config.balanceGuard) {
      return;
    }
    try {
      const classification = classifyDepletionError(error, rawText);
      if (
        !classification.depleted ||
        classification.reason === null ||
        classification.ttlMs === null
      ) {
        return;
      }
      this.credentials = credentials;
      const fingerprint = await this.resolveFingerprint(model.provider, credentials);
      const now = this.now();
      const key = `${model.provider}|${fingerprint}`;
      const existing = this.balanceState.list(now).find(
        (entry) => `${entry.provider}|${entry.fingerprint}` === key,
      );
      const modelIds = [...new Set([...(existing?.modelIds ?? []), model.id])];

      this.balanceState.put({
        provider: model.provider,
        fingerprint,
        status: 'depleted',
        reason: classification.reason,
        source: 'error',
        observedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + classification.ttlMs).toISOString(),
        modelIds,
        balance: existing?.balance ?? null,
        detail: classification.detail,
      });
      console.warn(
        '[smart-router plus] account marked depleted',
        JSON.stringify({
          provider: model.provider,
          fingerprint,
          reason: classification.reason,
          model_id: model.id,
        }),
      );
    } catch {
      // Fail open.
    }
  }

  /** Fire-and-forget P2 refresh; safe to call on every routed turn. */
  refreshBalances(fleet: readonly ModelProfile[], credentials: PlusCredentialPort): void {
    if (!this.config.balanceProbe) {
      return;
    }
    this.credentials = credentials;
    this.balanceProber.maybeRefresh(fleet);
  }

  /** Awaited P2 refresh for `/smart-router balance --refresh`. */
  async probeBalances(
    fleet: readonly ModelProfile[],
    credentials: PlusCredentialPort,
  ): Promise<readonly { provider: string; detail: string | null; parsed: boolean }[]> {
    if (!this.config.balanceProbe) {
      return [];
    }
    this.credentials = credentials;
    const results = await this.balanceProber.refresh(fleet);
    return results.map((result) => ({
      provider: result.provider,
      detail: result.outcome.detail,
      parsed: result.outcome.parsed,
    }));
  }

  // ─── Balance state accessors ────────────────────────────────────────────────

  balanceEntries(): readonly BalanceEntry[] {
    return this.balanceState.list(this.now());
  }

  blockedAccounts(): readonly BalanceEntry[] {
    return this.balanceEntries().filter((entry) => entry.status !== 'ok');
  }

  clearBalance(provider?: string | undefined): number {
    return provider === undefined
      ? this.balanceState.clear()
      : this.balanceState.clear(provider);
  }

  private async resolveBlocked(
    fleet: readonly ModelProfile[],
    credentials: PlusCredentialPort,
  ): Promise<
    Map<
      string,
      {
        provider: string;
        fingerprint: string;
        status: BalanceStatus;
        reason: BalanceReasonCode;
        detail: string | null;
      }
    >
  > {
    const providers = [...new Set(fleet.map((profile) => profile.provider))];
    const fingerprints = new Map<string, string>();
    for (const provider of providers) {
      const fingerprint = await this.resolveFingerprint(provider, credentials);
      if (fingerprint !== UNKNOWN_FINGERPRINT) {
        fingerprints.set(provider, fingerprint);
      }
    }
    return resolveBlockedProviders(fleet, fingerprints, (provider, fingerprint) =>
      this.balanceState.get(provider, fingerprint, this.now()),
    );
  }

  private async resolveFingerprint(
    provider: string,
    credentials: PlusCredentialPort,
  ): Promise<string> {
    const cached = this.fingerprints.get(provider);
    const now = this.now();
    if (cached) {
      const ttl =
        cached.value === UNKNOWN_FINGERPRINT ? FINGERPRINT_MISS_TTL_MS : FINGERPRINT_TTL_MS;
      if (now - cached.at < ttl) {
        return cached.value;
      }
    }

    let value = UNKNOWN_FINGERPRINT;
    try {
      const apiKey = await credentials.getApiKeyForProvider(provider);
      if (typeof apiKey === 'string' && apiKey.length > 0) {
        value = fingerprintCredential(apiKey);
      }
    } catch {
      value = UNKNOWN_FINGERPRINT;
    }
    this.fingerprints.set(provider, { value, at: now });
    return value;
  }
}

/** Create the Plus runtime with default (documented) configuration. */
export function createPlusRuntime(options?: PlusRuntimeOptions): PlusRuntime {
  return new PlusRuntime(options);
}
