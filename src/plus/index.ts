/**
 * Pi Smart Router Plus — public Plus layer facade.
 *
 * The extension imports from `src/index.js` only (deep src imports are
 * forbidden), so every Plus symbol the extension needs is re-exported here.
 */

// Types and defaults
export {
  DEFAULT_PLUS_CONFIG,
  PLUS_VERSION,
  type PlusConfig,
  type PlusTaskSnapshot,
  type ReviewResult,
  type RiskDecision,
  type RiskInput,
  type RiskLevel,
  type RiskRoutingPolicy,
  type VerificationResult,
} from './types.js';

// Risk Guard
export {
  MAX_RISK_REASONS,
  applyRiskGuardToRequest,
  classifyRisk,
  extractToolCallSurface,
  resolveRiskRoutingPolicy,
  riskInputFromToolCall,
  type RiskGuardApplication,
} from './risk-guard.js';

// Balance / depletion types
export type {
  BalanceEntry,
  BalanceObservation,
  BalanceProbeAdapter,
  BalanceProbeOutcome,
  BalanceReasonCode,
  BalanceSource,
  BalanceStatus,
  DepletionClassification,
  PlusCredentialPort,
} from './balance-types.js';

// Depletion Guard (P1) — deterministic, local
export {
  applyFleetBalancePolicy,
  classifyDepletionError,
  resolveBlockedProviders,
  sanitizeDetail,
  type BlockedProvider,
  type FleetBalancePolicyResult,
  type ProviderErrorLike,
} from './depletion-guard.js';

// Balance state sidecar
export {
  BALANCE_STATE_VERSION,
  BILLING_DEPLETED_TTL_MS,
  BalanceStateStore,
  PROBE_STATUS_TTL_MS,
  QUOTA_WINDOW_TTL_MS,
  UNKNOWN_FINGERPRINT,
  balanceStateKey,
  fingerprintCredential,
} from './balance-state.js';

// Balance probe (P2) — opt-in, documented endpoints only
export {
  BALANCE_PROBE_ADAPTERS,
  BALANCE_PROBE_TIMEOUT_MS,
  findBalanceAdapter,
  probeProviderBalance,
} from './balance-adapters.js';
export {
  BalanceProber,
  type BalanceProbeRunResult,
  type BalanceProberOptions,
} from './balance-probe.js';

// Planner Read-only Guard
export {
  PlannerReadonlyGuard,
  READ_ONLY_TOOL_NAMES,
  classifyPlannerToolCall,
  isReadOnlyShellCommand,
  type PlannerToolEvaluation,
  type PlannerToolGate,
} from './planner-readonly.js';

// Config
export {
  DEFAULT_PLUS_CONFIG_PATH,
  PLUS_CONFIG_ENV_PATH,
  resolvePlusConfig,
  type ResolvePlusConfigOptions,
} from './config.js';

// Task state + status formatting
export {
  PlusTaskState,
  formatBalanceReport,
  formatPlusStatus,
  formatRiskReport,
  type FormatBalanceReportOptions,
  type RecordDecisionInput,
  type RecordRiskOptions,
} from './task-state.js';

// Runtime composition
export {
  PLUS_BALANCE_STATE_PATH,
  PlusRuntime,
  createPlusRuntime,
  type PlusRiskApplication,
  type PlusRuntimeOptions,
  type ToolCallRiskRecord,
} from './runtime.js';
