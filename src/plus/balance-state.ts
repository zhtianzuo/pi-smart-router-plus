/**
 * Plus balance state — small, Plus-owned sidecar persistence.
 *
 * Why a sidecar instead of StorePort: upstream's store schema is pinned to
 * routing telemetry/pins/pricing, and extending it would touch upstream
 * persistence plus its tests. Plus needs only a handful of account records, so
 * it keeps its own atomic JSON file under the existing state directory.
 *
 * Guarantees:
 *   - never stores the credential, only a truncated SHA-256 fingerprint
 *   - never throws: corrupt/missing/unwritable state fails open
 *   - expiry is TTL-based and pruned on load and write
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { BalanceEntry, BalanceStatus } from './balance-types.js';

export const BALANCE_STATE_VERSION = 1;

/** Billing quota exhausted (402 / insufficient balance) — expensive to re-learn. */
export const BILLING_DEPLETED_TTL_MS = 6 * 60 * 60 * 1000;
/** Subscription usage window exhausted — resets on its own, short cooldown. */
export const QUOTA_WINDOW_TTL_MS = 30 * 60 * 1000;
/** Probe-derived low/depleted status — cheap to refresh, may go stale after top-up. */
export const PROBE_STATUS_TTL_MS = 30 * 60 * 1000;

/** Fingerprint used when the credential could not be resolved. */
export const UNKNOWN_FINGERPRINT = 'fp_unknown';

const VALID_STATUSES: readonly BalanceStatus[] = ['ok', 'low', 'depleted'];

/** Non-reversible, non-sensitive credential fingerprint. */
export function fingerprintCredential(secret: string): string {
  const digest = createHash('sha256').update(secret, 'utf8').digest('hex');
  return `fp_${digest.slice(0, 12)}`;
}

/** `provider|fingerprint` — one account never affects another. */
export function balanceStateKey(provider: string, fingerprint: string): string {
  return `${provider}|${fingerprint}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isValidEntry(value: unknown): value is BalanceEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    isNonEmptyString(entry['provider']) &&
    isNonEmptyString(entry['fingerprint']) &&
    isNonEmptyString(entry['reason']) &&
    isNonEmptyString(entry['observedAt']) &&
    isNonEmptyString(entry['expiresAt']) &&
    typeof entry['status'] === 'string' &&
    (VALID_STATUSES as readonly string[]).includes(entry['status'])
  );
}

/**
 * In-memory + sidecar balance state.
 *
 * `filePath === null` keeps the store in memory only (used by tests and when no
 * writable state directory is available).
 */
export class BalanceStateStore {
  private readonly entries = new Map<string, BalanceEntry>();
  private loaded = false;

  constructor(private readonly filePath: string | null = null) {}

  /** Load once from disk; corrupt files are ignored (fail open). */
  private ensureLoaded(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    if (!this.filePath) {
      return;
    }
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) {
        return;
      }
      const fileEntries = (parsed as Record<string, unknown>)['entries'];
      if (typeof fileEntries !== 'object' || fileEntries === null) {
        return;
      }
      for (const [key, value] of Object.entries(fileEntries as Record<string, unknown>)) {
        if (isValidEntry(value)) {
          this.entries.set(key, value);
        }
      }
      this.prune();
    } catch {
      // Missing, unreadable or malformed state must never break routing.
    }
  }

  private persist(): void {
    if (!this.filePath) {
      return;
    }
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const tmpPath = `${this.filePath}.tmp`;
      const payload = JSON.stringify(
        {
          version: BALANCE_STATE_VERSION,
          entries: Object.fromEntries(this.entries),
        },
        null,
        2,
      );
      writeFileSync(tmpPath, payload, 'utf8');
      renameSync(tmpPath, this.filePath);
    } catch {
      // Read-only filesystem / Drive placeholder: keep in-memory state only.
    }
  }

  /** Drop expired entries. Returns the number removed. */
  prune(now: number = Date.now()): number {
    this.ensureLoaded();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      const expiresAt = Date.parse(entry.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= now) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /** All live entries, newest first. */
  list(now: number = Date.now()): readonly BalanceEntry[] {
    this.ensureLoaded();
    this.prune(now);
    return [...this.entries.values()].sort((a, b) =>
      a.provider === b.provider
        ? a.fingerprint.localeCompare(b.fingerprint)
        : a.provider.localeCompare(b.provider),
    );
  }

  get(
    provider: string,
    fingerprint: string,
    now: number = Date.now(),
  ): BalanceEntry | undefined {
    this.ensureLoaded();
    const entry = this.entries.get(balanceStateKey(provider, fingerprint));
    if (!entry) {
      return undefined;
    }
    const expiresAt = Date.parse(entry.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      this.entries.delete(balanceStateKey(provider, fingerprint));
      return undefined;
    }
    return entry;
  }

  /** Upsert an entry. `ok` entries are removed instead of stored. */
  put(entry: BalanceEntry): void {
    this.ensureLoaded();
    const key = balanceStateKey(entry.provider, entry.fingerprint);
    if (entry.status === 'ok') {
      if (this.entries.delete(key)) {
        this.persist();
      }
      return;
    }
    this.entries.set(key, entry);
    this.prune();
    this.persist();
  }

  /** Clear one account (or everything) — used by `/smart-router balance --clear`. */
  clear(provider?: string, fingerprint?: string): number {
    this.ensureLoaded();
    if (provider === undefined) {
      const size = this.entries.size;
      this.entries.clear();
      this.persist();
      return size;
    }
    if (fingerprint !== undefined) {
      const removed = this.entries.delete(balanceStateKey(provider, fingerprint)) ? 1 : 0;
      if (removed > 0) {
        this.persist();
      }
      return removed;
    }
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(`${provider}|`)) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    if (removed > 0) {
      this.persist();
    }
    return removed;
  }

  get size(): number {
    this.ensureLoaded();
    return this.entries.size;
  }
}
