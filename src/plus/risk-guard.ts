/**
 * Risk Guard — deterministic, local risk classification (Plus P1).
 *
 * Independent of task complexity: deleting a production table is HIGH even if
 * it is a one-line change. Classification is pure regex work — no LLM call, no
 * network access, no additional API cost.
 *
 * Route effect (thin policy layer over upstream routing):
 *   LOW    → upstream decision preserved
 *   MEDIUM → planning preference raised on planning-eligible turns
 *   HIGH   → planning required on planning-eligible turns
 *
 * Executor turns (`tool_result` / `subagent`) are never rewritten, so a risky
 * task still executes on the cheapest capable model once planning is done.
 */

import type { RoutingRequest } from '../domain/types/index.js';

import type {
  PlusConfig,
  RiskDecision,
  RiskInput,
  RiskLevel,
  RiskRoutingPolicy,
} from './types.js';

interface RiskRule {
  readonly id: string;
  readonly level: 'medium' | 'high';
  readonly reason: string;
  readonly pattern: RegExp;
  readonly scope: 'text' | 'path';
}

/** Bound the surfaced reasons so status output stays readable. */
export const MAX_RISK_REASONS = 8;

// ─── HIGH rules ───────────────────────────────────────────────────────────────

const HIGH_RULES: readonly RiskRule[] = [
  {
    id: 'force_push',
    level: 'high',
    reason: 'force push',
    scope: 'text',
    pattern:
      /\bforce[-\s]?push\b|\bgit\s+push\b[^\n]*?\s(?:--force(?:-with-lease)?|-f)\b/i,
  },
  {
    id: 'git_reset_hard',
    level: 'high',
    reason: 'git reset --hard',
    scope: 'text',
    pattern: /\bgit\s+reset\s+--hard\b/i,
  },
  {
    id: 'git_clean',
    level: 'high',
    reason: 'git clean (destructive)',
    scope: 'text',
    pattern: /\bgit\s+clean\s+-[a-z]*[fdx]/i,
  },
  {
    id: 'git_history_rewrite',
    level: 'high',
    reason: 'git history rewrite',
    scope: 'text',
    pattern:
      /\bgit\s+(?:filter-branch|filter-repo)\b|\bhistory\s+rewrit\w*|\brewrit\w*\s+(?:the\s+)?(?:git\s+)?history\b/i,
  },
  {
    id: 'destructive_filesystem',
    level: 'high',
    reason: 'destructive filesystem operation',
    scope: 'text',
    pattern:
      /\brm\s+(?:-[a-z]*(?:r|f)[a-z]*|--recursive|--force)|\bmkfs\b|\bdd\s+if=|\bshred\b|:\(\)\s*\{/i,
  },
  {
    id: 'database_deletion',
    level: 'high',
    reason: 'database deletion',
    scope: 'text',
    pattern:
      /\b(?:drop|truncate)\s+(?:table|database|schema|collection|index|view)\b|\bdelete\s+from\b|\bdrop\s+column\b|\b(?:delete|drop|truncate|remove|wipe)\b[^\n]{0,40}\b(?:databases?|tables?|collections?|schemas?)\b/i,
  },
  {
    id: 'irreversible_migration',
    level: 'high',
    reason: 'irreversible migration',
    scope: 'text',
    pattern:
      /\b(?:irreversible|destructive|unrecoverable)\b[^\n]{0,40}\bmigrat|\bmigrat\w*\b[^\n]{0,40}\b(?:irreversible|destructive|drop|truncate|delete|data\s+loss)\b/i,
  },
  {
    id: 'production_deploy',
    level: 'high',
    reason: 'production deployment',
    scope: 'text',
    pattern:
      /\b(?:prod|production|live)\b[^\n]{0,60}\b(?:deploy\w*|rollout|promot\w*|release|publish\w*|migrat\w*)|\b(?:deploy\w*|rollout|promot\w*|release|publish\w*)\b[^\n]{0,60}\b(?:prod|production|live\s+(?:env|environment|site|server|system|cluster|branch))\b/i,
  },
  {
    id: 'credential_handling',
    level: 'high',
    reason: 'credential or secret handling',
    scope: 'text',
    pattern:
      /\b(?:api[_\s-]?keys?|secrets?|passwords?|passwd|private[_\s-]?keys?|credentials?|access[_\s-]?tokens?|refresh[_\s-]?tokens?|bearer[_\s-]?tokens?|signing[_\s-]?keys?)\b[^\n]{0,60}\b(?:add|store|storing|hardcod\w*|commit|rotat\w*|log|logging|print|expos\w*|leak\w*|revok\w*|delet\w*|remov\w*|updat\w*|chang\w*|writ\w*|generat\w*|creat\w*|read|access)\b|\b(?:rotat\w*|revok\w*|hardcod\w*|leak\w*|expos\w*|store|storing|commit|log|print|updat\w*|chang\w*|add|writ\w*|generat\w*|creat\w*)\b[^\n]{0,60}\b(?:api[_\s-]?keys?|secrets?|passwords?|private[_\s-]?keys?|credentials?|access[_\s-]?tokens?|refresh[_\s-]?tokens?)\b/i,
  },
  {
    id: 'auth_change',
    level: 'high',
    reason: 'authentication or authorization change',
    scope: 'text',
    pattern:
      /\b(?:authentication|authorization|authn|authz|rbac|acl|oauth|jwt|\bauth\b|permissions?)\b[^\n]{0,50}\b(?:middleware|handler|flow|guard|policy|bypass|disabl\w*|grant\w*|escalat\w*|chang\w*|updat\w*|modif\w*|rewrit\w*|implement\w*|enforc\w*|check\w*|configur\w*)\b|\b(?:middleware|handler|flow|guard|policy|bypass|disabl\w*|grant\w*|escalat\w*|chang\w*|updat\w*|modif\w*|rewrit\w*|implement\w*|enforc\w*)\b[^\n]{0,50}\b(?:authentication|authorization|rbac|acl|oauth|jwt|permissions?|credentials?)\b/i,
  },
  {
    id: 'network_security',
    level: 'high',
    reason: 'firewall or network security',
    scope: 'text',
    pattern:
      /\b(?:iptables|nftables|nft|ufw|firewalld|firewall|security[_\s-]?group|network[_\s-]?security|port[_\s-]?forward\w*|open\s+port)\b/i,
  },
  {
    id: 'process_management',
    level: 'high',
    reason: 'process management or session concurrency',
    scope: 'text',
    pattern:
      /\b(?:kill\s+-9|pkill|killall|systemctl\s+(?:stop|disable|restart|kill|mask)|docker\s+(?:rm|rmi|kill|system\s+prune)|pm2\s+(?:delete|stop|kill)|session[_\s-]?concurrenc\w*|process[_\s-]?management)\b/i,
  },
  {
    id: 'user_data',
    level: 'high',
    reason: 'user data',
    scope: 'text',
    pattern:
      /\b(?:user[_\s-]?data|customer[_\s-]?data|personal[_\s-]?data|production[_\s-]?data|pii)\b/i,
  },
  {
    id: 'secret_file',
    level: 'high',
    reason: 'credential or secret file',
    scope: 'path',
    pattern:
      /\.env(?:\.[a-z0-9_-]+)?\b|\.(?:pem|key|p12|pfx|keystore)\b|\bid_(?:rsa|dsa|ecdsa|ed25519)\b|\bcredentials?\b|\bsecrets?\.(?:json|ya?ml|toml)\b|\bauth\.json\b|\btokens?\.json\b|\.npmrc\b|\.netrc\b/i,
  },
  {
    id: 'auth_path',
    level: 'high',
    reason: 'authentication or authorization path',
    scope: 'path',
    pattern:
      /(?:^|[/\\.])(?:auth|authentication|authorization|authn|authz|permissions?|rbac|acl|credentials?|secrets?)(?:[/\\.]|$)/i,
  },
];

// ─── MEDIUM rules ─────────────────────────────────────────────────────────────

const MEDIUM_RULES: readonly RiskRule[] = [
  {
    id: 'dependency_change',
    level: 'medium',
    reason: 'dependency change',
    scope: 'text',
    pattern:
      /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|ci|remove|uninstall|update|upgrade|dedupe|link|publish)\b|\bpip3?\s+install\b|\bbrew\s+install\b|\bapt(?:-get)?\s+install\b/i,
  },
  {
    id: 'dependency_manifest',
    level: 'medium',
    reason: 'dependency manifest change',
    scope: 'text',
    pattern:
      /\bpackage(?:-lock)?\.json\b|\brequirements\.txt\b|\bpyproject\.toml\b|\bCargo\.toml\b|\bgo\.mod\b|\bcomposer\.json\b/i,
  },
  {
    id: 'build_or_ci_config',
    level: 'medium',
    reason: 'build or CI configuration change',
    scope: 'text',
    pattern:
      /\bdockerfile\b|\bdocker-compose\.ya?ml\b|\bmakefile\b|\btsconfig(?:\.[a-z]+)?\.json\b|\.eslintrc\b|\bvitest\.config\.[a-z]+\b|\bwebpack\.config\b|\brollup\.config\b|\bvite\.config\b|\.github\/workflows\b|\bjenkinsfile\b|\bgitlab-ci\.ya?ml\b/i,
  },
  {
    id: 'git_history_operation',
    level: 'medium',
    reason: 'git history operation',
    scope: 'text',
    pattern:
      /\bgit\s+(?:rebase|cherry-pick|revert|commit\s+--amend|checkout\s+--|stash\s+(?:drop|clear|pop)|branch\s+-[dDmM]|tag\s+-d|rm\b|restore\s+--source)/i,
  },
  {
    id: 'database_migration',
    level: 'medium',
    reason: 'database migration',
    scope: 'text',
    pattern: /\bmigrations?\b|\bmigrate\b/i,
  },
  {
    id: 'schema_change',
    level: 'medium',
    reason: 'schema or database change',
    scope: 'text',
    pattern:
      /\b(?:schema|\bdatabase\b|\bdb\b)\b[^\n]{0,30}\b(?:change|alter|updat\w*|modif\w*|migrat\w*|drop)\b/i,
  },
  {
    id: 'privileged_command',
    level: 'medium',
    reason: 'privileged command',
    scope: 'text',
    pattern: /\bsudo\b|\bdoas\b/i,
  },
  {
    id: 'permission_change',
    level: 'medium',
    reason: 'file permission change',
    scope: 'text',
    pattern: /\b(?:chmod|chown|chgrp|setfacl)\b/i,
  },
  {
    id: 'remote_script_pipe',
    level: 'medium',
    reason: 'remote script execution',
    scope: 'text',
    pattern: /\b(?:curl|wget)\b[^\n]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/i,
  },
  {
    id: 'file_deletion',
    level: 'medium',
    reason: 'file deletion',
    scope: 'text',
    pattern:
      /\b(?:delete|remove|rm)\b[^\n]{0,40}\b(?:files?|director(?:y|ies)|folders?|dir)\b/i,
  },
  {
    id: 'migration_path',
    level: 'medium',
    reason: 'database migration path',
    scope: 'path',
    pattern: /(?:^|[/\\.])(?:migrations?|schema|db|database)(?:[/\\.]|$)/i,
  },
  {
    id: 'ci_workflow_path',
    level: 'medium',
    reason: 'CI workflow path',
    scope: 'path',
    pattern: /\.github\/workflows\//i,
  },
];

const HIGH_TEXT_RULES = HIGH_RULES.filter((rule) => rule.scope === 'text');
const HIGH_PATH_RULES = HIGH_RULES.filter((rule) => rule.scope === 'path');
const MEDIUM_TEXT_RULES = MEDIUM_RULES.filter((rule) => rule.scope === 'text');
const MEDIUM_PATH_RULES = MEDIUM_RULES.filter((rule) => rule.scope === 'path');

const LOW_RISK: RiskDecision = { level: 'low', reasons: [] };

// ─── Classification ───────────────────────────────────────────────────────────

/**
 * Classify risk from a prompt plus any observed tool-call surface.
 * Pure and synchronous: safe to call on every routed turn.
 */
export function classifyRisk(input: RiskInput): RiskDecision {
  const textParts: string[] = [];
  if (input.prompt) {
    textParts.push(input.prompt);
  }
  if (input.commands) {
    textParts.push(...input.commands);
  }
  const text = textParts.join('\n');
  if (!text.trim() && !input.paths?.length && !input.toolName) {
    return LOW_RISK;
  }

  const pathParts = [text];
  if (input.paths) {
    pathParts.push(...input.paths);
  }
  const paths = pathParts.join('\n');

  const reasons: string[] = [];
  const seen = new Set<string>();
  const matched = { high: false, medium: false };

  const record = (rule: RiskRule): void => {
    if (rule.level === 'high') {
      matched.high = true;
    } else {
      matched.medium = true;
    }
    if (!seen.has(rule.reason) && reasons.length < MAX_RISK_REASONS) {
      seen.add(rule.reason);
      reasons.push(rule.reason);
    }
  };

  for (const rule of HIGH_TEXT_RULES) {
    if (rule.pattern.test(text)) {
      record(rule);
    }
  }
  for (const rule of HIGH_PATH_RULES) {
    if (rule.pattern.test(paths)) {
      record(rule);
    }
  }

  if (!matched.high) {
    for (const rule of MEDIUM_TEXT_RULES) {
      if (rule.pattern.test(text)) {
        record(rule);
      }
    }
    for (const rule of MEDIUM_PATH_RULES) {
      if (rule.pattern.test(paths)) {
        record(rule);
      }
    }
  }

  const level: RiskLevel = matched.high ? 'high' : matched.medium ? 'medium' : 'low';
  return { level, reasons };
}

/** Map a risk level onto the routing policy (HIGH ⇒ planning required). */
export function resolveRiskRoutingPolicy(risk: RiskDecision): RiskRoutingPolicy {
  return {
    risk,
    requiresPlanning: risk.level === 'high',
    planningPreferred: risk.level === 'medium',
  };
}

// ─── Tool-call surface extraction ─────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Read the immediately preceding assistant turn's tool-call arguments.
 *
 * `buildRoutingRequest` maps tool calls without their arguments, so risk
 * classification reads the raw pi-ai context instead. Only the most recent
 * tool-calling assistant message is considered, so a stale command from earlier
 * in the session cannot keep the task pinned at HIGH forever.
 */
export function extractToolCallSurface(
  messages: readonly unknown[],
  maxCalls = 8,
): string[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!isRecord(message)) {
      continue;
    }
    const content = message['content'];
    if (!Array.isArray(content)) {
      continue;
    }

    const calls: string[] = [];
    for (const block of content) {
      if (!isRecord(block) || block['type'] !== 'toolCall') {
        continue;
      }
      const args = block['arguments'];
      if (isRecord(args)) {
        const command = args['command'];
        if (typeof command === 'string' && command.trim()) {
          calls.push(command);
        }
        const path = args['path'] ?? args['filePath'];
        if (typeof path === 'string' && path.trim()) {
          calls.push(path);
        }
      }
    }

    if (calls.length > 0) {
      return calls.slice(0, maxCalls);
    }
  }
  return [];
}

/**
 * Build the risk surface for a pending tool call (used by the `tool_call`
 * hook). Only the fields that can carry a command or a path are read.
 */
export function riskInputFromToolCall(toolName: string, input: unknown): RiskInput {
  const commands: string[] = [];
  const paths: string[] = [];

  if (isRecord(input)) {
    const command = input['command'];
    if (typeof command === 'string' && command.trim()) {
      commands.push(command);
    }
    const path = input['path'] ?? input['filePath'];
    if (typeof path === 'string' && path.trim()) {
      paths.push(path);
    }
  }

  return {
    commands,
    paths,
    toolName,
  };
}

// ─── Routing integration ──────────────────────────────────────────────────────

export interface RiskGuardApplication {
  readonly request: RoutingRequest;
  readonly risk: RiskDecision;
  /** True when the Plus layer rewrote `turn_type` to force planning. */
  readonly planningForced: boolean;
}

/**
 * Apply the Risk Guard policy to a routing request.
 *
 * Reuses upstream's own planning lever (`turn_type: 'planning'` → frontier /
 * planning delegate) instead of introducing a second planning system.
 */
export function applyRiskGuardToRequest(
  request: RoutingRequest,
  input: RiskInput,
  config: PlusConfig,
): RiskGuardApplication {
  if (!config.riskGuard) {
    return { request, risk: LOW_RISK, planningForced: false };
  }

  const risk = classifyRisk(input);
  const policy = resolveRiskRoutingPolicy(risk);
  if (!policy.requiresPlanning && !policy.planningPreferred) {
    return { request, risk, planningForced: false };
  }

  const turnType = request.turn_type ?? 'unknown';
  // Never interrupt an in-flight executor loop: tool results and subagent
  // turns stay on the cheap executor. A turn already routed as planning needs
  // no rewrite either.
  if (turnType === 'tool_result' || turnType === 'subagent' || turnType === 'planning') {
    return { request, risk, planningForced: false };
  }

  return {
    request: { ...request, turn_type: 'planning' },
    risk,
    planningForced: true,
  };
}
