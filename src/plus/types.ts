/**
 * Pi Smart Router Plus — shared types and defaults.
 *
 * Additive safety/quality layer on top of pi-smart-router. Nothing here
 * replaces upstream routing, model discovery, thinking or planning logic; the
 * Plus layer only classifies risk locally and constrains planner tool access.
 */

/** Plus layer version, independent of the upstream package version. */
export const PLUS_VERSION = '0.1.2' as const;

/** Risk levels are independent of task complexity (a one-line prod delete is HIGH). */
export type RiskLevel = 'low' | 'medium' | 'high';

/** Deterministic, local risk classification result. Never produced by an LLM. */
export interface RiskDecision {
  readonly level: RiskLevel;
  readonly reasons: readonly string[];
}

/**
 * Operator-facing Plus configuration.
 *
 * Defaults follow the project specification: Risk Guard and Planner
 * Read-only Guard ON, Verification and Reviewer OFF.
 */
export interface PlusConfig {
  readonly riskGuard: boolean;
  readonly plannerReadOnly: boolean;
  readonly verification: boolean;
  readonly reviewer: boolean;
  /** P1: error-driven depletion guard. Local, deterministic, zero network. */
  readonly balanceGuard: boolean;
  /** P2: active provider balance probe (network). Off by default. */
  readonly balanceProbe: boolean;
  /** Minimum acceptable balance before an account is treated as low. */
  readonly minBalance: number;
  /** Minimum interval between two P2 probe rounds, in seconds. */
  readonly balanceProbeTtlSeconds: number;
}

export const DEFAULT_PLUS_CONFIG: Readonly<PlusConfig> = {
  riskGuard: true,
  plannerReadOnly: true,
  verification: false,
  reviewer: false,
  balanceGuard: true,
  balanceProbe: false,
  minBalance: 0,
  balanceProbeTtlSeconds: 600,
};

/** Input surface for local risk classification. */
export interface RiskInput {
  readonly prompt?: string | undefined;
  /** Shell commands observed on the pending turn (tool-call arguments). */
  readonly commands?: readonly string[] | undefined;
  /** File paths observed on the pending turn. */
  readonly paths?: readonly string[] | undefined;
  /** Tool name observed on the pending turn, when known. */
  readonly toolName?: string | undefined;
}

/** How a risk level maps onto the upstream routing decision. */
export interface RiskRoutingPolicy {
  readonly risk: RiskDecision;
  /** HIGH risk: planning is required for the task's planning-eligible turn. */
  readonly requiresPlanning: boolean;
  /** MEDIUM risk: planning preference is raised when the turn allows it. */
  readonly planningPreferred: boolean;
}

/** Phase 2 (Verification) result contract — disabled by default. */
export interface VerificationResult {
  readonly status: 'pass' | 'fail' | 'skipped';
  readonly commands: readonly string[];
  readonly failures: readonly string[];
}

/** Phase 3 (Reviewer) result contract — disabled by default. */
export interface ReviewResult {
  readonly decision: 'approve' | 'fix' | 'replan';
  readonly issues: readonly string[];
  readonly requiredFixes: readonly string[];
}

/** Per-session Plus task snapshot surfaced by `/smart-router plus-status|risk`. */
export interface PlusTaskSnapshot {
  readonly taskId: string;
  readonly sessionId: string | null;
  readonly risk: RiskDecision;
  readonly turnType: string | null;
  readonly routeStage: string | null;
  readonly reasonCode: string | null;
  readonly selectedModelId: string | null;
  readonly planningForced: boolean;
  readonly planningReadOnlyApplied: boolean;
  readonly updatedAt: string;
}
