#!/usr/bin/env node
/**
 * Native ABI guard for `better-sqlite3`.
 *
 * `better-sqlite3` ships a prebuilt `.node` binary per Node ABI. Running
 * `npm rebuild better-sqlite3` (or `npm install`) with a different Node on PATH
 * silently replaces it: the suite then fails with a wall of cryptic
 * NODE_MODULE_VERSION errors, and pi falls back to the in-memory store.
 *
 * Usage:
 *   node scripts/native-abi-guard.mjs            # check pi's Node and the current Node
 *   node scripts/native-abi-guard.mjs --rebuild  # rebuild with pi's Node
 *
 * Node resolution: $SMART_ROUTER_PI_NODE, else the `pi` launcher on PATH
 * (following shebang / `exec "…"` wrappers). If it cannot be resolved the pi
 * check is skipped (fail-open) — the current-Node check still runs.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NATIVE_MODULE = 'better-sqlite3';
const PROBE = [
  `const Database = require(${JSON.stringify(NATIVE_MODULE)});`,
  "const db = new Database(':memory:');",
  'db.close();',
].join(' ');

const REBUILD_HINT = 'npm run native:rebuild';

function firstLine(file) {
  try {
    return readFileSync(file, 'utf8').split('\n', 1)[0] ?? '';
  } catch {
    return '';
  }
}

function isNodeBinary(path) {
  return existsSync(path) && /^node(\.exe)?$|^node[0-9.]*$/i.test(basename(path));
}

/** Follow `pi` launcher wrappers (bash wrapper → node shebang) to find its Node. */
function resolveNodeFromLauncher(start, depth = 0) {
  if (depth > 4 || !existsSync(start) || !statSync(start).isFile()) {
    return null;
  }
  const line = firstLine(start);
  if (!line.startsWith('#!')) {
    return null;
  }
  const target = line.slice(2).trim().split(/\s+/)[0] ?? '';
  if (target.endsWith('/env')) {
    return whichOnPath('node');
  }
  if (isAbsolute(target) && isNodeBinary(target)) {
    return target;
  }
  // Shell wrapper (e.g. Homebrew) — follow its `exec "<path>"` target.
  const execMatch = /^[^\n]*\bexec\s+"?([^"'\s]+)"?/m.exec(readFileSync(start, 'utf8'));
  if (execMatch?.[1]) {
    const next = resolve(dirname(start), execMatch[1]);
    return isNodeBinary(next) ? next : resolveNodeFromLauncher(next, depth + 1);
  }
  return null;
}

function whichOnPath(name) {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function resolvePiNode() {
  const configured = process.env.SMART_ROUTER_PI_NODE?.trim();
  if (configured) {
    return existsSync(configured) ? configured : null;
  }
  const launcher = whichOnPath('pi');
  return launcher ? resolveNodeFromLauncher(launcher) : null;
}

function nodeAbi(nodeBin) {
  const result = spawnSync(nodeBin, ['-p', 'process.versions.modules'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

// `better-sqlite3` loads its native binary inside `new Database()` (not on
// require), so the probe must construct — and close — a database.
function canLoadNativeModule(nodeBin) {
  const script = `try { ${PROBE} } catch (error) { console.error(error && error.message ? error.message : String(error)); process.exit(3); }`;
  const result = spawnSync(nodeBin, ['-e', script], { cwd: projectRoot, encoding: 'utf8' });
  if (result.status === 0) return { ok: true, detail: '' };
  return { ok: false, detail: (result.stderr || result.stdout || 'unknown error').trim().split('\n')[0] };
}

function rebuildWithPiNode(piNode) {
  const npmCli = process.env.npm_execpath;
  const command = npmCli
    ? { bin: piNode, args: [npmCli, 'rebuild', NATIVE_MODULE] }
    : { bin: whichOnPath('npm'), args: ['rebuild', NATIVE_MODULE] };
  if (!command.bin) {
    console.error(`Cannot locate npm. Run: PATH="${dirname(piNode)}:$PATH" npm run native:rebuild`);
    process.exit(1);
  }
  console.log(`Rebuilding ${NATIVE_MODULE} with pi's Node (${piNode}, ABI ${nodeAbi(piNode)})…`);
  const result = spawnSync(command.bin, command.args, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: { ...process.env, PATH: `${dirname(piNode)}:${process.env.PATH ?? ''}` },
  });
  process.exit(result.status ?? 1);
}

const rebuild = process.argv.includes('--rebuild');
const piNode = resolvePiNode();

if (!piNode) {
  console.warn(
    '[native-abi-guard] pi Node not resolved (set SMART_ROUTER_PI_NODE to enable this check) — skipping the pi runtime check.',
  );
} else if (rebuild) {
  rebuildWithPiNode(piNode);
}

const failures = [];

if (piNode) {
  const piCheck = canLoadNativeModule(piNode);
  if (!piCheck.ok) {
    failures.push(
      `pi's Node (${piNode}, ABI ${nodeAbi(piNode)}) cannot load ${NATIVE_MODULE}: ${piCheck.detail}`,
    );
  } else {
    console.log(`[native-abi-guard] OK: pi Node (${piNode}, ABI ${nodeAbi(piNode)}) loads ${NATIVE_MODULE}.`);
  }
}

if (process.execPath !== piNode) {
  const currentCheck = canLoadNativeModule(process.execPath);
  if (!currentCheck.ok) {
    failures.push(
      `this Node (${process.execPath}, ABI ${nodeAbi(process.execPath)}) cannot load ${NATIVE_MODULE}: ${currentCheck.detail}`,
    );
  } else {
    console.log(`[native-abi-guard] OK: current Node (ABI ${nodeAbi(process.execPath)}) loads ${NATIVE_MODULE}.`);
  }
}

if (failures.length > 0) {
  console.error('[native-abi-guard] Native module ABI mismatch:\n  - ' + failures.join('\n  - '));
  console.error(
    `\nFix: use pi's Node for tests, or run \`${REBUILD_HINT}\` to rebuild ${NATIVE_MODULE} for pi.\n` +
      'Note: the router fails open to the in-memory store in the meantime (routing keeps working, history/stats are not persisted).',
  );
  process.exit(1);
}
