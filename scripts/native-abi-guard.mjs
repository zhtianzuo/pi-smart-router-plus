#!/usr/bin/env node
/**
 * Native ABI guard for `better-sqlite3`.
 *
 * `better-sqlite3` ships a prebuilt `.node` binary per Node ABI and loads it
 * inside `new Database()`. Running `npm rebuild better-sqlite3` (or a plain
 * `npm install`) with a different Node on PATH silently replaces it: the suite
 * then fails with a wall of cryptic NODE_MODULE_VERSION errors, and pi falls
 * back to the in-memory store (routing keeps working, history/stats are lost).
 *
 * Usage:
 *   node scripts/native-abi-guard.mjs            # check every Node that matters
 *   node scripts/native-abi-guard.mjs --rebuild  # rebuild with pi's Node
 *   node scripts/native-abi-guard.mjs --print-node
 *
 * Nodes checked: $SMART_ROUTER_PI_NODE (explicit), the Node behind the `pi`
 * launcher on PATH, the first `node` on PATH, and the calling Node. Unresolvable
 * sources are skipped (fail-open); the remaining checks still run.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NATIVE_MODULE = 'better-sqlite3';
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

function whichOnPath(name) {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
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

function resolvePiNode() {
  const configured = process.env.SMART_ROUTER_PI_NODE?.trim();
  if (configured) {
    return existsSync(configured) ? configured : null;
  }
  const launcher = whichOnPath('pi');
  return launcher ? resolveNodeFromLauncher(launcher) : null;
}

const piNode = resolvePiNode();

/** Every Node binary whose ABI can break this checkout, deduplicated by path. */
function collectCandidates() {
  const candidates = [];
  const seen = new Set();
  const add = (label, bin) => {
    if (!bin || seen.has(bin)) return;
    seen.add(bin);
    candidates.push({ label, bin });
  };

  add("pi's Node", piNode);
  add('the first node on PATH', whichOnPath('node'));
  add('this Node', process.execPath);
  return candidates;
}

function nodeAbi(nodeBin) {
  const result = spawnSync(nodeBin, ['-p', 'process.versions.modules'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

/** `new Database()` is what loads the native binary, so the probe must construct one. */
function canLoadNativeModule(nodeBin) {
  const script = [
    `const Database = require(${JSON.stringify(NATIVE_MODULE)});`,
    "const db = new Database(':memory:');",
    'db.close();',
  ].join(' ');
  const result = spawnSync(nodeBin, ['-e', `try { ${script} } catch (error) { process.exit(3); }`], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  if (result.status === 0) return { ok: true, detail: '' };
  const stderr = (result.stderr || result.stdout || 'unknown error').trim();
  // The ABI complaint is on its own line; the require trace follows it.
  const detail = stderr.split('\n').find((line) => line.trim().length > 0) ?? 'unknown error';
  return { ok: false, detail };
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

const mode = process.argv.slice(2);
const candidates = collectCandidates();

if (mode.includes('--print-node')) {
  for (const { label, bin } of candidates) {
    console.log(`${label}: ${bin} (ABI ${nodeAbi(bin)})`);
  }
  process.exit(0);
}

if (!piNode) {
  console.warn(
    '[native-abi-guard] pi Node not resolved (set SMART_ROUTER_PI_NODE to enable this check) — skipping the pi runtime check.',
  );
}

if (mode.includes('--rebuild')) {
  if (!piNode) {
    console.error(`pi's Node could not be resolved. Set SMART_ROUTER_PI_NODE, then run \`${REBUILD_HINT}\`.`);
    process.exit(1);
  }
  rebuildWithPiNode(piNode);
}

const failures = [];
for (const { label, bin } of candidates) {
  const check = canLoadNativeModule(bin);
  if (check.ok) {
    console.log(`[native-abi-guard] OK: ${label} (${bin}, ABI ${nodeAbi(bin)}) loads ${NATIVE_MODULE}.`);
  } else {
    failures.push(`${label} (${bin}, ABI ${nodeAbi(bin)}) cannot load ${NATIVE_MODULE}: ${check.detail}`);
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
