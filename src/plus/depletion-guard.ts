/**
 * Depletion Guard (Plus P1) — deterministic, local, zero-network.
 *
 * Recognizes provider errors that mean "this account has no money / no quota
 * left" and turns them into a routing preference: the depleted account is
 * marked `healthy: false` for a bounded TTL, which upstream already honors in
 * context-fit, expected-cost, sub-route selection, session pinning, loop
 * escalation and safe-cloud fallback.
 *
 * Two distinct classes are kept apart on purpose:
 *   billing_depleted        (402 / insufficient balance / no credits) → long TTL
 *   quota_window_exhausted  (subscription usage limit / quota exhausted) → short TTL
 *
 * Plain rate limiting (429 without a usage/quota signal) is deliberately NOT
 * classified — upstream already handles it via the circuit breaker.
 */

import type { ModelProfile } from '../domain/types/index.js';

import type {
  BalanceEntry,
  BalanceReasonCode,
  BalanceStatus,
  DepletionClassification,
} from './balance-types.js';
import { BILLING_DEPLETED_TTL_MS, QUOTA_WINDOW_TTL_MS } from './balance-state.js';

export interface ProviderErrorLike {
  readonly statusCode?: number | undefined;
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

const BILLING_ERROR_CODES = new Set([
  'insufficient_quota',
  'insufficient_balance',
  'insufficient_funds',
  'billing_hard_limit_reached',
  'billing_not_active',
  'credit_limit_reached',
  'no_credits',
  'payment_required',
  'account_deactivated',
  'balance_insufficient',
]);

const QUOTA_WINDOW_ERROR_CODES = new Set([
  'usage_limit_exceeded',
  'resource_exhausted',
  'quota_exceeded',
  'subscription_limit_reached',
]);

const BILLING_MESSAGE_PATTERNS: readonly RegExp[] = [
  /\binsufficient\s+(?:balance|funds|credits?|quota|account\s+balance)\b/i,
  /\b(?:no|zero|out\s+of)\s+(?:credits?|funds|balance)\b/i,
  /\bbalance\s+(?:is\s+)?(?:too\s+low|low|insufficient|depleted|exhausted|zero|empty|negative)\b/i,
  /\bcredit[s]?\s+(?:exhausted|depleted|exceeded|used\s+up)\b/i,
  /\bpayment\s+required\b/i,
  /\bbilling\b[^\n]{0,40}\b(?:hard\s+limit|limit\s+reached|not\s+active|issue|problem|disabled)\b/i,
  /\b(?:recharge|top\s?up)\b[^\n]{0,40}\b(?:account|balance|credit|funds)\b/i,
  /\bplease\s+(?:recharge|top\s?up|add\s+funds)\b/i,
  /余额不足|余额为零|账户余额(?:不足|为零|过低)|欠费/,
];

const QUOTA_WINDOW_MESSAGE_PATTERNS: readonly RegExp[] = [
  /\busage\s+limit\b/i,
  /\bhit\s+your\s+usage\b/i,
  // `quota`, never bare `limit`: "rate limit reached" is a plain 429, not a
  // subscription quota window (upstream handles it via the circuit breaker).
  /\bquota\s+(?:exhausted|reached|exceeded|used\s+up)\b/i,
  /\b(?:usage|weekly|monthly|daily|plan|subscription)\s+limit\b[^\n]{0,20}\b(?:reached|exhausted|exceeded)\b/i,
  /\bresource\s+exhausted\b/i,
  /\bplan\s+limit\b/i,
  /\bsubscription\b[^\n]{0,40}\b(?:limit|exhaust\w*|expired|ended|inactive)\b/i,
  /\bswitch\s+to\s+(?:auto|a\s+paid|paid)\b/i,
  /套餐额度|额度已用尽|配额已用尽|额度耗尽|达到限额上限|用量已达上限/,
];

/**
 * Redact anything secret-looking from a provider error before it is stored in
 * the sidecar or shown by `/smart-router balance`.
 */
export function sanitizeDetail(
  text: string | undefined,
  maxLength = 160,
): string | null {
  if (!text) {
    return null;
  }
  let out = text.replace(/\s+/g, ' ').trim();
  if (!out) {
    return null;
  }
  out = out
    .replace(
      /\b(?:sk|rk|pk|gho|ghp|ghs|xox[abprs])[-_][A-Za-z0-9_-]{6,}\b/gi,
      '[redacted]',
    )
    .replace(
      /\b(bearer|authorization|api[_-]?key|apikey|token|secret|password)\b\s*[:=]?\s*[^\s,;"']+/gi,
      '$1=[redacted]',
    )
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]');
  if (out.length > maxLength) {
    out = `${out.slice(0, maxLength - 1)}…`;
  }
  return out;
}

/**
 * Classify a provider error as billing/quota depletion.
 *
 * Pure and synchronous — safe on every failure path.
 */
export function classifyDepletionError(
  error: ProviderErrorLike,
  rawText?: string | undefined,
): DepletionClassification {
  const code = error.code?.trim().toLowerCase();
  const text = `${error.message ?? ''}\n${rawText ?? ''}`;
  const detail = sanitizeDetail(error.message ?? rawText);

  if (error.statusCode === 402) {
    return {
      depleted: true,
      reason: 'billing_depleted',
      ttlMs: BILLING_DEPLETED_TTL_MS,
      detail,
    };
  }

  if (code !== undefined && BILLING_ERROR_CODES.has(code)) {
    return {
      depleted: true,
      reason: 'billing_depleted',
      ttlMs: BILLING_DEPLETED_TTL_MS,
      detail,
    };
  }

  if (text.length > 0 && BILLING_MESSAGE_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      depleted: true,
      reason: 'billing_depleted',
      ttlMs: BILLING_DEPLETED_TTL_MS,
      detail,
    };
  }

  if (code !== undefined && QUOTA_WINDOW_ERROR_CODES.has(code)) {
    return {
      depleted: true,
      reason: 'quota_window_exhausted',
      ttlMs: QUOTA_WINDOW_TTL_MS,
      detail,
    };
  }

  if (
    text.length > 0 &&
    QUOTA_WINDOW_MESSAGE_PATTERNS.some((pattern) => pattern.test(text))
  ) {
    return {
      depleted: true,
      reason: 'quota_window_exhausted',
      ttlMs: QUOTA_WINDOW_TTL_MS,
      detail,
    };
  }

  return { depleted: false, reason: null, ttlMs: null, detail: null };
}

/** Per-account status resolved for the active credential of a provider. */
export interface BlockedProvider {
  readonly provider: string;
  readonly fingerprint: string;
  readonly status: BalanceStatus;
  readonly reason: BalanceReasonCode;
  readonly detail: string | null;
}

/**
 * Resolve which providers of a fleet are currently blocked, using each
 * provider's *active* credential fingerprint.
 *
 * A credential change (new key) yields a different fingerprint, so the old
 * account's depletion no longer matches and the provider becomes usable again.
 */
export function resolveBlockedProviders(
  fleet: readonly ModelProfile[],
  fingerprints: ReadonlyMap<string, string>,
  lookup: (provider: string, fingerprint: string) => BalanceEntry | undefined,
): Map<string, BlockedProvider> {
  const blocked = new Map<string, BlockedProvider>();
  const seen = new Set<string>();
  for (const profile of fleet) {
    if (seen.has(profile.provider)) {
      continue;
    }
    seen.add(profile.provider);
    const fingerprint = fingerprints.get(profile.provider);
    if (!fingerprint) {
      continue;
    }
    const entry = lookup(profile.provider, fingerprint);
    if (!entry || entry.status === 'ok') {
      continue;
    }
    blocked.set(profile.provider, {
      provider: entry.provider,
      fingerprint: entry.fingerprint,
      status: entry.status,
      reason: entry.reason,
      detail: entry.detail,
    });
  }
  return blocked;
}

export interface FleetBalancePolicyResult {
  /** Fleet with blocked accounts marked `healthy: false` (original array when nothing is blocked). */
  readonly fleet: readonly ModelProfile[];
  /** Model ids excluded because their account is depleted/low. */
  readonly excludedModelIds: readonly string[];
  /** True when every model was blocked and the policy fell back to the full fleet. */
  readonly failOpen: boolean;
}

/**
 * Mark models of blocked accounts as unhealthy.
 *
 * Fail-open by construction: if honoring the policy would leave no routable
 * model, the original fleet is returned unchanged so Plus can never wedge
 * routing into a dead end.
 */
export function applyFleetBalancePolicy(
  fleet: readonly ModelProfile[],
  blocked: ReadonlyMap<string, BlockedProvider>,
): FleetBalancePolicyResult {
  if (blocked.size === 0) {
    return { fleet, excludedModelIds: [], failOpen: false };
  }

  const excludedModelIds: string[] = [];
  const marked: ModelProfile[] = [];
  let healthyCount = 0;

  for (const profile of fleet) {
    if (blocked.has(profile.provider)) {
      excludedModelIds.push(profile.id);
      marked.push(profile.healthy === false ? profile : { ...profile, healthy: false });
      continue;
    }
    healthyCount += 1;
    marked.push(profile);
  }

  if (healthyCount === 0) {
    return { fleet, excludedModelIds: [], failOpen: true };
  }

  return { fleet: marked, excludedModelIds, failOpen: false };
}
