/**
 * Balance probe adapters (Plus P2) — only officially documented endpoints.
 *
 * Endpoints:
 *   deepseek    GET https://api.deepseek.com/user/balance
 *               → { is_available, balance_infos: [{ currency, total_balance, ... }] }
 *               https://api-docs.deepseek.com/api/get-user-balance
 *   openrouter  GET https://openrouter.ai/api/v1/credits
 *               → { data: { total_credits, total_usage } }   (management key)
 *               https://openrouter.ai/docs/api/api-reference/credits/get-credits
 *   minimax-cn  GET https://www.minimax.cn/v1/token_plan/remains
 *               → response body is NOT published in the official docs
 *               (https://platform.minimaxi.com/docs/token-plan/faq "如何查看 Token Plan 用量").
 *               Read tolerantly and fail open on anything unrecognized.
 *
 * Hard rule: an HTTP error, a non-subscription key, an unparseable body or a
 * timeout NEVER marks an account depleted — probes only ever *add* information.
 */

import type {
  BalanceObservation,
  BalanceProbeAdapter,
  BalanceProbeOutcome,
  BalanceReasonCode,
} from './balance-types.js';

/** Probe must never slow routing down noticeably. */
export const BALANCE_PROBE_TIMEOUT_MS = 3_000;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function unavailable(detail: string): BalanceProbeOutcome {
  return {
    ok: false,
    parsed: false,
    depleted: false,
    low: false,
    balance: null,
    detail,
    reason: null,
  };
}

function ok(balance: BalanceObservation): BalanceProbeOutcome {
  return {
    ok: true,
    parsed: true,
    depleted: false,
    low: false,
    balance,
    detail: null,
    reason: null,
  };
}

function classified(
  balance: BalanceObservation,
  reason: BalanceReasonCode,
  depleted: boolean,
  detail: string,
): BalanceProbeOutcome {
  return {
    ok: true,
    parsed: true,
    depleted,
    low: !depleted,
    balance,
    detail,
    reason,
  };
}

// ─── DeepSeek ─────────────────────────────────────────────────────────────────

function parseDeepSeek(payload: unknown, minBalance: number): BalanceProbeOutcome {
  const record = asRecord(payload);
  if (!record) {
    return unavailable('unrecognized response');
  }

  const available = record['is_available'];
  const infos = record['balance_infos'];
  const first = Array.isArray(infos) ? asRecord(infos[0]) : undefined;

  const rawTotal = first?.['total_balance'];
  const total = toNumber(rawTotal);
  const currency =
    typeof first?.['currency'] === 'string' ? (first['currency'] as string) : 'CNY';

  if (typeof available !== 'boolean' && total === null) {
    return unavailable('unrecognized response');
  }

  const observation: BalanceObservation = {
    currency,
    total: total === null ? 'unknown' : String(rawTotal ?? total),
    available: available !== false,
  };

  if (available === false) {
    return classified(observation, 'billing_depleted', true, 'is_available=false');
  }
  if (total !== null) {
    if (total <= 0) {
      return classified(observation, 'billing_depleted', true, `total_balance=${observation.total}`);
    }
    if (total <= minBalance) {
      return classified(observation, 'balance_low', false, `total_balance=${observation.total}`);
    }
  }
  return ok(observation);
}

// ─── OpenRouter ───────────────────────────────────────────────────────────────

function parseOpenRouter(payload: unknown, minBalance: number): BalanceProbeOutcome {
  const root = asRecord(payload);
  const data = root ? asRecord(root['data']) : undefined;
  const credits = toNumber(data?.['total_credits']);
  const usage = toNumber(data?.['total_usage']);

  if (credits === null || usage === null) {
    return unavailable('unrecognized response');
  }

  const remaining = credits - usage;
  const observation: BalanceObservation = {
    currency: 'USD',
    total: remaining.toFixed(2),
    available: remaining > 0,
  };

  if (remaining <= 0) {
    return classified(observation, 'billing_depleted', true, `remaining=${observation.total}`);
  }
  if (remaining <= minBalance) {
    return classified(observation, 'balance_low', false, `remaining=${observation.total}`);
  }
  return ok(observation);
}

// ─── MiniMax (Token Plan) ─────────────────────────────────────────────────────

const REMAINING_KEY_PATTERN = /remain|left|available|surplus|unused|balance|quota|credit|积分|额度/i;
const MAX_WALK_DEPTH = 4;
const MAX_WALK_KEYS = 64;

interface QuotaNumber {
  readonly key: string;
  readonly value: number;
}

/** Depth- and size-bounded numeric field harvest (never throws). */
function collectQuotaNumbers(
  value: unknown,
  out: QuotaNumber[],
  depth = 0,
  keyPath = '',
): void {
  if (depth > MAX_WALK_DEPTH || out.length >= MAX_WALK_KEYS) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectQuotaNumbers(item, out, depth + 1, keyPath);
    }
    return;
  }
  const record = asRecord(value);
  if (!record) {
    return;
  }
  for (const [key, child] of Object.entries(record)) {
    const numeric = toNumber(child);
    if (numeric !== null) {
      if (REMAINING_KEY_PATTERN.test(key)) {
        out.push({ key: keyPath ? `${keyPath}.${key}` : key, value: numeric });
      }
      continue;
    }
    collectQuotaNumbers(child, out, depth + 1, keyPath ? `${keyPath}.${key}` : key);
  }
}

/**
 * MiniMax publishes the Token Plan quota endpoint but not its response schema,
 * so read every numeric field whose name looks like a remaining quota and use
 * the smallest one (the binding window: 5-hour or weekly). Anything else fails
 * open — a non-subscription key must never disable the provider.
 */
function parseMiniMaxTokenPlan(
  payload: unknown,
  minBalance: number,
): BalanceProbeOutcome {
  const found: QuotaNumber[] = [];
  collectQuotaNumbers(payload, found);
  if (found.length === 0) {
    return unavailable('unrecognized response (schema not published)');
  }

  let min = found[0]!;
  for (const candidate of found) {
    if (candidate.value < min.value) {
      min = candidate;
    }
  }

  const observation: BalanceObservation = {
    currency: 'credit',
    total: String(min.value),
    available: min.value > 0,
  };
  const detail = `token_plan ${min.key}=${min.value}`;

  if (min.value <= 0) {
    return classified(observation, 'quota_window_exhausted', true, detail);
  }
  if (min.value <= minBalance) {
    return classified(observation, 'balance_low', false, detail);
  }
  return ok(observation);
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const BALANCE_PROBE_ADAPTERS: readonly BalanceProbeAdapter[] = [
  { provider: 'deepseek', endpoint: 'https://api.deepseek.com/user/balance', parse: parseDeepSeek },
  { provider: 'openrouter', endpoint: 'https://openrouter.ai/api/v1/credits', parse: parseOpenRouter },
  {
    provider: 'minimax-cn',
    endpoint: 'https://www.minimax.cn/v1/token_plan/remains',
    parse: parseMiniMaxTokenPlan,
  },
];

export function findBalanceAdapter(
  provider: string,
  adapters: readonly BalanceProbeAdapter[] = BALANCE_PROBE_ADAPTERS,
): BalanceProbeAdapter | undefined {
  return adapters.find((adapter) => adapter.provider === provider);
}

export interface ProbeFetchResult {
  readonly outcome: BalanceProbeOutcome;
}

/**
 * One probe request. `fetchImpl` is injectable for tests; network/HTTP/parse
 * failures all resolve to a non-parsed outcome (fail open).
 */
export async function probeProviderBalance(
  adapter: BalanceProbeAdapter,
  apiKey: string,
  options: {
    readonly minBalance: number;
    readonly timeoutMs?: number;
    readonly fetchImpl?: typeof fetch;
    readonly signal?: AbortSignal | undefined;
  },
): Promise<BalanceProbeOutcome> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return unavailable('fetch unavailable');
  }

  const timeoutMs = options.timeoutMs ?? BALANCE_PROBE_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;

  try {
    const response = await fetchImpl(adapter.endpoint, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
      },
      signal,
    });

    if (!response.ok) {
      // 401/403 = wrong key kind (e.g. non-subscription key), 404 = endpoint
      // moved, 429/5xx = transient. None of these prove depletion.
      return unavailable(`http ${response.status}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return unavailable('non-JSON response');
    }

    try {
      return adapter.parse(payload, options.minBalance);
    } catch {
      return unavailable('parse failed');
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    return unavailable(timedOut ? 'timeout' : 'request failed');
  }
}
