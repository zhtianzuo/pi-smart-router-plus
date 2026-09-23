/**
 * Pi Smart Router Plus — balance / depletion types.
 *
 * Balance state is keyed by `provider + credential fingerprint` so one
 * depleted account never disables another account of the same provider. The
 * fingerprint is a truncated SHA-256 of the credential — the credential itself
 * is never persisted and never logged.
 */

/** Coarse per-account status used by the routing policy. */
export type BalanceStatus = 'ok' | 'low' | 'depleted';

/** Why an account is marked low/depleted. */
export type BalanceReasonCode =
  | 'billing_depleted'
  | 'quota_window_exhausted'
  | 'balance_low'
  | 'balance_unavailable';

/** Where the observation came from. */
export type BalanceSource = 'error' | 'probe';

/** Numeric balance reported by a provider probe (kept as string: APIs return strings). */
export interface BalanceObservation {
  readonly currency: string;
  readonly total: string;
  /** Provider's own availability flag (e.g. DeepSeek `is_available`). */
  readonly available: boolean;
}

/** One persisted account-level balance/depletion record. */
export interface BalanceEntry {
  readonly provider: string;
  /** Non-sensitive credential fingerprint (`fp_<12 hex>`). Never the credential. */
  readonly fingerprint: string;
  readonly status: BalanceStatus;
  readonly reason: BalanceReasonCode;
  readonly source: BalanceSource;
  readonly observedAt: string;
  readonly expiresAt: string;
  /** Model ids seen on this account (display only). */
  readonly modelIds: readonly string[];
  readonly balance: BalanceObservation | null;
  /** Short, non-sensitive detail for `/smart-router balance`. */
  readonly detail: string | null;
}

/** Result of classifying a provider error as billing/quota exhaustion. */
export interface DepletionClassification {
  readonly depleted: boolean;
  readonly reason: BalanceReasonCode | null;
  readonly ttlMs: number | null;
  readonly detail: string | null;
}

/** Result of a single provider balance probe. */
export interface BalanceProbeOutcome {
  readonly ok: boolean;
  /** True when the probe reached the provider and parsed a usable answer. */
  readonly parsed: boolean;
  readonly depleted: boolean;
  readonly low: boolean;
  readonly balance: BalanceObservation | null;
  /** Short non-sensitive reason for status output. */
  readonly detail: string | null;
  readonly reason: BalanceReasonCode | null;
}

/** Injection surface for balance probes (tests + extension wiring). */
export interface BalanceProbeAdapter {
  readonly provider: string;
  /** Documented balance/quota endpoint. */
  readonly endpoint: string;
  readonly parse: (payload: unknown, minBalance: number) => BalanceProbeOutcome;
}

/** Minimal credential port — structurally satisfied by pi's ModelRegistry. */
export interface PlusCredentialPort {
  getApiKeyForProvider(provider: string): Promise<string | undefined>;
}
