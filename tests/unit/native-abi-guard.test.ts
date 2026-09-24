/**
 * Native ABI guard tests.
 *
 * The guard exists because `npm rebuild better-sqlite3` (or a plain
 * `npm install`) run with another Node on PATH replaces the native binary for
 * that Node's ABI: pi then falls back to the memory store while the suite fails
 * with cryptic NODE_MODULE_VERSION errors.
 *
 * The mismatch case needs a second Node on the machine and is skipped when none
 * is available (CI images usually have exactly one).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../scripts/native-abi-guard.mjs', import.meta.url));
const PROJECT_ROOT = join(SCRIPT, '..', '..');

const ALTERNATE_NODE_CANDIDATES = ['/usr/local/bin/node', '/opt/homebrew/opt/node/bin/node'];

function abiOf(nodeBin: string): string {
  const result = spawnSync(nodeBin, ['-p', 'process.versions.modules'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function runGuard(
  options: { node?: string | undefined; piNode?: string | undefined; pathNode?: string; args?: string[] } = {},
) {
  const node = options.node ?? process.execPath;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${dirname(options.pathNode ?? node)}:${process.env.PATH ?? ''}`,
  };
  if (options.piNode !== undefined) {
    env.SMART_ROUTER_PI_NODE = options.piNode;
  } else {
    delete env.SMART_ROUTER_PI_NODE;
  }
  return spawnSync(node, [SCRIPT, ...(options.args ?? [])], { cwd: PROJECT_ROOT, encoding: 'utf8', env });
}

const alternateNode = ALTERNATE_NODE_CANDIDATES.filter(
  (candidate) => existsSync(candidate) && abiOf(candidate) !== '' && abiOf(candidate) !== abiOf(process.execPath),
)[0];

describe('native ABI guard', () => {
  it('passes when pi and PATH use the same Node as the caller', () => {
    const result = runGuard({ piNode: process.execPath });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OK: pi's Node");
    expect(result.stdout).toContain('loads better-sqlite3');
  });

  it('skips the pi check (fail-open) when pi Node cannot be resolved', () => {
    const result = runGuard({ piNode: '/nonexistent/pi-node' });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('pi Node not resolved');
    expect(result.stdout).toContain('OK: this Node');
  });

  it.skipIf(alternateNode === undefined)(
    'fails fast when a Node in use cannot load the native module',
    () => {
      const result = runGuard({
        node: alternateNode,
        piNode: process.execPath,
        pathNode: alternateNode,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Native module ABI mismatch');
      expect(result.stderr).toContain('npm run native:rebuild');
      expect(result.stdout).toContain("OK: pi's Node");
    },
  );

  it('reports the candidate Nodes with --print-node', () => {
    const result = runGuard({ piNode: process.execPath, args: ['--print-node'] });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/the first node on PATH: .+ \(ABI \d+\)/);
  });
});
