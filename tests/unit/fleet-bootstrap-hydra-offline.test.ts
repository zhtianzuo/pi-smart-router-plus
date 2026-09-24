/**
 * Hydrates `configureTransformersOfflineEnv`: when `SMART_ROUTER_HF_OFFLINE=1`
 * the HyDRA matcher must disable @huggingface/transformers remote fetches and
 * pin its caches to the project-local artifact dir, so the gateway RPC child
 * never blocks on a HuggingFace HEAD (FEISHU-VS-20260817#1, docs/07).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  configureTransformersOfflineEnv,
  SMART_ROUTER_HF_OFFLINE_ENV,
} from '../../.pi/extensions/smart-router/fleet-bootstrap.js';

const transformersModuleMock = vi.hoisted(() => ({
  state: {
    allowRemoteModels: true as boolean | undefined,
    cacheDir: '/tmp/cache' as string | undefined,
    localModelPath: '/tmp/models' as string | undefined,
  },
}));

vi.mock('@huggingface/transformers', () => ({
  get env() {
    return transformersModuleMock.state;
  },
}));

describe('configureTransformersOfflineEnv', () => {
  beforeEach(() => {
    transformersModuleMock.state.allowRemoteModels = true;
    transformersModuleMock.state.cacheDir = '/tmp/cache';
    transformersModuleMock.state.localModelPath = '/tmp/models';
    delete process.env[SMART_ROUTER_HF_OFFLINE_ENV];
  });

  afterEach(() => {
    delete process.env[SMART_ROUTER_HF_OFFLINE_ENV];
  });

  it('returns false and does not touch the transformers env when the env var is unset', async () => {
    const applied = await configureTransformersOfflineEnv('.pi-smart-router/models/');

    expect(applied).toBe(false);
    expect(transformersModuleMock.state.allowRemoteModels).toBe(true);
    expect(transformersModuleMock.state.cacheDir).toBe('/tmp/cache');
  });

  it('disables remote fetches and pins cache paths when SMART_ROUTER_HF_OFFLINE=1', async () => {
    process.env[SMART_ROUTER_HF_OFFLINE_ENV] = '1';

    const applied = await configureTransformersOfflineEnv('.pi-smart-router/models/');

    expect(applied).toBe(true);
    expect(transformersModuleMock.state.allowRemoteModels).toBe(false);
    expect(transformersModuleMock.state.cacheDir).toBe('.pi-smart-router/models/');
    expect(transformersModuleMock.state.localModelPath).toBe('.pi-smart-router/models/');
  });

  it('ignores other env values (only the literal "1" opts in)', async () => {
    process.env[SMART_ROUTER_HF_OFFLINE_ENV] = 'true';

    const applied = await configureTransformersOfflineEnv('.pi-smart-router/models/');

    expect(applied).toBe(false);
    expect(transformersModuleMock.state.allowRemoteModels).toBe(true);
  });
});