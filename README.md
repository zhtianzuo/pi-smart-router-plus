# README

# Pi Smart Router Plus

Pi Smart Router Plus 是基于 [`pi-smart-router`](https://github.com/beettlle/pi-smart-router.git) 二次开发的增强版本。

项目目标不是重写 Smart Router，而是在保留其现有模型路由、Thinking 调节、本地模型支持、Planning Delegate、Fallback、成本控制等能力的基础上，增加：

```Plain Text
Risk Guard
Planner Read-only Guard
Verification Policy
Optional Reviewer
```

核心原则：

```Plain Text
Use upstream first.
Patch only what is missing.
Keep the fork thin.
Keep upstream mergeable.
```

即：

> 能复用上游就不重写，只补安全、权限和质量控制层，并始终保持方便同步上游。
> 
> 

---

## 实现状态（v0.1.0 / MVP）

| 能力 | 状态 | 默认 | 说明 |
| --- | --- | --- | --- |
| Risk Guard | ✅ 已实现 | ON | 纯本地确定性规则，零 LLM 调用 |
| Planner Read-only Guard | ✅ 已实现 | ON | 工具层拦截 + `getActiveTools`/`setActiveTools` try/finally 恢复 |
| 状态显示 | ✅ 已实现 | — | `/smart-router plus-status`、`/smart-router risk` |
| Verification Policy | ⏳ Phase 2 | OFF | 接口已定义（`VerificationResult`），尚未接线 |
| Optional Reviewer | ⏳ Phase 3 | OFF | 接口已定义（`ReviewResult`），尚未接线 |

新增代码位于：

```Plain Text
src/plus/risk-guard.ts          # 风险分类 + 路由策略（turn_type 规划升级）
src/plus/planner-readonly.ts    # 工具层只读窗口 + shell 只读白名单
src/plus/task-state.ts          # 单任务状态 + 状态格式化
src/plus/config.ts              # Plus 配置解析
src/plus/runtime.ts             # Plus 组合根
src/plus/types.ts               # 共享类型 + 默认值
```

扩展接线（薄补丁）：

```Plain Text
.pi/extensions/smart-router/route-and-delegate.ts   # 风险策略 + 规划只读窗口
.pi/extensions/smart-router/extension-setup.ts      # Plus runtime + tool_call 钩子
.pi/extensions/smart-router/commands.ts             # /smart-router plus-status | risk
```

配置（`config/plus.json`，或 `SMART_ROUTER_PLUS_CONFIG` 指向的文件；环境变量优先级更高）：

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

环境变量覆盖：

```Plain Text
SMART_ROUTER_PLUS_RISK_GUARD=0|1
SMART_ROUTER_PLUS_PLANNER_READONLY=0|1
SMART_ROUTER_PLUS_VERIFICATION=0|1
SMART_ROUTER_PLUS_REVIEWER=0|1
```

路由影响（复用上游 planning 机制，不新增第二套 Planner）：

```Plain Text
LOW    → 完全不改上游决策
MEDIUM → 在 planning-eligible 轮次提升 planning 倾向
HIGH   → 在 planning-eligible 轮次强制 planning
```

`tool_result` / `subagent` 执行轮永远不会被改写，因此高风险任务仍然是"强模型 Planning + 最便宜可用模型执行"。

成本约束：Risk Guard 与 Planner Read-only Guard 均不产生任何额外模型调用；Reviewer/Verification 默认关闭。

---

## 上游项目

本项目基于：

```Plain Text
https://github.com/beettlle/pi-smart-router.git
```

上游项目：

```Plain Text
beettlle/pi-smart-router
```

许可证：

```Plain Text
MIT
```

本项目必须保留原项目的 MIT License、版权声明和 Attribution。

---

## 为什么做这个 Fork

`pi-smart-router` 已经提供了大部分需要的智能调度能力，包括：

```Plain Text
Pi 已认证模型发现
Ollama / LM Studio 本地模型支持
Local / Economical / Frontier 模型分层
成本感知模型路由
上下文窗口判断
Thinking 自动调节
Planning Delegate
Fallback
Tool Failure Escalation
Session Pin
Prompt Cache 策略
Routing History
Stats
```

因此本项目不会重新实现：

```Plain Text
Model Registry
Provider Authentication
API Key 管理
Ollama Discovery
LM Studio Discovery
Model Ranking
Thinking Engine
Planning Delegate
Fallback Router
Context Router
Prompt Cache
Session Pin
Tool Failure Escalation
```

Pi Smart Router Plus 只增加上游相对欠缺的：

```Plain Text
风险识别
Planner 工具权限限制
执行结果验证
可选 Reviewer
```

---

## 总体架构

```Plain Text
User Prompt
    ↓
Risk Guard
    ↓
pi-smart-router
    ↓
Local / Economical / Frontier Routing
    ↓
Planning Delegate
    ↓
Planner Read-only Guard
    ↓
Executor
    ↓
Verification
    ↓
PASS / FAIL
```

未来可选：

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

# 功能范围

## 4\.1 Risk Guard

Risk Guard 独立于任务复杂度判断。

例如：

```Plain Text
删除 production 数据库表
```

可能只需要一条命令，但仍然属于：

```Plain Text
HIGH RISK
```

风险等级：

```Plain Text
LOW
MEDIUM
HIGH
```

至少识别：

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

Risk Guard v1 必须：

```Plain Text
纯本地
确定性规则
不调用 LLM
不产生额外 API 成本
```

行为：

```Plain Text
LOW
→ 保留 Smart Router 原始决策

MEDIUM
→ 提高 Planning 倾向

HIGH
→ 强制 Planning
```

High Risk 不代表 Executor 必须使用最贵模型。

推荐策略：

```Plain Text
高能力模型负责 Planning
+
最低成本且能力足够的模型负责执行
```

---

## 4\.2 Planner Read\-only Guard

Planning 阶段只允许分析。

Planner 可以：

```Plain Text
read
search
grep
find
git status
git diff
读取日志
读取测试结果
查看目录结构
```

Planner 不允许：

```Plain Text
write
edit
delete
git commit
git push
deploy
publish
database write
destructive shell
```

必须在工具权限层实现。

不能只依赖 Prompt：

```Plain Text
“请不要修改文件”
```

原则：

```Plain Text
Planner  = READ ONLY
Reviewer = READ ONLY
Executor = READ + WRITE
```

同一个 Task 只能存在一个 Writer。

---

## 4\.3 Verification

Verification 属于第二阶段功能。

执行完成后，根据项目已有能力运行：

```Plain Text
test
lint
typecheck
build
```

优先使用：

```Plain Text
package.json scripts
Makefile
项目已有配置
现有测试命令
```

不要创建第二套构建系统。

示例：

```Plain Text
README-only 修改
→ SKIPPED

普通代码修改
→ 相关 tests

TypeScript 修改
→ tests + typecheck

复杂构建修改
→ tests + typecheck + build
```

结果：

```TypeScript
interface VerificationResult {
  status: "pass" | "fail" | "skipped";
  commands: string[];
  failures: string[];
}
```

如果失败：

```Plain Text
优先使用 Smart Router 原有 escalation
```

而不是立即增加高级 Reviewer 调用。

---

## 4\.4 Optional Reviewer

Reviewer 默认关闭。

只有实际使用证明 Verification 不够时再启用。

适用：

```Plain Text
高风险修改
测试持续失败
diff 明显异常
Executor 连续失败
用户主动要求 Review
测试通过但逻辑质量仍频繁出错
```

Reviewer 输入应限制为：

```Plain Text
原始任务
Planning 结果
git diff
VerificationResult
相关错误日志
```

不要默认重新发送整个 repository。

Reviewer：

```Plain Text
READ ONLY
```

输出：

```TypeScript
interface ReviewResult {
  decision: "approve" | "fix" | "replan";
  issues: string[];
  requiredFixes: string[];
}
```

自动循环限制：

```Plain Text
max review = 1
max repair = 1
max replan = 1
```

禁止无限循环。

---

# 系统要求

以当前上游项目要求为准。

开发环境至少需要：

```Plain Text
Node.js >= 22.19.0
npm
Git
Pi Coding Agent
```

检查：

```Bash
node --version
npm --version
git --version
pi --version
```

---

# 从上游源码开始开发

上游源码：

```Plain Text
https://github.com/beettlle/pi-smart-router.git
```

克隆：

```Bash
git clone https://github.com/beettlle/pi-smart-router.git
cd pi-smart-router
npm install
```

开发前必须先确认原始项目正常。

运行：

```Bash
npm test
```

如果项目已有对应 script，也运行：

```Bash
npm run typecheck
npm run lint
npm run build
```

只执行真实存在的 script。

---

# 推荐建立自己的 Fork

长期开发建议建立：

```Plain Text
your-account/pi-smart-router-plus
```

推荐 Git Remote：

```Plain Text
origin
→ 你的仓库

upstream
→ https://github.com/beettlle/pi-smart-router.git
```

如果已经直接 clone 上游：

```Bash
git remote rename origin upstream
git remote add origin https://github.com/<your-account>/pi-smart-router-plus.git
git remote -v
```

然后推送自己的仓库：

```Bash
git push -u origin main
```

---

# 开发分支

不要长期直接修改 `main`。

例如：

```Bash
git checkout -b feature/smart-router-plus
```

也可以拆成：

```Plain Text
feature/risk-guard
feature/planner-readonly
feature/verification
feature/reviewer
```

---

# 本地源码安装到 Pi

不要直接修改 npm 安装目录。

先移除官方 npm 版：

```Bash
pi remove npm:pi-smart-router
```

进入本地源码：

```Bash
cd /absolute/path/pi-smart-router-plus
npm install
```

安装本地路径：

```Bash
pi install /absolute/path/pi-smart-router-plus
```

必须优先使用绝对路径。

不要同时加载：

```Plain Text
npm:pi-smart-router
```

和：

```Plain Text
/path/to/pi-smart-router-plus
```

否则可能：

```Plain Text
双重加载
运行旧版本
重复 Router
```

---

# 确认 Pi 正在运行本地源码版

运行：

```Bash
pi list
```

确认显示：

```Plain Text
/absolute/path/pi-smart-router-plus
```

然后：

```Bash
pi --list-models | grep smart-router
```

启动 Pi 后：

```Plain Text
/model smart-router/auto
```

检查：

```Plain Text
/smart-router status
/smart-router history
/smart-router stats
```

---

# Repository\-local 开发方式

上游仓库包含：

```Plain Text
.pi/extensions/smart-router/
```

因此也可以：

```Bash
cd /path/to/pi-smart-router-plus
pi
```

让 Pi 加载仓库本地 Extension。

如果需要信任项目：

```Plain Text
/trust
```

然后重新启动 Pi。

日常开发更推荐：

```Plain Text
pi install /absolute/path/pi-smart-router-plus
```

因为可以从任意工作目录测试。

---

# 修改代码后的刷新

修改后优先：

```Plain Text
/reload
```

如果 Extension 状态没有完全刷新：

```Plain Text
退出 Pi
重新启动 Pi
```

---

# 推荐源码结构

优先保持上游目录。

新增功能建议放：

```Plain Text
src/plus/
├── risk-guard.ts
├── planner-readonly.ts
├── verification-policy.ts
├── reviewer.ts
├── task-state.ts
└── types.ts
```

如果上游已有更合适位置，则使用现有结构。

不要为了匹配此目录而重构整个项目。

---

# 开发原则

优先：

```Plain Text
新增小模块
新增 Hook
新增 Policy
新增 Guard
```

避免：

```Plain Text
重写 Router
重写 Model Registry
重写 Thinking
重写 Planning Delegate
重构整个 src/
```

目标：

```Plain Text
fork divergence 最小化
```

---

# 配置

保持配置最少。

建议：

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

默认：

```Plain Text
Risk Guard        ON
Planner Read-only ON
Verification      OFF
Reviewer          OFF
```

配置中不得包含：

```Plain Text
API Key
OAuth Token
Secret
Password
```

---

# 命令

优先继续使用：

```Plain Text
/smart-router
```

建议增加：

```Plain Text
/smart-router plus-status
/smart-router risk
```

后续：

```Plain Text
/smart-router verify
```

示例：

```Plain Text
/smart-router plus-status
```

输出：

```Plain Text
Risk Guard: ON
Planner Read-only: ON
Verification: OFF
Reviewer: OFF
```

---

# Risk Guard 开发要求

建议接口：

```TypeScript
interface RiskDecision {
  level: "low" | "medium" | "high";
  reasons: string[];
}
```

输入可以使用：

```Plain Text
Prompt
文件路径
目标环境
Git 操作
命令模式
工具意图
```

Risk Guard 不调用模型。

---

# Planner Read\-only 实现要求

Planning 开始前：

```Plain Text
保存当前工具集合
```

切换：

```Plain Text
read-only tools
```

Planning 完成后：

```Plain Text
恢复原工具集合
```

推荐模式：

```TypeScript
const previousTools = getActiveTools();

try {
  setActiveTools(readOnlyTools);

  await runExistingPlanningDelegate();
} finally {
  setActiveTools(previousTools);
}
```

具体函数名必须根据实际 Pi API 和当前源码确认。

不要假定不存在的 API。

---

# Shell 权限

不要让 Planner 拥有无限制 shell。

因为：

```Plain Text
git status
```

和：

```Plain Text
rm -rf
```

都可以通过 shell 执行。

优先：

```Plain Text
不给通用 shell
```

使用独立只读工具。

如果必须提供 shell：

```Plain Text
使用明确 allowlist
```

---

# Verification 开发要求

Verification 不负责重新设计代码。

只负责验证执行结果。

优先读取已有：

```Plain Text
package.json
Makefile
project config
CI config
```

确定已有验证命令。

不得自动执行：

```Plain Text
deploy
migration write
production command
destructive operation
```

---

# 保留上游 Thinking

本项目不重新建立：

```Plain Text
reasoning engine
thinking router
provider reasoning mapping
```

全部继续交给：

```Plain Text
Pi
+
pi-smart-router
```

Risk Guard 可以影响：

```Plain Text
是否需要 Planning
```

但不要重新设计整个 Thinking 系统。

---

# 保留上游模型系统

本项目不创建：

```Plain Text
UnifiedModelRegistry
CloudDiscovery
OllamaDiscovery
LMStudioDiscovery
ModelPricingDatabase
```

全部复用：

```Plain Text
Pi Model Registry
+
Smart Router
```

---

# 保留 Planning Delegate

Smart Router 已有：

```Plain Text
强模型 Planning
→ 便宜模型执行
```

本项目只增加：

```Plain Text
Planner Read-only Guard
```

不要再创建第二套 Planner。

---

# 保留 Failure Escalation

Smart Router 已经负责：

```Plain Text
Tool Failure
→ stronger model escalation
```

本项目不重复实现。

---

# 日志

允许：

```Plain Text
task id
risk level
route stage
selected model
thinking level
verification status
review status
```

禁止：

```Plain Text
API keys
OAuth tokens
cookies
Authorization headers
passwords
private keys
.env values
```

---

# Baseline 测试

开发任何功能前：

```Bash
npm install
npm test
```

然后启动：

```Bash
pi
```

选择：

```Plain Text
/model smart-router/auto
```

确认：

```Plain Text
local routing
cloud routing
frontier routing
planning delegate
thinking behavior
fallback
stats
history
```

全部正常。

---

# Risk Guard 测试

输入：

```Plain Text
修正 README 拼写
```

预期：

```Plain Text
LOW
```

输入：

```Plain Text
修改 authentication middleware
```

预期：

```Plain Text
HIGH
Planning required
```

输入：

```Plain Text
force push production branch
```

预期：

```Plain Text
HIGH
不得静默执行不可逆操作
```

---

# Planner Read\-only 测试

Planner：

```Plain Text
read
search
git status
git diff
```

必须成功。

Planner：

```Plain Text
write
edit
delete
git commit
git push
rm
```

必须被阻止。

---

# Tool 恢复测试

以下三种情况都必须恢复 Executor 工具：

```Plain Text
Planning 成功
Planning 失败
Planning 抛异常
```

必须使用：

```Plain Text
try/finally
```

或等效可靠机制。

---

# Verification 测试

至少覆盖：

```Plain Text
README-only 修改
→ SKIPPED

正确代码修改
→ PASS

有测试错误的修改
→ FAIL
```

---

# 成本约束

Smart Router Plus 不能破坏 Smart Router 原本的成本优势。

必须满足：

```Plain Text
简单任务
→ Plus 新增云端调用 = 0

普通任务
→ Plus 新增云端调用 = 0

Risk Guard
→ 本地规则

Planner Read-only
→ 不增加模型调用

Reviewer
→ 默认关闭
```

---

# MVP

第一版只实现：

```Plain Text
Risk Guard
Planner Read-only Guard
基础状态显示
测试
本地安装
可打包结构
```

不要在 MVP 中实现：

```Plain Text
Reviewer
第二套 Router
第二套 Model Registry
第二套 Thinking
复杂 Verification Orchestrator
```

---

# 开发顺序

## Phase 0

```Plain Text
克隆上游
安装依赖
运行上游测试
确认 Smart Router 正常
```

## Phase 1

```Plain Text
Risk Guard
```

要求：

```Plain Text
零 LLM 调用
```

## Phase 2

```Plain Text
Planner Read-only Guard
```

要求：

```Plain Text
工具层真实限制
```

## Phase 3

```Plain Text
Verification
```

## Phase 4

```Plain Text
Reviewer
```

只有真实使用证明需要才开发。

---

# Reviewer 开发门槛

建议至少积累：

```Plain Text
50–100 个真实 coding task
```

如果发现：

```Plain Text
Verification PASS
但人工 Review 仍发现严重问题
> 5%–10%
```

再加入 Reviewer。

否则不开发。

---

# 同步上游

保持：

```Plain Text
origin
→ 自己的仓库

upstream
→ https://github.com/beettlle/pi-smart-router.git
```

同步：

```Bash
git fetch upstream
git checkout main
git merge upstream/main
```

也可以使用 rebase，但团队应长期统一一种方式。

---

# 上游冲突处理

发生冲突时：

```Plain Text
优先保留 upstream 最新 Router 逻辑
↓
重新应用 Plus Guard
```

不要为了保留旧 fork 而冻结上游。

---

# 上游更新后的回归测试

必须重新检查：

```Plain Text
npm install / npm ci
tests
typecheck
build（如果存在）
Pi startup
local route
cloud route
Planning Delegate
Thinking
Fallback
Risk Guard
Planner Read-only
Verification
```

---

# License

本项目基于：

```Plain Text
https://github.com/beettlle/pi-smart-router.git
```

上游使用：

```Plain Text
MIT License
```

必须保留：

```Plain Text
LICENSE
原版权声明
原项目 Attribution
```

README 应明确说明：

```Plain Text
Based on pi-smart-router by beettlle.
```

---

# 项目名称

建议 fork 发布名称：

```Plain Text
pi-smart-router-plus
```

不要继续直接使用：

```Plain Text
pi-smart-router
```

作为自己的发行包名。

这样可以避免用户误认为是上游官方版本。

---

# package\.json

正式发布自己的 npm 包时至少修改：

```Diff
- "name": "pi-smart-router"
+ "name": "pi-smart-router-plus"
```

并更新：

```Plain Text
version
description
repository
homepage
bugs
```

不要为了改名字而重命名所有内部 symbol。

---

# 版本建议

```Plain Text
0.1.0
Risk Guard + Planner Read-only

0.2.0
Verification

0.3.0
Optional Reviewer

1.0.0
Stable release
```

---

# 分享给朋友：源码方式

朋友执行：

```Bash
git clone https://github.com/<your-account>/pi-smart-router-plus.git
cd pi-smart-router-plus

npm install

pi install /absolute/path/pi-smart-router-plus
```

确认：

```Bash
pi list
pi --list-models | grep smart-router
```

---

# 分享给朋友：npm

稳定后发布：

```Bash
npm login
npm publish
```

朋友：

```Bash
pi install npm:pi-smart-router-plus
```

这是推荐的长期分享方式。

---

# 发布前检查

运行：

```Bash
npm pack --dry-run
```

确认包中不存在：

```Plain Text
.env
credentials
auth.json
tokens
logs
personal routing history
local model files
private config
```

然后运行完整测试。

---

# 45\. `.gitignore` / npm 发布排除

至少确保不提交或发布：

```Plain Text
.env
*.pem
*.key
credentials*
auth.json
tokens*
logs/
local-state/
private-config/
```

具体规则应基于现有上游 `.gitignore` 增量补充。

---

# 开发 Agent 工作规则

任何 AI Coding Agent 在修改本项目之前必须先：

```Plain Text
阅读 AGENTS.md
阅读 README.md
检查 package.json
检查现有 tests
定位 Router
定位 Planning Delegate
定位 Tool 管理
定位 Thinking 调用
定位 config schema
```

然后才允许编辑代码。

---

# 推荐给 AI Agent 的第一条任务

```Plain Text
阅读当前 pi-smart-router 源码。

重点定位：
1. Router 主入口
2. Planning Delegate
3. Tool 权限控制
4. Model/Thinking 切换
5. Config schema
6. Command registration
7. Tests

只输出结构分析和最小改造方案。

不要修改文件。
```

之后再分别执行：

```Plain Text
实现 Risk Guard。
```

然后：

```Plain Text
实现 Planner Read-only Guard。
```

不要一次性要求 Agent 重写整个项目。

---

# Definition of Done

项目达到稳定版本时必须满足：

```Plain Text
✓ 基于官方 pi-smart-router 源码开发
✓ 可以持续同步 upstream
✓ 未重写核心 Router
✓ 原本本地模型路由正常
✓ 原本云模型路由正常
✓ Thinking 正常
✓ Planning Delegate 正常
✓ Fallback 正常
✓ Risk Guard 工作
✓ Planner 工具层真正只读
✓ Executor 写权限可靠恢复
✓ Verification 可选工作
✓ Reviewer 默认关闭
✓ 没有复制 API Key
✓ 没有建立第二套 Model Registry
✓ 简单任务没有额外 Cloud LLM Call
✓ path package 可正常安装
✓ npm package 可正常发布
✓ LICENSE 合规
✓ 朋友可以独立安装
```

---

# 最终定位

Pi Smart Router Plus 不是：

```Plain Text
新的 Agent Framework
```

也不是：

```Plain Text
新的模型 Router
```

它应该始终保持：

```Plain Text
pi-smart-router
+
Risk Guard
+
Planner Safety
+
Verification
+
Optional Review
```

核心价值：

> 在保留 Smart Router 原有高性价比模型调度能力的基础上，为代码开发增加风险识别、Planner 写权限隔离和结果质量验证，同时保持 fork 足够薄，能够长期跟随上游更新。
> 
> 




---

## Upstream documentation

This fork keeps the full upstream documentation at
[`docs/upstream-README.md`](docs/upstream-README.md) (pi-smart-router by
[beettlle](https://github.com/beettlle/pi-smart-router), MIT).

When upstream routing, model discovery, thinking, pricing or CLI behavior is
updated, that file is the reference — Smart Router Plus only adds the thin
safety/quality layer described above.

### Contribute a community bench report

Share a privacy-safe setup fingerprint + Track A (TwinRouterBench) gate result
with upstream maintainers. No SMTP auto-send and no upload server — you copy
artifacts yourself.

**Maintainer contact** (must match the CLI footer constant
`COMMUNITY_BENCH_MAINTAINER_CONTACT`):

`https://github.com/beettlle/pi-smart-router/issues/new?labels=community-bench`

The full instructions (Track A offline smoke, optional Track C corpus sharing)
live in [`docs/upstream-README.md`](docs/upstream-README.md#contribute-a-community-bench-report).
