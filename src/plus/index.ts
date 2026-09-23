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
  formatPlusStatus,
  formatRiskReport,
  type RecordDecisionInput,
  type RecordRiskOptions,
} from './task-state.js';

// Runtime composition
export {
  PlusRuntime,
  createPlusRuntime,
  type PlusRiskApplication,
  type PlusRuntimeOptions,
  type ToolCallRiskRecord,
} from './runtime.js';
