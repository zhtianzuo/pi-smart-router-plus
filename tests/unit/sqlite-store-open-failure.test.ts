/**
 * Guards the corrupt-DB recovery path against destructive quarantine when the
 * failure is environmental rather than file damage (SP-009 / FR-025 follow-up).
 *
 * `better-sqlite3` loads its native `.node` binary inside `new Database()`, so
 * an ABI mismatch (Node.js version change) or a missing binding surfaces as an
 * open failure. The upstream recovery path renames the database in that case,
 * which silently quarantines a healthy `state.db`. These tests pin the fix:
 * environment failures keep the file, real corruption still quarantines it.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelProfile } from '../../src/domain/types/entities.js';

const { failure } = vi.hoisted(() => ({ failure: { error: new Error('native module failure') as Error } }));

vi.mock('better-sqlite3', () => ({
  default: class {
    constructor() {
      throw failure.error;
    }
  },
}));

const { createResilientStore } = await import('../../src/infrastructure/persistence/sqlite-store.js');
const { MemoryStore } = await import('../../src/infrastructure/persistence/memory-store.js');

const TEST_MODELS: readonly ModelProfile[] = [
  {
    id: 'claude-sonnet',
    tier: 'frontier-cloud',
    provider: 'anthropic',
    capabilities: { reasoning: 0.9, code_gen: 0.9, tool_use: 0.9 },
    pricing: { fallback_cost_per_1m: 3.0 },
  },
];

function abiMismatchError(): Error {
  return Object.assign(
    new Error(
      'The module was compiled against a different Node.js version using NODE_MODULE_VERSION 147. ' +
        'This version of Node.js requires NODE_MODULE_VERSION 137.',
    ),
    { code: 'ERR_DLOPEN_FAILED' },
  );
}

describe('createResilientStore: environment open failures', () => {
  let tempDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'sp009-open-failure-'));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function seedDatabase(): { dbPath: string; contents: string } {
    const dbPath = join(tempDir, 'state.db');
    const contents = 'existing-routing-state';
    writeFileSync(dbPath, contents);
    return { dbPath, contents };
  }

  function expectDatabaseUntouched(dbPath: string, contents: string): void {
    expect(existsSync(dbPath)).toBe(true);
    expect(readFileSync(dbPath, 'utf8')).toBe(contents);
    expect(readdirSync(tempDir).filter((f) => f.includes('.corrupt.'))).toHaveLength(0);
  }

  it('keeps the database file when the native binding has a NODE_MODULE_VERSION mismatch', () => {
    const { dbPath, contents } = seedDatabase();
    failure.error = abiMismatchError();

    const { store, degraded } = createResilientStore({ dbPath, models: TEST_MODELS });

    expect(degraded).toBe(true);
    expect(store).toBeInstanceOf(MemoryStore);
    expectDatabaseUntouched(dbPath, contents);
  });

  it('keeps the database file when the native binding cannot be located', () => {
    const { dbPath, contents } = seedDatabase();
    failure.error = Object.assign(
      new Error('Could not locate the bindings file. Tried: build/Release/better_sqlite3.node'),
      { code: 'MODULE_NOT_FOUND' },
    );

    const { store, degraded } = createResilientStore({ dbPath, models: TEST_MODELS });

    expect(degraded).toBe(true);
    expect(store).toBeInstanceOf(MemoryStore);
    expectDatabaseUntouched(dbPath, contents);
  });

  it('keeps the database file when another process holds a transient lock', () => {
    const { dbPath, contents } = seedDatabase();
    failure.error = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });

    const { store, degraded } = createResilientStore({ dbPath, models: TEST_MODELS });

    expect(degraded).toBe(true);
    expect(store).toBeInstanceOf(MemoryStore);
    expectDatabaseUntouched(dbPath, contents);
  });

  it('still quarantines the file for genuine corruption, including WAL/SHM companions', () => {
    const { dbPath, contents } = seedDatabase();
    writeFileSync(`${dbPath}-wal`, 'stale-wal');
    writeFileSync(`${dbPath}-shm`, 'stale-shm');
    failure.error = Object.assign(new Error('file is not a database'), { code: 'SQLITE_NOTADB' });

    const { store, degraded } = createResilientStore({ dbPath, models: TEST_MODELS });

    expect(degraded).toBe(true);
    expect(store).toBeInstanceOf(MemoryStore);
    expect(existsSync(dbPath)).toBe(false);
    const files = readdirSync(tempDir);
    expect(files.filter((f) => f.includes('.corrupt.'))).toHaveLength(3);
    expect(files.some((f) => f.startsWith('state.db.corrupt.') && f.endsWith('-wal'))).toBe(true);
    expect(files.some((f) => f.startsWith('state.db.corrupt.') && f.endsWith('-shm'))).toBe(true);
    expect(contents).toBe('existing-routing-state');
  });
});
