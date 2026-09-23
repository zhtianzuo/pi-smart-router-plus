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
3. Verification Policy
4. Optional Reviewer
```

Priority:

```Plain Text
P0 upstream compatibility
P1 Risk Guard
P1 Planner Read-only Guard
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

## Configuration

Keep configuration minimal\.

Preferred shape:

```JSON
{
  "plus": {
    "riskGuard": true,
    "plannerReadOnly": true,
    "verification": false,
    "reviewer": false
  }
}
```

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
├── verification-policy.ts
├── reviewer.ts
├── task-state.ts
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

---

## Performance Constraints

Risk classification must not add an LLM call\.

Planner read\-only enforcement must not add an LLM call\.

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
no duplicate model registry exists
no duplicate Thinking system exists
Planner write tools are actually blocked
Executor tools are restored correctly
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

## Context and Command Output Discipline

Search before reading\. Read before guessing\.

File discovery:

```Plain Text
prefer rg --files for listing
prefer rg -n for locating symbols, lines, and matches
never walk the repository aimlessly
```

Reading scope:

```Plain Text
only files directly relevant to the current task
no bulk reading of docs, logs, configs, or source by default
when in doubt, narrow the scope, do not widen it
```

Reading technique:

```Plain Text
1. locate first with rg -n
2. read only the lines around the match
3. widen the window only when the context is insufficient
```

Command output limits:

```Plain Text
default cap = 100 lines
logs = last 100 lines by default
large output must be filtered, counted, or summarized first
never dump full output blindly
```

Tests:

```Plain Text
default = minimum relevant tests
full suite only when truly required
```

Truncation honesty:

```Plain Text
if output is truncated, state it explicitly
never present truncated output as the complete result
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

