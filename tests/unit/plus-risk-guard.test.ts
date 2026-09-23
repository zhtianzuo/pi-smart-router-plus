/**
 * Plus Risk Guard unit tests.
 *
 * Risk classification must be deterministic, local and free of LLM calls, and
 * must preserve upstream routing when disabled.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_PLUS_CONFIG, type RoutingRequest } from '../../src/index.js';
import {
  MAX_RISK_REASONS,
  applyRiskGuardToRequest,
  classifyRisk,
  extractToolCallSurface,
} from '../../src/plus/risk-guard.js';

function request(overrides?: Partial<RoutingRequest>): RoutingRequest {
  return {
    request_id: 'req-1',
    session_id: 'sess-1',
    prompt_text: 'Do the thing',
    turn_type: 'main_loop',
    ...overrides,
  };
}

describe('Plus Risk Guard — classification', () => {
  it('classifies a README-only change as LOW', () => {
    const risk = classifyRisk({ prompt: 'Fix the README typo' });
    expect(risk.level).toBe('low');
    expect(risk.reasons).toEqual([]);
  });

  it('does not flag an ordinary coding task', () => {
    const risk = classifyRisk({
      prompt: 'Refactor the settings panel to use the new form hook and add tests',
    });
    expect(risk.level).toBe('low');
  });

  it('classifies an authentication middleware change as HIGH', () => {
    const risk = classifyRisk({ prompt: '修改 authentication middleware 以强制 MFA' });
    expect(risk.level).toBe('high');
    expect(risk.reasons).toContain('authentication or authorization change');
  });

  it('classifies force push to production as HIGH', () => {
    const risk = classifyRisk({ prompt: 'force push production branch' });
    expect(risk.level).toBe('high');
    expect(risk.reasons).toContain('force push');
  });

  it('classifies destructive git and filesystem commands as HIGH', () => {
    expect(classifyRisk({ prompt: 'git reset --hard HEAD~3' }).level).toBe('high');
    expect(classifyRisk({ prompt: 'git clean -fd' }).level).toBe('high');
    expect(classifyRisk({ prompt: 'rm -rf node_modules' }).level).toBe('high');
    expect(classifyRisk({ prompt: 'git fetch && git push --force origin main' }).level).toBe(
      'high',
    );
  });

  it('classifies database deletion and irreversible migrations as HIGH', () => {
    expect(classifyRisk({ prompt: 'DROP TABLE users;' }).level).toBe('high');
    expect(classifyRisk({ prompt: 'truncate table orders' }).level).toBe('high');
    expect(
      classifyRisk({ prompt: 'run the irreversible migration against production' }).level,
    ).toBe('high');
  });

  it('classifies credential and secret handling as HIGH', () => {
    expect(classifyRisk({ prompt: 'Rotate the production API keys' }).level).toBe('high');
    expect(
      classifyRisk({ prompt: 'commit the .env file with the new secrets' }).level,
    ).toBe('high');
  });

  it('classifies credential and auth file paths as HIGH', () => {
    expect(classifyRisk({ paths: ['/repo/.env.local'] }).level).toBe('high');
    expect(classifyRisk({ paths: ['src/auth/middleware.ts'] }).level).toBe('high');
    expect(classifyRisk({ paths: ['config/credentials.json'] }).level).toBe('high');
  });

  it('classifies firewall, process and user-data changes as HIGH', () => {
    expect(classifyRisk({ prompt: 'update the firewall rules' }).level).toBe('high');
    expect(classifyRisk({ prompt: 'pkill the stuck worker processes' }).level).toBe('high');
    expect(classifyRisk({ prompt: 'migrate user data to the new schema' }).level).toBe(
      'high',
    );
  });

  it('classifies dependency, manifest and build config changes as MEDIUM', () => {
    expect(classifyRisk({ prompt: 'npm install lodash' }).level).toBe('medium');
    expect(classifyRisk({ prompt: 'update package.json dependencies' }).level).toBe(
      'medium',
    );
    expect(classifyRisk({ prompt: 'Change the Dockerfile base image' }).level).toBe(
      'medium',
    );
    expect(classifyRisk({ prompt: 'add a workflow to .github/workflows' }).level).toBe(
      'medium',
    );
  });

  it('records the highest applicable level once', () => {
    const risk = classifyRisk({ prompt: 'Fix the README and npm install the new dep' });
    expect(risk.level).toBe('medium');
  });

  it('deduplicates reasons and caps them', () => {
    const risk = classifyRisk({
      prompt:
        'force push production, drop table users, rm -rf /, git reset --hard, ' +
        'git clean -fd, rotate api keys, update authentication middleware, ' +
        'iptables rules, migrate user data',
    });
    expect(risk.level).toBe('high');
    expect(new Set(risk.reasons).size).toBe(risk.reasons.length);
    expect(risk.reasons.length).toBeLessThanOrEqual(MAX_RISK_REASONS);
  });

  it('returns LOW for empty input', () => {
    expect(classifyRisk({})).toEqual({ level: 'low', reasons: [] });
  });
});

describe('Plus Risk Guard — routing policy', () => {
  it('forces planning for HIGH risk on a main_loop turn', () => {
    const application = applyRiskGuardToRequest(
      request({ prompt_text: 'delete the production database' }),
      { prompt: 'delete the production database' },
      DEFAULT_PLUS_CONFIG,
    );

    expect(application.risk.level).toBe('high');
    expect(application.planningForced).toBe(true);
    expect(application.request.turn_type).toBe('planning');
  });

  it('raises planning preference for MEDIUM risk', () => {
    const application = applyRiskGuardToRequest(
      request({ prompt_text: 'npm install lodash' }),
      { prompt: 'npm install lodash' },
      DEFAULT_PLUS_CONFIG,
    );

    expect(application.risk.level).toBe('medium');
    expect(application.planningForced).toBe(true);
    expect(application.request.turn_type).toBe('planning');
  });

  it('preserves LOW risk upstream decisions (no extra planning)', () => {
    const application = applyRiskGuardToRequest(
      request({ prompt_text: 'Fix the README typo' }),
      { prompt: 'Fix the README typo' },
      DEFAULT_PLUS_CONFIG,
    );

    expect(application.risk.level).toBe('low');
    expect(application.planningForced).toBe(false);
    expect(application.request.turn_type).toBe('main_loop');
  });

  it('never rewrites tool_result executor turns', () => {
    const application = applyRiskGuardToRequest(
      request({ prompt_text: 'force push production', turn_type: 'tool_result' }),
      { prompt: 'force push production' },
      DEFAULT_PLUS_CONFIG,
    );

    expect(application.risk.level).toBe('high');
    expect(application.planningForced).toBe(false);
    expect(application.request.turn_type).toBe('tool_result');
  });

  it('preserves the upstream request exactly when riskGuard is disabled', () => {
    const original = request({ prompt_text: 'delete the production database' });
    const application = applyRiskGuardToRequest(
      original,
      { prompt: 'delete the production database' },
      { ...DEFAULT_PLUS_CONFIG, riskGuard: false },
    );

    expect(application.request).toBe(original);
    expect(application.risk.level).toBe('low');
    expect(application.planningForced).toBe(false);
  });
});

describe('Plus Risk Guard — tool-call surface', () => {
  it('reads commands and paths from the most recent tool-calling turn only', () => {
    const stale = {
      role: 'assistant',
      content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'rm -rf /' } }],
    };
    const current = {
      role: 'assistant',
      content: [
        { type: 'toolCall', name: 'bash', arguments: { command: 'git status' } },
        { type: 'toolCall', name: 'write', arguments: { path: 'src/a.ts' } },
      ],
    };

    expect(extractToolCallSurface([stale, current])).toEqual([
      'git status',
      'src/a.ts',
    ]);
    expect(extractToolCallSurface([])).toEqual([]);
    expect(extractToolCallSurface([{ role: 'user', content: 'hi' }])).toEqual([]);
  });
});
