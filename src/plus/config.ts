/**
 * Plus configuration resolution.
 *
 * Minimal by design. Loaded from (in increasing precedence):
 *   1. DEFAULT_PLUS_CONFIG
 *   2. optional JSON file — `$SMART_ROUTER_PLUS_CONFIG` or `<cwd>/config/plus.json`
 *   3. environment variables
 *
 * Accepted JSON shape (either wrapper or bare object):
 *   { "plus": { "riskGuard": true, "plannerReadOnly": true,
 *               "verification": false, "reviewer": false,
 *               "balanceGuard": true, "balanceProbe": false,
 *               "minBalance": 0, "balanceProbeTtlSeconds": 600 } }
 *
 * Never stores or reads credentials — only flags, thresholds and intervals.
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { DEFAULT_PLUS_CONFIG, type PlusConfig } from './types.js';

export const PLUS_CONFIG_ENV_PATH = 'SMART_ROUTER_PLUS_CONFIG';
export const DEFAULT_PLUS_CONFIG_PATH = 'config/plus.json';

type BooleanKey = {
  [K in keyof PlusConfig]: PlusConfig[K] extends boolean ? K : never;
}[keyof PlusConfig];

type NumberKey = {
  [K in keyof PlusConfig]: PlusConfig[K] extends number ? K : never;
}[keyof PlusConfig];

const BOOLEAN_ENV_KEYS: Readonly<Record<BooleanKey, string>> = {
  riskGuard: 'SMART_ROUTER_PLUS_RISK_GUARD',
  plannerReadOnly: 'SMART_ROUTER_PLUS_PLANNER_READONLY',
  verification: 'SMART_ROUTER_PLUS_VERIFICATION',
  reviewer: 'SMART_ROUTER_PLUS_REVIEWER',
  balanceGuard: 'SMART_ROUTER_PLUS_BALANCE_GUARD',
  balanceProbe: 'SMART_ROUTER_PLUS_BALANCE_PROBE',
};

const NUMBER_ENV_KEYS: Readonly<Record<NumberKey, string>> = {
  minBalance: 'SMART_ROUTER_PLUS_MIN_BALANCE',
  balanceProbeTtlSeconds: 'SMART_ROUTER_PLUS_BALANCE_PROBE_TTL_SECONDS',
};

const BOOLEAN_KEYS = Object.keys(BOOLEAN_ENV_KEYS) as BooleanKey[];
const NUMBER_KEYS = Object.keys(NUMBER_ENV_KEYS) as NumberKey[];

const TRUTHY = new Set(['1', 'true', 'on', 'yes', 'enabled']);
const FALSEY = new Set(['0', 'false', 'off', 'no', 'disabled']);

type MutablePlusConfig = { -readonly [K in keyof PlusConfig]: PlusConfig[K] };

function parseBooleanish(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (TRUTHY.has(normalized)) {
      return true;
    }
    if (FALSEY.has(normalized)) {
      return false;
    }
  }
  return undefined;
}

function parseNumeric(value: unknown, minimum: number): number | undefined {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number.parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.max(minimum, parsed);
}

function readConfigFile(path: string): Partial<MutablePlusConfig> {
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    const candidate = record['plus'];
    const section =
      candidate !== null && typeof candidate === 'object'
        ? (candidate as Record<string, unknown>)
        : record;

    const result: Partial<MutablePlusConfig> = {};
    for (const key of BOOLEAN_KEYS) {
      const value = parseBooleanish(section[key]);
      if (value !== undefined) {
        result[key] = value;
      }
    }
    for (const key of NUMBER_KEYS) {
      const value = parseNumeric(section[key], key === 'minBalance' ? 0 : 1);
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  } catch {
    // Fail open: a missing or malformed config file must never break routing.
    return {};
  }
}

export interface ResolvePlusConfigOptions {
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
}

/** Resolve the effective Plus configuration. Deterministic and side-effect free. */
export function resolvePlusConfig(options?: ResolvePlusConfigOptions): PlusConfig {
  const env = options?.env ?? process.env;
  const cwd = options?.cwd ?? process.cwd();

  const config: MutablePlusConfig = { ...DEFAULT_PLUS_CONFIG };

  const explicitPath = env[PLUS_CONFIG_ENV_PATH];
  const filePath =
    explicitPath && explicitPath.length > 0
      ? isAbsolute(explicitPath)
        ? explicitPath
        : resolve(cwd, explicitPath)
      : resolve(cwd, DEFAULT_PLUS_CONFIG_PATH);

  Object.assign(config, readConfigFile(filePath));

  for (const key of BOOLEAN_KEYS) {
    const value = parseBooleanish(env[BOOLEAN_ENV_KEYS[key]]);
    if (value !== undefined) {
      config[key] = value;
    }
  }
  for (const key of NUMBER_KEYS) {
    const value = parseNumeric(env[NUMBER_ENV_KEYS[key]], key === 'minBalance' ? 0 : 1);
    if (value !== undefined) {
      config[key] = value;
    }
  }

  return config;
}
