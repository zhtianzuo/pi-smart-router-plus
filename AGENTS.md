# AGENTS

## Project

This repository is a fork of:

```Plain Text
https://github.com/beettlle/pi-smart-router.git
```

Project name:

```Plain Text
Pi Smart Router Plus
```

Purpose:

```Plain Text
Extend pi-smart-router with a thin safety and quality layer while preserving
upstream routing, model discovery, thinking control, planning delegation,
fallback, local-model support, and cost optimization.
```

The project must remain easy to sync with upstream\.

---

## Core Rule

Use upstream functionality first\.

Do not rebuild functionality already provided by:

```Plain Text
Pi Coding Agent
pi-smart-router
```

Prefer:

```Plain Text
small additive patches
```

over:

```Plain Text
rewriting router internals
duplicating registries
creating parallel orchestration systems
```

---

## Required Reading Before Editing

Before making changes, inspect:

```Plain Text
AGENTS.md
README.md
package.json
tsconfig.json
vitest.config.ts
src/
tests/
.pi/extensions/smart-router/
```

Also identify:

```Plain Text
router entry point
planning delegate implementation
model selection flow
thinking-level handling
active tool handling
configuration schema
command registration
test structure
```

Do not modify files before understanding the existing implementation\.

---

## Upstream Relationship

Upstream remote:

```Plain Text
https://github.com/beettlle/pi-smart-router.git
```

Expected Git remotes:

```Plain Text
origin
→ this fork

upstream
→ https://github.com/beettlle/pi-smart-router.git
```

Do not remove upstream attribution\.

Do not remove the upstream MIT license or copyright notices\.

---

## Project Scope

Smart Router Plus adds only:

```Plain Text
1. Risk Guard
2. Planner Read-only Guard
3. Depletion Guard (balance/quota-aware routing)
4. Verification Policy
5. Optional Reviewer
```

Priority:

```Plain Text
P0 upstream compatibility
P1 Risk Guard
P1 Planner Read-only Guard
P1 Depletion Guard
P2 Balance Probe (opt-in)
P2 Verification
P3 Reviewer
```

---

## Do Not Reimplement

Do not create a second implementation of:

```Plain Text
Pi Model Registry
cloud-provider authentication
API-key storage
Ollama discovery
LM Studio discovery
model ranking
context-window routing
thinking-level mapping
planning delegation
session pinning
prompt-cache logic
tool-failure escalation
fallback routing
cost database
balance / credit / quota accounting
provider balance API clients that already exist in Pi
```

Use upstream APIs and state\.

---

## Architecture

Target flow:

```Plain Text
User Prompt
    ↓
Risk Guard
    ↓
Upstream Smart Router
    ↓
Local / Economical / Frontier routing
    ↓
Planning Delegate when required
    ↓
Planner Read-only Guard
    ↓
Executor
    ↓
Verification
    ↓
PASS / FAIL
```

Optional future flow:

```Plain Text
FAIL
 ↓
Reviewer
 ↓
Fix / Replan
 ↓
Executor
 ↓
Verification
```

---

## Risk Guard

Risk classification is independent from task complexity\.

Supported levels:

```Plain Text
low
medium
high
```

High\-risk categories must include at least:

```Plain Text
production
deployment
authentication
authorization
permissions
credentials
secrets
API keys
tokens
database migrations
database deletion
user data
destructive filesystem operations
git reset --hard
git clean
force push
history rewrite
firewall
network security
session concurrency
process management
irreversible migrations
```

Risk Guard v1 must be deterministic and local\.

Do not call an LLM only to classify risk\.

Suggested interface:

```TypeScript
interface RiskDecision {
  level: "low" | "medium" | "high";
  reasons: string[];
}
```

Behavior:

```Plain Text
low
→ preserve upstream decision

medium
→ increase planning preference if appropriate

high
→ require planning
```

Do not automatically force the most expensive executor just because risk is high\.

Prefer strong planning plus the cheapest capable executor\.

---

## Planner Read\-only Guard

Planner must be read\-only at the tool layer\.

Do not rely only on prompting the model not to write\.

Planner may use:

```Plain Text
read
search
grep
find
git status
git diff
logs
test output
directory inspection
```

Planner must not use:

```Plain Text
write
edit
delete
git commit
git push
publish
deploy
database write
destructive shell commands
```

Use existing Pi active\-tool APIs when available\.

Required pattern:

```TypeScript
const previousTools = getActiveTools();

try {
  setActiveTools(readOnlyTools);
  await runExistingPlanningDelegate();
} finally {
  setActiveTools(previousTools);
}
```

Use actual Pi API names from the installed version\.

Do not invent APIs\.

---

## Shell Restrictions

Do not give Planner unrestricted shell access\.

A generic shell can run both:

```Plain Text
git status
```

and:

```Plain Text
rm -rf
```

Prefer dedicated read\-only tools\.

If shell access is unavoidable, use an explicit allowlist\.

---

## Single Writer Rule

For one task:

```Plain Text
Planner  = read only
Reviewer = read only
Executor = read + write
```

There must never be multiple concurrent writers modifying the same working tree\.

---

## Verification

Verification is Phase 2 functionality\.

Reuse project\-native commands\.

Examples:

```Plain Text
test
lint
typecheck
build
```

Do not invent a new build system\.

Do not automatically run destructive deployment or migration commands\.

Suggested interface:

```TypeScript
interface VerificationResult {
  status: "pass" | "fail" | "skipped";
  commands: string[];
  failures: string[];
}
```

Examples:

```Plain Text
README-only change
→ skipped

code change
→ relevant tests

TypeScript change
→ tests + typecheck where available

complex build change
→ tests + typecheck + build where appropriate
```

If verification fails, prefer upstream Smart Router escalation before adding a new Reviewer call\.

---

## Reviewer

Reviewer is not MVP functionality\.

Only implement it after real usage demonstrates a need\.

Reviewer must remain read\-only\.

Suggested interface:

```TypeScript
interface ReviewResult {
  decision: "approve" | "fix" | "replan";
  issues: string[];
  requiredFixes: string[];
}
```

Reviewer input should be limited to:

```Plain Text
original task
planning result
git diff
verification result
relevant errors
```

Do not resend the whole repository by default\.

Automatic loop limits:

```Plain Text
max review = 1
max repair = 1
max replan = 1
```

Never create an unbounded repair loop\.

---

## Thinking

Use Pi / pi\-smart\-router's native Thinking system\.

Do not create a second reasoning\-level abstraction\.

Do not manually build provider\-specific reasoning payloads if Pi already handles them\.

Use upstream Thinking behavior unless Risk Guard requires stronger planning\.

---

## Model Handling

Do not create a second model registry\.

Do not copy API keys\.

Do not manage OAuth tokens\.

Do not maintain a separate pricing database unless upstream no longer provides required information\.

Use Pi and Smart Router model data\.

---

## Balance / Depletion Guard

Goal: when an account has zero or near-zero balance/quota, prefer other models instead of paying for one failed call every time.

Reuse upstream first:

```Plain Text
ModelProfile.healthy === false
```

Upstream already honors this flag across context-fit, expected-cost, sub-route selection, session pinning (force rejection), loop escalation and safe-default fallback. Mark the affected models unhealthy; do not add a second scoring engine, router, or model registry.

Two layers, both optional to disable:

```Plain Text
P1 Depletion Guard   error-driven, purely local, zero network, default ON
P2 Balance Probe     active provider probe, network, default OFF (opt-in)
```

Classification rules (deterministic, local):

```Plain Text
billing_depleted       402 / insufficient balance|quota / no credits / 余额不足 / 欠费   TTL 6h
quota_window_exhausted subscription usage limit / resource_exhausted / 配额已用尽        TTL 30min
```

Must NOT be classified as depletion:

```Plain Text
plain 429 rate limit (upstream circuit breaker owns it)
401 / 403 authentication failures
5xx infrastructure errors
```

Account isolation:

```Plain Text
state key = provider + credential fingerprint
fingerprint = truncated SHA-256 of the credential (fp_<12 hex>)
```

Never persist or log the credential itself; redact credential-looking text from any stored detail. A changed credential yields a different fingerprint, so a depleted account stops matching automatically. One account must never disable another account of the same provider.

Fail-open is mandatory:

```Plain Text
if excluding would leave no routable model -> use the full fleet and warn
corrupt / unreadable / unwritable state     -> keep going, in-memory only
probe error / timeout / unknown schema      -> change NO state
```

Balance Probe rules:

```Plain Text
P2 is off unless explicitly enabled
only officially documented endpoints
credentials only via pi's modelRegistry.getApiKeyForProvider()
never add or require a management key / separate credential config
fire-and-forget refresh, gated by TTL and an in-flight guard
must never block TTFT; bounded per-request timeout
only a successfully parsed response may change state
account-wide exhaustion is P1's job, not the probe's
```

State lives in a Plus-owned sidecar (` .pi-smart-router/plus-balance.json `, atomic write, TTL-pruned). Do not extend upstream SQLite schema or StorePort for this.

---

## Configuration

Keep configuration minimal\.

Preferred shape:

```JSON
{
  "plus": {
    "riskGuard": true,
    "plannerReadOnly": true,
    "verification": false,
    "reviewer": false,
    "balanceGuard": true,
    "balanceProbe": false,
    "minBalance": 0,
    "balanceProbeTtlSeconds": 600
  }
}
```

`balanceGuard` is local and free, so it defaults ON. `balanceProbe` performs network calls, so it defaults OFF and must be explicitly enabled. Do not add further balance/quota fields without implemented behavior behind them.

Do not add configuration fields unless they are required by implemented behavior\.

---

## Commands

Prefer extending existing:

```Plain Text
/smart-router
```

Possible additions:

```Plain Text
/smart-router plus-status
/smart-router risk
/smart-router balance
/smart-router balance --refresh
/smart-router verify
```

Avoid introducing a second large command namespace unless necessary\.

---

## Logging

Allowed:

```Plain Text
task id
selected model
thinking level
route stage
risk level
balance status / depletion reason
credential fingerprint (fp_<12 hex>, non-sensitive)
verification status
review status
```

Never log:

```Plain Text
API keys
OAuth tokens
Authorization headers
cookies
passwords
private keys
secret values
.env contents
```

---

## Source Layout

Prefer placing additive code under:

```Plain Text
src/plus/
```

Suggested files:

```Plain Text
src/plus/
├── risk-guard.ts
├── planner-readonly.ts
├── depletion-guard.ts
├── balance-types.ts
├── balance-state.ts
├── balance-adapters.ts
├── balance-probe.ts
├── verification-policy.ts
├── reviewer.ts
├── task-state.ts
├── config.ts
├── runtime.ts
├── index.ts
└── types.ts
```

Use upstream structure instead if there is a clearly better integration point\.

Do not restructure the repository only to match this suggested layout\.

---

## Development Setup

Clone upstream or your fork\.

Upstream source:

```Bash
git clone https://github.com/beettlle/pi-smart-router.git
cd pi-smart-router
npm install
```

For a maintained fork, configure:

```Plain Text
origin
→ your fork

upstream
→ https://github.com/beettlle/pi-smart-router.git
```

Example:

```Bash
git remote rename origin upstream
git remote add origin https://github.com/<account>/pi-smart-router-plus.git
```

---

## Local Pi Installation

Do not modify an installed npm package in place\.

Remove the npm version first:

```Bash
pi remove npm:pi-smart-router
```

Install the local source path:

```Bash
pi install /absolute/path/pi-smart-router-plus
```

Run:

```Bash
npm install
```

before installing the path package\.

Do not load both the npm version and local path version simultaneously\.

Verify:

```Bash
pi list
pi --list-models | grep smart-router
```

---

## Baseline Before Changes

Before implementing Plus features:

```Bash
npm install
npm test
```

Run any existing repository scripts for:

```Plain Text
typecheck
lint
build
```

Then confirm upstream behavior inside Pi:

```Plain Text
/model smart-router/auto
/smart-router status
/smart-router history
/smart-router stats
```

Do not start feature development until upstream source works locally\.

---

## Testing Requirements

Every change must preserve upstream behavior when Plus functionality is disabled\.

Required Risk Guard tests:

```Plain Text
README change
→ low

authentication middleware change
→ high

force push production
→ high
```

Required Planner Guard tests:

```Plain Text
read
→ allowed

search
→ allowed

git status
→ allowed

write
→ blocked

edit
→ blocked

delete
→ blocked

git commit
→ blocked
```

Tool permissions must restore after:

```Plain Text
successful planning
planning failure
thrown exception
```

Use `try/finally`\.

Required balance tests:

```Plain Text
402 / insufficient balance      → depleted (billing, long TTL)
usage limit / resource_exhausted → depleted (quota window, short TTL)
plain 429 rate limit             → NOT depleted
401 / 403 / 5xx                  → NOT depleted
second account, same provider    → NOT affected (fingerprint isolation)
credential rotated               → old depletion no longer matches
all accounts depleted            → fail-open, full fleet, request still routed
balanceGuard = false             → routing identical to upstream
probe disabled                   → zero network calls
probe error / timeout / unknown  → no state change
probe stalled                    → routed request still completes
```

Required Balance Probe adapter tests:

```Plain Text
normal key      → parsed from the documented field
unlimited key   → limit/remaining null → unknown, fail-open
exhausted key   → depleted
abnormal body   → fail-open, no state change
```

No test may assert on, print or persist a real credential; use synthetic values and assert only the fingerprint.

---

## Performance Constraints

Risk classification must not add an LLM call\.

Planner read\-only enforcement must not add an LLM call\.

Depletion Guard must not add an LLM call and must not perform network I/O\.

Balance Probe must never block the routed request (fire-and-forget plus TTL), must be opt-in, and must fail open on any error\.

Simple tasks must not gain extra cloud\-model calls because of Plus\.

Verification should run only necessary local commands\.

Reviewer remains disabled by default\.

---

## Upstream Sync

Keep fork divergence small\.

Sync using one consistent workflow\.

Example:

```Bash
git fetch upstream
git checkout main
git merge upstream/main
```

or a consistently used rebase workflow\.

After upstream sync, test:

```Plain Text
Pi startup
local route
cloud route
planning delegate
thinking
fallback
failure escalation
Risk Guard
Planner Read-only Guard
```

When resolving conflicts, prefer new upstream routing logic and reapply Plus as a thin policy layer\.

---

## License

This project is based on `beettlle/pi-smart-router`\.

Preserve:

```Plain Text
MIT License
original copyright notices
upstream attribution
```

Do not remove upstream license information\.

---

## Change Discipline

Before editing:

```Plain Text
1. Identify existing implementation.
2. Decide whether upstream already solves the problem.
3. Prefer a one-file or small additive change.
4. Add or update tests.
5. Preserve upstream behavior.
```

Do not perform speculative refactors\.

Do not rename unrelated symbols\.

Do not change formatting across unrelated files\.

Do not add dependencies unless clearly necessary\.

---

## MVP Definition

MVP includes only:

```Plain Text
Risk Guard
Planner Read-only Guard
basic status visibility
tests
packaging compatibility
```

MVP does not include:

```Plain Text
Reviewer
new model router
new model registry
new thinking engine
complex verification orchestration
```

---

## Definition of Done

A change is complete only when:

```Plain Text
upstream tests still pass
new tests pass
Plus can be disabled cleanly
no credentials are persisted
no credential fingerprint is reversible to the credential
no duplicate model registry exists
no duplicate Thinking system exists
no duplicate balance/quota accounting exists
Planner write tools are actually blocked
Executor tools are restored correctly
depleted accounts are avoided on the next request
depletion state is isolated per provider + credential
balance policy fails open instead of emptying the fleet
balance probe never blocks routing and never requires a management key
simple tasks receive no extra cloud calls
local path installation works
upstream remains mergeable
```

---

## Output Style

The output shown to the user must contain only the final result, not the
intermediate work\.

Allowed in the output:

```Plain Text
final result
diff summary
necessary command output
verification evidence
test results
```

Not allowed in the output:

```Plain Text
thinking stream
step-by-step reasoning
"let me first check X" reports
redundant progress narration
repeated tool calls
exploration of multiple alternatives before committing
```

Blocking questions, missing requirements, and ambiguous choices must be
front\-loaded\. Place every blocking question, the necessary context, and
the available options together at the start of the response in one batch\.
Do not split questions across multiple turns\.

When there is no blocking question, return the final result directly\.
Do not narrate the path taken\.

---

## 上下文与命令输出纪律

```Plain Text
查找文件优先使用 rg --files、rg -n，禁止无目的遍历整个仓库。
只读取与当前任务直接相关的文件；禁止默认读取全部文档、日志、配置或源码。
读取文件先定位再截取：优先 rg -n，随后仅读取命中位置附近必要行。
命令输出默认限制为 100 行；日志默认只读取末尾 100 行。
大型输出必须先过滤、计数或汇总，禁止直接完整打印。
测试默认运行最小相关测试；需要全量测试时再执行。
输出被截断时必须明确说明，不得将截断结果当作完整结果。
```

---

## AI Agent Working Rule

When assigned a feature:

```Plain Text
Inspect first.
Patch the smallest integration point.
Test the behavior.
Do not redesign upstream architecture unless strictly required.
```

If the requested behavior already exists upstream, use or extend it instead of creating a parallel implementation\.

