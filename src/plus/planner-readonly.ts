/**
 * Planner Read-only Guard — tool-layer write isolation (Plus P1).
 *
 * Single-writer rule for one task:
 *   Planner  = read only
 *   Reviewer = read only
 *   Executor = read + write
 *
 * The planning delegate sub-call is wrapped with the upstream-prescribed
 * snapshot/restore pattern, and every tool call issued while the window is
 * open is checked against a read-only allowlist. Prompting the model "please do
 * not write" is never the enforcement mechanism.
 *
 * Allowed (planner):
 *   read, grep, find, ls, search, glob
 *   bash/powershell limited to a read-only command allowlist
 *
 * Blocked (planner):
 *   write, edit, delete, git commit/push, deploy, publish, DB writes,
 *   destructive shell, chained shell (`;`, `&&`, `|`, redirection, substitution)
 */

/** Minimal slice of pi's tool-permission API used by the guard. */
export interface PlannerToolGate {
  getActiveTools(): string[];
  setActiveTools(toolNames: string[]): void;
}

/** Tools a planner may always call. */
export const READ_ONLY_TOOL_NAMES: readonly string[] = [
  'read',
  'grep',
  'find',
  'ls',
  'search',
  'glob',
];

const READ_ONLY_TOOL_SET = new Set(READ_ONLY_TOOL_NAMES);

/** Shell heads that cannot mutate the working tree by themselves. */
const READ_ONLY_SHELL_HEADS = new Set([
  'ls',
  'pwd',
  'cat',
  'head',
  'tail',
  'wc',
  'file',
  'stat',
  'du',
  'df',
  'tree',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'find',
  'fd',
  'echo',
  'basename',
  'dirname',
  'realpath',
  'sort',
  'uniq',
  'cut',
  'which',
  'type',
  'git',
  'true',
]);

/** `find`/`fd` flags that execute or write. */
const SHELL_EXECUTION_FLAGS = [
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
  '-delete',
  '-fprint',
  '-fprint0',
  '-fls',
  '-fprintf',
];

/** `git` subcommands that only read repository state. */
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'status',
  'diff',
  'log',
  'show',
  'rev-parse',
  'ls-files',
  'ls-tree',
  'describe',
  'shortlog',
  'blame',
  'grep',
  'for-each-ref',
  'cat-file',
  'name-rev',
  'reflog',
  'symbolic-ref',
  'rev-list',
  'merge-base',
  'version',
  'help',
]);

/** `git branch` flags that delete, move or force-write a ref. */
const GIT_BRANCH_WRITE_FLAGS = [
  '-d',
  '-D',
  '-m',
  '-M',
  '--delete',
  '--move',
  '--force',
  '--set-upstream-to',
  '--unset-upstream',
];

/**
 * Characters that enable chaining, redirection, substitution or escaping.
 * Rejecting them keeps a "read-only" command from smuggling a writer.
 */
const SHELL_UNSAFE_PATTERN = /[;&|`<>(){}$\\\n\r!]/;

function firstNonFlag(tokens: readonly string[]): string | undefined {
  return tokens.find((token) => !token.startsWith('-'));
}

function isReadOnlyGitCommand(args: readonly string[]): boolean {
  const subcommand = firstNonFlag(args);
  if (!subcommand) {
    return false;
  }

  if (READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
    return true;
  }

  const rest = args.filter((token) => token !== subcommand);

  if (subcommand === 'branch') {
    return !rest.some((token) => GIT_BRANCH_WRITE_FLAGS.includes(token));
  }
  if (subcommand === 'remote') {
    return (
      rest.length === 0 ||
      rest.includes('-v') ||
      rest.includes('--verbose') ||
      rest[0] === 'show' ||
      rest[0] === 'get-url'
    );
  }
  if (subcommand === 'stash') {
    return rest[0] === 'list' || rest[0] === 'show';
  }
  if (subcommand === 'config') {
    return rest.some((token) =>
      ['--get', '--get-all', '--get-regexp', '--list', '-l', '--show-origin'].includes(token),
    );
  }
  if (subcommand === 'tag') {
    const hasListFlag = rest.some((token) => token === '-l' || token === '--list');
    const hasPositional = rest.some((token) => !token.startsWith('-'));
    return hasListFlag && !hasPositional;
  }
  if (subcommand === 'worktree') {
    return rest[0] === 'list';
  }

  return false;
}

/** True when a shell command is a pure read-only inspection. */
export function isReadOnlyShellCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }
  if (SHELL_UNSAFE_PATTERN.test(trimmed)) {
    return false;
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const head = tokens[0];
  if (!head) {
    return false;
  }
  const args = tokens.slice(1);

  if (head === 'git') {
    return isReadOnlyGitCommand(args);
  }
  if (head === 'find' || head === 'fd') {
    return !args.some((token) => SHELL_EXECUTION_FLAGS.includes(token));
  }
  return READ_ONLY_SHELL_HEADS.has(head);
}

export interface PlannerToolEvaluation {
  readonly blocked: boolean;
  readonly reason: string | null;
}
/** Evaluate a pending tool call against the planner read-only allowlist. */
export function classifyPlannerToolCall(
  toolName: string,
  input: unknown,
): PlannerToolEvaluation {
  if (toolName === 'bash' || toolName === 'powershell') {
    const command =
      typeof input === 'object' && input !== null
        ? (input as Record<string, unknown>)['command']
        : undefined;
    if (typeof command === 'string' && isReadOnlyShellCommand(command)) {
      return { blocked: false, reason: null };
    }
    return {
      blocked: true,
      reason: `planner read-only: shell command is not on the read-only allowlist (${toolName})`,
    };
  }

  if (READ_ONLY_TOOL_SET.has(toolName)) {
    return { blocked: false, reason: null };
  }

  return {
    blocked: true,
    reason: `planner read-only: tool "${toolName}" can modify the working tree`,
  };
}

/**
 * Planner read-only window.
 *
 * `enter()` snapshots the active tools and narrows them to the read-only
 * subset; `exit()` restores the snapshot. `run()` guarantees restore on
 * success, failure and thrown exceptions via `try/finally`.
 *
 * The window is re-entrant: nested entries keep the outermost snapshot, so
 * concurrent planning sub-calls cannot restore a half-applied tool set. It is
 * also session-scoped: only the session that opened the window has its tool
 * calls restricted, so an unrelated session streaming concurrently is never
 * blocked.
 */
export class PlannerReadonlyGuard {
  private gate: PlannerToolGate | undefined;
  private depth = 0;
  private previousTools: string[] | undefined;
  private readonly windowSessions = new Map<string, number>();
  private anonymousWindowDepth = 0;

  constructor(gate?: PlannerToolGate) {
    this.gate = gate;
  }

  /** Bind pi's tool-permission API once the extension has a live `pi` handle. */
  bindGate(gate: PlannerToolGate): void {
    this.gate = gate;
  }

  /** True when any read-only window is open (or the given session's window is). */
  isActive(sessionId?: string | undefined): boolean {
    if (sessionId === undefined) {
      return this.depth > 0;
    }
    return this.anonymousWindowDepth > 0 || this.windowSessions.has(sessionId);
  }

  /** Enter the read-only window. Returns the tools that were active. */
  enter(sessionId?: string | undefined): readonly string[] {
    this.depth += 1;
    if (sessionId === undefined) {
      this.anonymousWindowDepth += 1;
    } else {
      this.windowSessions.set(sessionId, (this.windowSessions.get(sessionId) ?? 0) + 1);
    }

    if (this.depth > 1) {
      return this.previousTools ?? [];
    }

    const gate = this.gate;
    const previous = gate ? gate.getActiveTools() : [];
    this.previousTools = [...previous];
    if (gate) {
      gate.setActiveTools(previous.filter((name) => READ_ONLY_TOOL_SET.has(name)));
    }
    return previous;
  }

  /** Leave the read-only window and restore the previous tool set. */
  exit(sessionId?: string | undefined): void {
    if (this.depth === 0) {
      return;
    }
    this.depth -= 1;

    if (sessionId === undefined) {
      this.anonymousWindowDepth = Math.max(0, this.anonymousWindowDepth - 1);
    } else {
      const next = (this.windowSessions.get(sessionId) ?? 1) - 1;
      if (next <= 0) {
        this.windowSessions.delete(sessionId);
      } else {
        this.windowSessions.set(sessionId, next);
      }
    }

    if (this.depth > 0) {
      return;
    }

    const gate = this.gate;
    const previous = this.previousTools;
    this.previousTools = undefined;
    if (gate && previous) {
      gate.setActiveTools([...previous]);
    }
  }

  /** Run `fn` inside the read-only window; always restores in `finally`. */
  async run<T>(fn: () => Promise<T> | T, sessionId?: string | undefined): Promise<T> {
    this.enter(sessionId);
    try {
      return await fn();
    } finally {
      this.exit(sessionId);
    }
  }

  /**
   * Evaluate a pending tool call. Calls outside the window — or from another
   * session — are allowed: the executor keeps read + write.
   */
  evaluateToolCall(
    toolName: string,
    input: unknown,
    sessionId?: string | undefined,
  ): PlannerToolEvaluation {
    if (!this.isActive(sessionId)) {
      return { blocked: false, reason: null };
    }
    return classifyPlannerToolCall(toolName, input);
  }
}
