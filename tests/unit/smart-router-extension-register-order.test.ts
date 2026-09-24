/**
 * Pins the gateway-visible contract: `smartRouterExtension` MUST call
 * `pi.registerProvider('smart-router', …)` synchronously, before any awaited
 * setup step. Otherwise the Feishu model picker (which fires RPC
 * `get_available_models` immediately after warmup) snapshots a model registry
 * without `smart-router/auto`, because `createSmartRouterRuntime` is async and
 * the actual provider registration lives behind it.
 *
 * Regression for FEISHU-VS-20260817#1 / docs/07-pi-rpc-stdin-extensions.md.
 */
import { describe, expect, it } from 'vitest';

describe('smartRouterExtension — registerProvider timing', () => {
  it('calls pi.registerProvider synchronously before any awaited setup', { timeout: 30_000 }, async () => {
    const calls: string[] = [];
    const syncFlag = { provider: false };

    const pi = {
      registerProvider(name: string, cfg: unknown) {
        if (name === 'smart-router') {
          syncFlag.provider = true;
        }
        calls.push(`registerProvider:${name}`);
        void cfg;
      },
      registerCommand() {
        calls.push('registerCommand');
      },
      on() {
        return () => {};
      },
      appendEntry() {},
      ui: {
        notify: () => {},
        setStatus: () => {},
        custom: () => {},
        confirm: () => {},
        select: () => {},
        input: () => {},
        editor: () => {},
      },
    };

    // Spy on the synchronous flag from the first call into the module. If
    // pi.registerProvider is called synchronously (before the first
    // `await`), the very first `registerProvider` call must be the smart-router
    // one (i.e. syncFlag.provider must already be true by the time the entry
    // returns control to the test).
    const mod = await import('../../.pi/extensions/smart-router/index.js');
    // Do not await — we want to inspect state immediately after the sync part runs.
    void mod.default(pi as unknown as Parameters<typeof mod.default>[0]);

    expect(syncFlag.provider).toBe(true);
    // And the smart-router registration must be the very first thing recorded.
    expect(calls[0]).toBe('registerProvider:smart-router');
  });
});