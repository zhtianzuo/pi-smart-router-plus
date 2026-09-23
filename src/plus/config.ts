/**
 * Plus configuration resolution.
 *
 * Minimal by design: four booleans. Loaded from (in increasing precedence):
 *   1. DEFAULT_PLUS_CONFIG
 *   2. optional JSON file — `$SMART_ROUTER_PLUS_CONFIG` or `<cwd>/config/plus.json`
 *   3. environment variables
 *
 * Accepted JSON shape (either wrapper or bare object):
 *   { "plus": { "riskGuard": true, "plannerReadOnly": true,
 *               "verification": false, "reviewer": false } }
 *
 * Never stores or reads credentials — only booleans.
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { DEFAULT_PLUS_CONFIG, type PlusConfig } from './types.js';

export const PLUS_CONFIG_ENV_PATH = 'SMART_ROUTER_PLUS_CONFIG';
export const DEFAULT_PLUS_CONFIG_PATH = 'config/plus.json';

const ENV_KEYS: Readonly<Record<keyof PlusConfig, string>> = {
  riskGuard: 'SMART_ROUTER_PLUS_RISK_GUARD',
  plannerReadOnly: 'SMART_ROUTER_PLUS_PLANNER_READONLY',
  verification: 'SMART_ROUTER_PLUS_VERIFICATION',
  reviewer: 'SMART_ROUTER_PLUS_REVIEWER',
};

const TRUTHY = new Set(['1', 'true', 'on', 'yes', 'enabled']);
const FALSEY = new Set(['0', 'false', 'off', 'no', 'disabled']);

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

function readConfigFile(path: string): Partial<PlusConfig> {
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
    for (const key of ENV_KEYS_KEYS) {
      const value = parseBooleanish(section[key]);
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

type MutablePlusConfig = { -readonly [K in keyof PlusConfig]: PlusConfig[K] };
const ENV_KEYS_KEYS = Object.keys(ENV_KEYS) as Array<keyof PlusConfig>;

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

  for (const key of ENV_KEYS_KEYS) {
    const value = parseBooleanish(env[ENV_KEYS[key]]);
    if (value !== undefined) {
      config[key] = value;
    }
  }

  return config;
}
