/**
 * Plus runtime — composition of Risk Guard, Planner Read-only Guard and task
 * state into one object the extension can hold on `SmartRouterRuntime`.
 *
 * Additive layer only: it never routes, never selects models, never calls an
 * LLM. Route decisions stay with upstream pi-smart-router.
 */

import type { RoutingDecision, RoutingRequest } from '../domain/types/index.js';

import { resolvePlusConfig } from './config.js';
import {
  applyRiskGuardToRequest,
  classifyRisk,
  extractToolCallSurface,
  riskInputFromToolCall,
} from './risk-guard.js';
import {
  PlannerReadonlyGuard,
  type PlannerToolGate,
} from './planner-readonly.js';
import { PlusTaskState } from './task-state.js';
import type { PlusConfig, RiskDecision } from './types.js';

const LOW_RISK: RiskDecision = { level: 'low', reasons: [] };

export interface PlusRiskApplication {
  readonly request: RoutingRequest;
  readonly risk: RiskDecision;
  readonly planningForced: boolean;
}

export interface ToolCallRiskRecord {
  readonly risk: RiskDecision;
  readonly blocked: boolean;
  readonly reason: string | null;
}

export interface PlusRuntimeOptions {
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly config?: PlusConfig | undefined;
  readonly gate?: PlannerToolGate | undefined;
  readonly plannerGuard?: PlannerReadonlyGuard | undefined;
  readonly taskState?: PlusTaskState | undefined;
}

export class PlusRuntime {
  readonly config: PlusConfig;
  readonly taskState: PlusTaskState;
  readonly plannerGuard: PlannerReadonlyGuard;

  constructor(options?: PlusRuntimeOptions) {
    this.config =
      options?.config ?? resolvePlusConfig({ cwd: options?.cwd, env: options?.env });
    this.taskState = options?.taskState ?? new PlusTaskState();
    this.plannerGuard = options?.plannerGuard ?? new PlannerReadonlyGuard();
    if (options?.gate) {
      this.plannerGuard.bindGate(options.gate);
    }
  }

  /** Classify risk for a routed turn and apply the planning policy. */
  applyRisk(
    request: RoutingRequest,
    messages: readonly unknown[] = [],
  ): PlusRiskApplication {
    const application = applyRiskGuardToRequest(
      request,
      {
        prompt: request.prompt_text,
        commands: extractToolCallSurface(messages),
      },
      this.config,
    );

    this.taskState.recordRisk(request.session_id, application.risk, {
      sessionId: request.session_id,
      turnType: application.request.turn_type ?? request.turn_type ?? 'unknown',
      planningForced: application.planningForced,
    });

    return application;
  }

  /** Record the upstream routing decision for status reporting. */
  recordDecision(
    sessionId: string | undefined,
    decision: Pick<
      RoutingDecision,
      'stage' | 'reason_code' | 'selected_model_id'
    >,
  ): void {
    this.taskState.recordDecision(sessionId, {
      stage: decision.stage,
      reasonCode: decision.reason_code,
      selectedModelId: decision.selected_model_id,
    });
  }

  /** Record whether the read-only planner window was applied for this session. */
  recordPlanningGuard(sessionId: string | undefined, applied: boolean): void {
    this.taskState.recordPlanningGuard(sessionId, applied);
  }

  /**
   * Evaluate a pending tool call for the `tool_call` hook.
   *
   * While the planner read-only window is open, write-capable tools are blocked
   * at the tool layer. Outside the window the call is allowed and only its risk
   * signal is recorded/logged (the executor keeps read + write).
   */
  evaluateToolCall(
    toolName: string,
    input: unknown,
    sessionId?: string | undefined,
  ): ToolCallRiskRecord {
    const planner = this.plannerGuard.evaluateToolCall(toolName, input, sessionId);
    if (planner.blocked) {
      return {
        risk: LOW_RISK,
        blocked: true,
        reason: planner.reason,
      };
    }

    const risk = this.config.riskGuard
      ? classifyRisk(riskInputFromToolCall(toolName, input))
      : LOW_RISK;
    return { risk, blocked: false, reason: null };
  }
}

/** Create the Plus runtime with default (documented) configuration. */
export function createPlusRuntime(options?: PlusRuntimeOptions): PlusRuntime {
  return new PlusRuntime(options);
}
