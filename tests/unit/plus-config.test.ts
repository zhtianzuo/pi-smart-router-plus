/**
 * Plus configuration resolution tests.
 *
 * Configuration is four booleans, resolved deterministically, and must fail
 * open on a missing or malformed file. Credentials are never read.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_PLUS_CONFIG } from '../../src/index.js';
import { resolvePlusConfig } from '../../src/plus/config.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'plus-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('Plus config', () => {
  it('defaults to Risk Guard ON, Planner Read-only ON, Verification/Reviewer OFF', () => {
    expect(DEFAULT_PLUS_CONFIG).toEqual({
      riskGuard: true,
      plannerReadOnly: true,
      verification: false,
      reviewer: false,
    });
    expect(resolvePlusConfig({ cwd: dir, env: {} })).toEqual(DEFAULT_PLUS_CONFIG);
  });

  it('reads the documented { plus: { ... } } JSON shape from config/plus.json', () => {
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(
      join(dir, 'config', 'plus.json'),
      JSON.stringify({
        plus: { riskGuard: false, plannerReadOnly: false, verification: true },
      }),
      'utf8',
    );

    const config = resolvePlusConfig({ cwd: dir, env: {} });

    expect(config).toEqual({
      riskGuard: false,
      plannerReadOnly: false,
      verification: true,
      reviewer: false,
    });
  });

  it('reads a bare plus object from an explicit config path', () => {
    const file = join(dir, 'plus.json');
    writeFileSync(
      file,
      JSON.stringify({ riskGuard: false, verification: true, reviewer: true }),
      'utf8',
    );

    const config = resolvePlusConfig({
      cwd: dir,
      env: { SMART_ROUTER_PLUS_CONFIG: file },
    });

    expect(config).toEqual({
      riskGuard: false,
      plannerReadOnly: true,
      verification: true,
      reviewer: true,
    });
  });

  it('reads the wrapped shape from an explicit config path', () => {
    const file = join(dir, 'wrapped.json');
    writeFileSync(
      file,
      JSON.stringify({ plus: { riskGuard: true, plannerReadOnly: false } }),
      'utf8',
    );

    const config = resolvePlusConfig({
      cwd: dir,
      env: { SMART_ROUTER_PLUS_CONFIG: file },
    });

    expect(config.plannerReadOnly).toBe(false);
    expect(config.riskGuard).toBe(true);
  });

  it('applies environment overrides on top of defaults', () => {
    const config = resolvePlusConfig({
      cwd: dir,
      env: {
        SMART_ROUTER_PLUS_RISK_GUARD: '0',
        SMART_ROUTER_PLUS_PLANNER_READONLY: 'off',
        SMART_ROUTER_PLUS_VERIFICATION: '1',
        SMART_ROUTER_PLUS_REVIEWER: 'true',
      },
    });

    expect(config).toEqual({
      riskGuard: false,
      plannerReadOnly: false,
      verification: true,
      reviewer: true,
    });
  });

  it('lets environment overrides win over the config file', () => {
    const file = join(dir, 'plus.json');
    writeFileSync(file, JSON.stringify({ plus: { riskGuard: false } }), 'utf8');

    const config = resolvePlusConfig({
      cwd: dir,
      env: { SMART_ROUTER_PLUS_CONFIG: file, SMART_ROUTER_PLUS_RISK_GUARD: 'on' },
    });

    expect(config.riskGuard).toBe(true);
  });

  it('fails open on a malformed config file', () => {
    const file = join(dir, 'broken.json');
    writeFileSync(file, '{ not json', 'utf8');

    const config = resolvePlusConfig({
      cwd: dir,
      env: { SMART_ROUTER_PLUS_CONFIG: file },
    });

    expect(config).toEqual(DEFAULT_PLUS_CONFIG);
  });

  it('ignores unknown keys and non-boolean values', () => {
    const file = join(dir, 'plus.json');
    writeFileSync(
      file,
      JSON.stringify({ plus: { riskGuard: 'maybe', somethingElse: true } }),
      'utf8',
    );

    const config = resolvePlusConfig({
      cwd: dir,
      env: { SMART_ROUTER_PLUS_CONFIG: file },
    });

    expect(config).toEqual(DEFAULT_PLUS_CONFIG);
    expect(Object.keys(config).sort()).toEqual([
      'plannerReadOnly',
      'reviewer',
      'riskGuard',
      'verification',
    ]);
  });
});
