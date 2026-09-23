/**
 * Plus per-session task state and status formatting.
 *
 * Only non-sensitive fields are tracked (task/session id, risk level and
 * reasons, route stage, selected model, planning/verification/review status).
 * Never stores prompts, API keys, tokens or credentials.
 */

import {
  PLUS_VERSION,
  type PlusConfig,
  type PlusTaskSnapshot,
  type RiskDecision,
} from './types.js';

const DEFAULT_TASK_KEY = 'default';

const EMPTY_RISK: RiskDecision = { level: 'low', reasons: [] };

interface MutableSnapshot {
  taskId: string;
  sessionId: string | null;
  risk: RiskDecision;
  turnType: string | null;
  routeStage: string | null;
  reasonCode: string | null;
  selectedModelId: string | null;
  planningForced: boolean;
  planningReadOnlyApplied: boolean;
  updatedAt: string;
}

export interface RecordRiskOptions {
  readonly sessionId?: string | undefined;
  readonly turnType?: string | undefined;
  readonly planningForced?: boolean | undefined;
}

export interface RecordDecisionInput {
  readonly stage: string;
  readonly reasonCode: string;
  readonly selectedModelId: string;
}

function resolveKey(key: string | undefined | null): string {
  return key && key.length > 0 ? key : DEFAULT_TASK_KEY;
}

/** In-memory, per-session Plus task snapshots. No persistence, no secrets. */
export class PlusTaskState {
  private readonly snapshots = new Map<string, MutableSnapshot>();

  get(key: string | undefined | null): PlusTaskSnapshot | undefined {
    const snapshot = this.snapshots.get(resolveKey(key));
    return snapshot ? { ...snapshot } : undefined;
  }

  get size(): number {
    return this.snapshots.size;
  }

  clear(key?: string | undefined): void {
    if (key === undefined) {
      this.snapshots.clear();
      return;
    }
    this.snapshots.delete(resolveKey(key));
  }

  recordRisk(
    key: string | undefined | null,
    risk: RiskDecision,
    options?: RecordRiskOptions,
  ): PlusTaskSnapshot {
    const resolved = resolveKey(key);
    const current = this.ensure(resolved, options?.sessionId ?? key ?? null);
    current.risk = { level: risk.level, reasons: [...risk.reasons] };
    if (options?.turnType !== undefined) {
      current.turnType = options.turnType;
    }
    if (options?.planningForced !== undefined) {
      current.planningForced = options.planningForced;
    }
    current.updatedAt = new Date().toISOString();
    return { ...current };
  }

  recordDecision(
    key: string | undefined | null,
    decision: RecordDecisionInput,
  ): PlusTaskSnapshot {
    const resolved = resolveKey(key);
    const current = this.ensure(resolved, key ?? null);
    current.routeStage = decision.stage;
    current.reasonCode = decision.reasonCode;
    current.selectedModelId = decision.selectedModelId;
    current.updatedAt = new Date().toISOString();
    return { ...current };
  }

  recordPlanningGuard(key: string | undefined | null, applied: boolean): void {
    const resolved = resolveKey(key);
    const current = this.ensure(resolved, key ?? null);
    current.planningReadOnlyApplied = applied;
    current.updatedAt = new Date().toISOString();
  }

  private ensure(resolvedKey: string, sessionId: string | null): MutableSnapshot {
    const existing = this.snapshots.get(resolvedKey);
    if (existing) {
      return existing;
    }
    const created: MutableSnapshot = {
      taskId: resolvedKey,
      sessionId,
      risk: EMPTY_RISK,
      turnType: null,
      routeStage: null,
      reasonCode: null,
      selectedModelId: null,
      planningForced: false,
      planningReadOnlyApplied: false,
      updatedAt: new Date().toISOString(),
    };
    this.snapshots.set(resolvedKey, created);
    return created;
  }
}

function onOff(value: boolean): string {
  return value ? 'ON' : 'OFF';
}

/**
 * `/smart-router plus-status` output. The first four lines are the documented
 * Plus status block; task detail is appended only when a task has been seen.
 */
export function formatPlusStatus(
  config: PlusConfig,
  snapshot?: PlusTaskSnapshot | undefined,
): string {
  const lines = [
    `Risk Guard: ${onOff(config.riskGuard)}`,
    `Planner Read-only: ${onOff(config.plannerReadOnly)}`,
    `Verification: ${onOff(config.verification)}`,
    `Reviewer: ${onOff(config.reviewer)}`,
    `Plus version: ${PLUS_VERSION}`,
  ];

  if (snapshot) {
    lines.push(`Last task risk: ${snapshot.risk.level.toUpperCase()}`);
    if (snapshot.risk.reasons.length > 0) {
      lines.push(`Reasons: ${snapshot.risk.reasons.join(', ')}`);
    }
    if (snapshot.routeStage) {
      lines.push(`Route stage: ${snapshot.routeStage}`);
    }
    if (snapshot.selectedModelId) {
      lines.push(`Selected model: ${snapshot.selectedModelId}`);
    }
    lines.push(`Planning forced: ${snapshot.planningForced ? 'yes' : 'no'}`);
    lines.push(
      `Planner read-only applied: ${snapshot.planningReadOnlyApplied ? 'yes' : 'no'}`,
    );
  }

  return lines.join('\n');
}

/** `/smart-router risk` output for the last task in this session. */
export function formatRiskReport(snapshot?: PlusTaskSnapshot | undefined): string {
  const risk = snapshot?.risk ?? EMPTY_RISK;
  const reasons =
    risk.reasons.length > 0 ? risk.reasons.map((reason) => `- ${reason}`) : ['- (none)'];
  return [`Risk: ${risk.level.toUpperCase()}`, '', 'Reasons:', ...reasons].join('\n');
}
