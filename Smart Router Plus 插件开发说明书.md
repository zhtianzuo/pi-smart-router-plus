# Smart Router Plus 插件开发说明书

下面这版把**源码来源、克隆、建立二次开发仓库、安装本地源码版、开发约束、测试、同步上游、重新打包和分享给朋友**都正式纳入了说明书；并以当前源码仓库 `https://github.com/beettlle/pi-smart-router.git` 为基线。该仓库当前要求 Node\.js `>=22.19.0`，支持直接从源码运行，仓库自带 `.pi/extensions/smart-router/`，Pi 也支持把 clone 目录作为 path package 安装；开发时应移除 npm 版，避免双重加载。\([GitHub](https://github.com/beettlle/pi-smart-router)\)

# Pi Smart Router Plus

**项目定位：** 基于 `pi-smart-router` 源码的增强版 Pi Coding Agent 智能路由插件
**建议项目名：** `pi-smart-router-plus`
**建议 npm 包名：** `pi-smart-router-plus`
**上游源码：** `https://github.com/beettlle/pi-smart-router.git`
**许可证：** MIT
**开发方式：** 克隆上游源码 → 建立自己的 fork/仓库 → 本地 path package 开发 → 增量增强 → 测试 → 打包分享

---

# 项目背景

原始目标是开发一个完整的自适应模型调度系统，包括：

```Plain Text
模型发现
模型能力识别
本地/云端统一调度
Thinking 自动调整
任务复杂度判断
高级模型 Planning
低成本模型执行
失败升级
验证
Reviewer
成本控制
```

经过对 `pi-smart-router` 当前源码和功能的确认，发现其已经实现原目标中的大部分基础能力。

上游项目本身已经提供：

```Plain Text
Local / economical cloud / frontier 三层路由
Pi Registry 驱动模型发现
Ollama / LM Studio 本地模型探测
上下文窗口检查
任务/Turn 分类
成本与能力评分
Thinking 调节
Planning Delegate
Tool failure escalation
Session pin
Prompt cache economics
Fallback
路由历史和统计
```

因此本项目不再从零实现完整 Router。

新的开发策略是：

```Plain Text
pi-smart-router
       ↓
保留核心架构
       ↓
增加缺失的安全/质量策略
       ↓
Smart Router Plus
```

---

# 项目核心目标

Smart Router Plus 只补充上游真正缺少或不足的能力。

核心新增范围：

```Plain Text
Risk Guard
+
Planner Read-only Guard
+
Verification Policy
+
Optional Reviewer
+
适合个人/朋友使用的打包发行流程
```

优先级：

```Plain Text
P0 上游源码可正常开发和运行
P1 Risk Guard
P1 Planner Read-only Guard
P2 Verification
P3 Reviewer
```

---

# 非目标

明确不重新实现：

```Plain Text
Pi Model Registry
Cloud Provider Auth
Ollama Discovery
LM Studio Discovery
Model Ranking Engine
Context-fit Gate
Thinking 基础系统
Planning Delegate
Session Pin
Prompt Cache Logic
Tool Failure Escalation
HyDRA Matcher
成本数据库
完整 Agent Framework
```

这些全部优先复用上游。

---

# 上游源码基线

正式开发必须基于：

```Plain Text
https://github.com/beettlle/pi-smart-router.git
```

上游仓库当前包含：

```Plain Text
src/
tests/
config/
docs/
.pi/extensions/smart-router/
package.json
package-lock.json
tsconfig.json
vitest.config.ts
```

Pi Smart Router 本身是 Pi Coding Agent 的扩展，并且仓库自带 project\-local Pi extension。直接从源码运行时，Pi 可以加载 `.pi/extensions/smart-router/`。\([GitHub](https://github.com/beettlle/pi-smart-router)\)

---

# 开发环境要求

上游当前要求：

```Plain Text
Node.js >= 22.19.0
Pi Coding Agent >= 上游 package 声明的最低版本
npm
Git
```

当前 README 标明 Node\.js 引擎下限为：

```Plain Text
>= 22.19.0
```

开发前检查：

```Bash
node --version
npm --version
git --version
pi --version
```

Node 版本不足时先升级。

---

# 推荐的源码获取方式

不要直接在 npm 安装目录里修改。

正式二次开发应：

```Bash
git clone https://github.com/beettlle/pi-smart-router.git
cd pi-smart-router
npm install
```

这是上游官方 README 给出的 source contributor 工作流。\(GitHub\)

---

# 推荐：建立自己的 Fork

长期维护时不要只保留本地 clone。

推荐先在 GitHub Fork：

```Plain Text
beettlle/pi-smart-router
        ↓ fork
your-account/pi-smart-router-plus
```

然后 clone 自己的仓库。

例如：

```Bash
git clone https://github.com/<your-account>/pi-smart-router-plus.git
cd pi-smart-router-plus
npm install
```

然后增加原项目为 upstream：

```Bash
git remote add upstream https://github.com/beettlle/pi-smart-router.git
```

检查：

```Bash
git remote -v
```

预期：

```Plain Text
origin    → 你的仓库
upstream  → beettlle/pi-smart-router
```

---

# 如果先 clone 原仓库再转为自己的仓库

也允许：

```Bash
git clone https://github.com/beettlle/pi-smart-router.git
cd pi-smart-router
npm install
```

然后：

```Bash
git remote rename origin upstream
git remote add origin https://github.com/<your-account>/pi-smart-router-plus.git
git push -u origin main
```

最终同样保持：

```Plain Text
origin
→ 自己的仓库

upstream
→ 原作者仓库
```

---

# 开发分支策略

建议不要直接长期在 `main` 开发。

建立：

```Bash
git checkout -b feature/smart-router-plus
```

或者按功能拆：

```Plain Text
feature/risk-guard
feature/planner-readonly
feature/verification
feature/reviewer
```

正式发布时合回自己的：

```Plain Text
main
```

---

# 本地源码开发安装方式

上游明确建议：开发源码版时，移除已经安装的 npm 版，避免同时加载两份 Smart Router。\(GitHub\)

先执行：

```Bash
pi remove npm:pi-smart-router
```

然后安装你的源码目录：

```Bash
pi install /absolute/path/pi-smart-router-plus
```

必须优先使用绝对路径。

例如：

```Bash
pi install /Users/yourname/dev/pi-smart-router-plus
```

注意：

```Plain Text
Pi path package 不会自动执行 npm install
```

因此必须先：

```Bash
cd /absolute/path/pi-smart-router-plus
npm install
```

再：

```Bash
pi install /absolute/path/pi-smart-router-plus
```

上游 README 明确说明 path package 不会自动执行 `npm install`。\([GitHub](https://github.com/beettlle/pi-smart-router)\)

---

# 确认 Pi 实际加载的是源码版

执行：

```Bash
pi list
```

必须看到：

```Plain Text
你的本地 clone path
```

而不是：

```Plain Text
~/.pi/agent/npm/.../pi-smart-router
```

然后：

```Bash
pi --list-models | grep smart-router
```

应看到：

```Plain Text
smart-router auto
```

上游官方也建议通过这两个步骤确认源码版本是否真正加载。\(GitHub\)

---

# 另一种开发方式：仓库目录自动发现

上游仓库包含：

```Plain Text
.pi/extensions/smart-router/
```

因此，也可以：

```Bash
cd /path/to/pi-smart-router-plus
pi
```

让 Pi 自动发现项目本地扩展。

但此方式需要信任项目。

首次启动 Pi 时接受 trust 提示。

如果错过：

```Plain Text
/trust
```

然后重启 Pi。

上游说明中明确指出：project\-local extension 必须在项目被 trust 后才会加载。\(GitHub\)

---

# 推荐开发方式

优先使用：

```Plain Text
Path Package
```

即：

```Bash
pi install /absolute/path/pi-smart-router-plus
```

原因：

```Plain Text
可以从任意 cwd 使用
不依赖必须进入 repo root
更接近最终用户安装行为
更容易确认自己运行的是哪个版本
```

repo\-root auto\-discovery 只作为辅助开发方式。

---

# 源码修改后的刷新

上游源码通过 Pi loader 直接加载 TypeScript，开发 dogfood 时通常不要求每次先 `npm run build`。\([GitHub](https://github.com/beettlle/pi-smart-router)\)

修改后优先：

```Plain Text
/reload
```

如果状态没有完全刷新：

```Plain Text
退出并重新启动 pi
```

---

# 初始基线测试

任何二次开发之前必须先确认原版源码完全正常。

执行：

```Bash
npm install
npm test
```

如果 package scripts 中还有：

```Plain Text
typecheck
lint
build
```

则一并运行对应现有脚本。

然后启动：

```Bash
pi
```

选择：

```Plain Text
/model smart-router/auto
```

检查：

```Plain Text
/smart-router status
/smart-router history
/smart-router stats
```

只有原始源码完全正常后才能开始改。

---

# 建立 Baseline Tag

建议第一次确认正常后：

```Bash
git tag upstream-baseline
```

或者：

```Bash
git tag smart-router-plus-base
```

方便后续比较：

```Plain Text
原版行为
vs
你的修改
```

---

# 项目整体架构

Smart Router Plus 最终架构：

```Plain Text
User Prompt
     ↓
Risk Guard
     ↓
Original Smart Router
     ↓
12-stage routing pipeline
     ↓
Local / Economical / Frontier
     ↓
Planning Delegate（如需要）
     ↓
Planner Read-only Guard
     ↓
Executor
     ↓
Verification
     ↓
PASS / FAIL
```

未来：

```Plain Text
FAIL / high-risk final review
         ↓
      Reviewer
         ↓
    Fix / Replan
```

---

# 必须保持的上游核心

以下代码尽量不大改：

```Plain Text
hardware probe
turn envelope
context-fit
low-intensity tier gate
session pin
deterministic triage
local zero-tier
cloud fallback
HyDRA matcher
safe cloud default
context overflow fallback
```

上游当前 Router 是顺序的 12 阶段 early\-exit pipeline，因此新增逻辑必须尽量作为小型 policy/gate 插入，而不是重构整个 pipeline。\(GitHub\)

---

# Smart Router Plus 新增模块

建议新增：

```Plain Text
src/plus/
├── risk-guard.ts
├── planner-readonly.ts
├── verification-policy.ts
├── reviewer.ts
├── task-state.ts
└── types.ts
```

如果上游已有更合适模块位置，则优先融入现有结构。

原则：

```Plain Text
新增小模块
>
修改成熟核心
```

---

# 新增能力一：Risk Guard

Risk Guard 负责识别：

```Plain Text
操作风险
```

而不是重复判断：

```Plain Text
模型复杂度
模型成本
上下文长度
```

输出：

```TypeScript
interface RiskDecision {
  level: "low" | "medium" | "high";
  reasons: string[];
}
```

---

# Risk Guard 必须识别

HIGH RISK 至少包括：

```Plain Text
production
production deploy
authentication
authorization
permissions
credential
secret
API key
token
database migration
database deletion
user data
destructive filesystem action
git reset --hard
git clean
force push
history rewrite
firewall
network security
session concurrency
process management
irreversible migration
```

---

# Risk Guard v1 不调用模型

Risk Detection 第一版必须：

```Plain Text
纯规则
纯本地
零 LLM API 成本
```

可分析：

```Plain Text
Prompt
命令
路径
文件名
目标环境
Git 操作
工具意图
```

---

# Risk 对 Router 的影响

LOW：

```Plain Text
不改变原 Smart Router 决策
```

MEDIUM：

```Plain Text
增加 Planning 倾向
或提高最低能力要求
```

HIGH：

```Plain Text
requiresPlanning = true
```

必要时：

```Plain Text
minimumTier = frontier
```

但不能所有 High Risk 都机械强制最贵 Executor。

高级模型主要用于：

```Plain Text
Planning
Review
```

---

# 新增能力二：Planner Read\-only Guard

这是 MVP 必须功能。

目标：

```Plain Text
Planner 只能分析
Executor 才能修改
```

Planner 允许：

```Plain Text
read
search
grep
find
git status
git diff
读取日志
读取测试结果
```

禁止：

```Plain Text
write
edit
delete
git commit
git push
deploy
publish
数据库写
破坏性 shell
```

---

# Planner Read\-only 必须在工具层实现

不能只靠 Prompt：

```Plain Text
“不要修改文件”
```

必须真正限制 Active Tools。

如果 Pi 当前接口允许：

```Plain Text
getActiveTools()
setActiveTools()
```

则使用其实际 API。

实现模式：

```TypeScript
const previousTools = getActiveTools();

try {
  setActiveTools(readOnlyTools);
  await runExistingPlanningDelegate();
} finally {
  setActiveTools(previousTools);
}
```

具体接口名称必须根据当前安装版本的 Pi API 和上游代码确认后实现，不得凭空造 API。

---

# Bash 特殊处理

Planner 不应直接拥有完全开放的 shell。

因为：

```Plain Text
bash
```

可以运行：

```Plain Text
git status
```

也可以运行：

```Plain Text
rm -rf
```

推荐：

```Plain Text
Planner 不提供通用 shell
```

只开放专用只读工具。

如果无法避免，则必须做明确 allowlist。

---

# 单 Writer 原则

同一个 Task：

```Plain Text
Planner  READ ONLY
Reviewer READ ONLY
Executor READ + WRITE
```

必须保证：

```Plain Text
只有一个 Agent 能实际修改工作目录
```

---

# 新增能力三：Verification Policy

Phase 2 实现。

执行完成后，根据项目已有能力运行：

```Plain Text
test
lint
typecheck
build
```

原则：

```Plain Text
使用已有命令
不创造新构建系统
```

---

# Verification 智能范围

README 修改：

```Plain Text
skip
```

单个代码模块：

```Plain Text
相关 test
```

普通 TS/JS 修改：

```Plain Text
test
typecheck
```

复杂构建逻辑：

```Plain Text
test
typecheck
build
```

具体使用项目已存在 scripts。

---

# VerificationResult

```TypeScript
interface VerificationResult {
  status: "pass" | "fail" | "skipped";
  commands: string[];
  failures: string[];
}
```

---

# Verification 与原 Router 的关系

Verification FAIL：

第一步：

```Plain Text
交给 Smart Router 原有 escalation
```

而不是立即创造新的 Reviewer Call。

---

# 新增能力四：Reviewer

Reviewer 不属于 MVP。

只有实际使用证明需要才开发。

典型触发：

```Plain Text
测试连续失败
高风险修改
diff 超出预期
用户主动要求 review
执行结果明显不稳定
```

---

# Reviewer 输入

只提供：

```Plain Text
原始需求
Planning 结果
git diff
VerificationResult
相关错误
```

禁止无条件重新上传整个 Repository。

---

# Reviewer 输出

```TypeScript
interface ReviewResult {
  decision:
    | "approve"
    | "fix"
    | "replan";

  issues: string[];

  requiredFixes: string[];
}
```

Reviewer 自身：

```Plain Text
READ ONLY
```

---

# Repair Loop

未来：

```Plain Text
Reviewer fix
     ↓
Executor
     ↓
Verification
```

最多：

```Plain Text
1 review
1 repair
1 replan
```

禁止无限循环。

---

# 保留 Smart Router 原有 Thinking

Smart Router Plus 不再实现一套自己的 Thinking 系统。

继续使用：

```Plain Text
Pi Thinking
+
Smart Router Thinking policy
```

你的增强代码只允许：

```Plain Text
在高风险时提高最低 Planning 要求
```

不要重新造：

```Plain Text
adaptive-thinking-engine.ts
```

---

# 保留原 Model Registry

不得创建第二套：

```Plain Text
UnifiedModelRegistry
```

原 Smart Router 已经从 Pi 可用模型集进行调度，并支持 authenticated cloud models；本地 zero\-tier 也会探测 Ollama / LM Studio。\(GitHub\)

因此 Plus 只读取现有结果。

---

# 保留原成本机制

上游已经在 routing decision 中处理：

```Plain Text
estimated cost
capability
latency
TTFT
context
```

Plus 不再维护另一张模型价格表。\(GitHub\)

---

# 保留原 Planning Delegate

不得重复实现：

```Plain Text
Strong Planner
→ Cheap Executor
```

只有：

```Plain Text
给 Planner 加 read-only guard
```

---

# 保留原 Failure Escalation

上游已有 repeated identical tool failure → frontier escalation。\(GitHub\)

Plus 不重新实现。

---

# 配置设计

只增加最小配置。

例如：

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

不增加模型账号配置。

不增加 Provider Key。

不增加 Thinking 映射。

---

# 默认配置

MVP：

```Plain Text
riskGuard = true
plannerReadOnly = true
verification = false
reviewer = false
```

Phase 2：

```Plain Text
verification = true
```

Reviewer 默认仍为：

```Plain Text
false
```

---

# CLI / Command

优先扩展现有：

```Plain Text
/smart-router
```

建议：

```Plain Text
/smart-router plus-status
/smart-router risk
```

后续：

```Plain Text
/smart-router verify
```

如果修改现有命令系统代价过高，再使用：

```Plain Text
/smart-router-plus
```

---

# plus\-status

输出：

```Plain Text
Risk Guard: ON
Planner Read-only: ON
Verification: OFF
Reviewer: OFF
```

---

# risk

输出上一任务：

```Plain Text
Risk: HIGH

Reasons:
- production deployment
- authentication change
```

禁止输出隐藏 Chain of Thought。

---

# 日志

允许记录：

```Plain Text
task id
route stage
selected model
thinking
risk level
verification status
review status
```

禁止记录：

```Plain Text
API Key
OAuth Token
Cookie
Authorization
Password
Private Key
Secret
完整 .env
```

---

# 上游兼容原则

关闭 Plus：

```Plain Text
行为应尽量等同 upstream
```

即：

```Plain Text
plus.riskGuard = false
plus.plannerReadOnly = false
plus.verification = false
plus.reviewer = false
```

时不得大范围改变 Router。

---

# Fork 修改原则

优先：

```Plain Text
additive changes
```

不优先：

```Plain Text
rewrite
```

应该：

```Plain Text
新增 policy
新增 hook
新增 guard
新增 small adapter
```

避免：

```Plain Text
重写 Router pipeline
重做模型评分
重构整个 src
```

---

# 上游同步

定期执行：

```Bash
git fetch upstream
git checkout main
git merge upstream/main
```

或者你的团队统一使用：

```Bash
git rebase upstream/main
```

二者选一个长期保持一致。

不要每次随意切换 merge/rebase 策略。

---

# 同步上游前

必须保证：

```Bash
git status
```

干净。

建议：

```Bash
git checkout -b sync/upstream-YYYYMMDD
```

再合并 upstream。

---

# 上游更新冲突处理原则

冲突时：

```Plain Text
优先保留 upstream Router 核心新逻辑
然后重新应用 Plus 的小型 Guard
```

不要为了保护旧 fork 而阻止上游安全修复和路由改进。

---

# 上游同步后必须回归测试

至少：

```Plain Text
npm install / npm ci
tests
typecheck
build（如项目已有）
Pi startup
/model smart-router/auto
/smart-router status
local routing
cloud routing
planning delegate
failure escalation
```

然后测试 Plus：

```Plain Text
Risk Guard
Planner Read-only
Tool restore
Verification
```

---

# 开发测试：Baseline

Case：

```Plain Text
普通简单 Prompt
```

Plus 关闭：

```Plain Text
route 与 upstream 一致
```

---

# Risk Guard 测试

输入：

```Plain Text
修改 README
```

预期：

```Plain Text
LOW
不修改原 Router 路由
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
force push production
```

预期：

```Plain Text
HIGH
不可静默执行危险操作
```

---

# Planner Read\-only 测试

Planner 尝试：

```Plain Text
write
edit
delete
git commit
rm
```

必须失败。

Planner：

```Plain Text
read
search
git status
git diff
```

必须正常。

---

# Tool Restore 测试

Planning 正常完成：

```Plain Text
Executor 写权限恢复
```

Planning 抛异常：

```Plain Text
Executor 写权限仍恢复
```

必须测试 try/finally。

---

# Verification 测试

制造：

```Plain Text
通过测试的修改
失败测试的修改
README-only 修改
```

分别验证：

```Plain Text
PASS
FAIL
SKIPPED
```

---

# 性能要求

Risk Guard：

```Plain Text
不得新增 LLM 请求
```

Planner Read\-only：

```Plain Text
不得新增 LLM 请求
```

Verification：

```Plain Text
只增加本地必要命令
```

Reviewer：

```Plain Text
默认不开启
```

---

# 成本要求

Simple Task：

```Plain Text
Plus 新增云模型调用 = 0
```

Normal Task：

```Plain Text
Plus 新增云模型调用 = 0
```

High Risk：

```Plain Text
可以影响已有 Planning 决策
但不得无条件增加第二个高级模型流程
```

---

# 安全要求

Pi Package 本身具有较高系统权限，上游 README 也明确提醒第三方 Extension 会执行任意代码，因此分享前必须检查自己的源码和依赖。\(GitHub\)

必须：

```Plain Text
不写入 auth
不打印 token
不上传 credentials
不执行隐藏网络扫描
不自动运行 destructive command
```

---

# 61\. `.gitignore` / `.npmignore`

不得提交或发布：

```Plain Text
.env
*.key
*.pem
auth.json
credentials
token files
local logs
personal routing history
state DB
本地模型权重
个人 Pi settings
临时 benchmark output
```

保留上游已有 ignore 规则，并补充 Plus 所需排除项。

---

# License

上游当前许可证为：

```Plain Text
MIT
```

因此允许：

```Plain Text
修改
复制
分发
再发布
商业使用
```

但必须保留原始版权和许可证声明。\(GitHub\)

---

# Fork 的版权处理

保留原：

```Plain Text
LICENSE
```

不要删除。

README 中说明：

```Plain Text
Based on pi-smart-router
Original repository:
https://github.com/beettlle/pi-smart-router
License: MIT
```

可以补充：

```Plain Text
Additional modifications by <your project/team>
```

---

# 项目重命名

建议将：

```Plain Text
pi-smart-router
```

改成：

```Plain Text
pi-smart-router-plus
```

避免朋友以为这是官方原版。

同时更新：

```Plain Text
package.json name
README title
description
package metadata
```

但不要无意义地批量重命名内部所有 symbol。

---

# package\.json

修改最少字段：

```Diff
- "name": "pi-smart-router"
+ "name": "pi-smart-router-plus"
```

以及：

```Plain Text
version
description
repository
bugs/homepage
```

如果实际准备发布 npm，再修改这些 metadata。

开发阶段不必急着重构所有 package identity。

---

# 版本策略

建议：

```Plain Text
0.1.0
Risk Guard + Planner Read-only

0.2.0
Verification

0.3.0
Optional Reviewer

1.0.0
长期稳定版本
```

不要沿用上游同版本号却改变行为。

---

# 分享方式 A：GitHub 源码

适合朋友少。

朋友：

```Bash
git clone https://github.com/<your-account>/pi-smart-router-plus.git
cd pi-smart-router-plus
npm install
pi install /absolute/path/pi-smart-router-plus
```

然后：

```Bash
pi --list-models | grep smart-router
```

---

# 分享方式 B：GitHub Release

可以创建：

```Plain Text
v0.1.0
v0.2.0
```

Release Notes 必须写：

```Plain Text
Based on upstream commit/tag
Plus changes
Known limitations
Pi minimum version
Node minimum version
```

---

# 分享方式 C：npm

稳定后：

```Bash
npm login
npm publish
```

朋友：

```Bash
pi install npm:pi-smart-router-plus
```

这才是最终最方便的分发方式。

---

# npm 发布前必须检查

```Bash
npm pack --dry-run
```

确认 tarball 不含：

```Plain Text
.env
credentials
logs
test secrets
个人路径
个人 state
```

然后：

```Bash
npm test
```

以及现有：

```Plain Text
typecheck
build
lint
```

如 package scripts 支持。

---

# npm 安装与源码开发不能同时加载

开发机器如果发布版已经安装：

```Bash
pi remove npm:pi-smart-router-plus
```

再：

```Bash
pi install /absolute/path/pi-smart-router-plus
```

不要：

```Plain Text
npm 版
+
path 版
```

同时存在。

这和上游开发 Smart Router 的原则一致；上游明确提醒 npm package 与 path package 可产生双重加载和旧代码继续运行的问题。\(GitHub\)

---

# README 安装说明必须分开

README 必须明确三种方式：

```Plain Text
Normal user:
pi install npm:pi-smart-router-plus

Developer:
git clone...
npm install
pi install /absolute/path/...

Repo-local contributor:
cd repo
/trust
```

不能混在一起导致用户重复安装。

---

# MVP 开发范围

第一阶段只做：

```Plain Text
1. Fork/clone 源码可运行
2. Risk Guard
3. Planner Read-only Guard
4. 基础命令和状态显示
5. Tests
6. Packaging 基础
```

不做：

```Plain Text
Reviewer
复杂 Verification
新的 Router
新的 Model Registry
```

---

# MVP 开发流程

```Plain Text
Clone upstream
↓
建立自己的 repo
↓
运行原版 tests
↓
确认 Smart Router 正常
↓
实现 Risk Guard
↓
测试
↓
实现 Planner Read-only
↓
测试
↓
做完整 Regression
↓
本地 dogfood
↓
tag v0.1.0
```

---

# Phase 2

增加：

```Plain Text
Verification Policy
```

然后：

```Plain Text
code execution
↓
test/typecheck/build
↓
PASS/FAIL
```

版本：

```Plain Text
v0.2.0
```

---

# Phase 3

只有真实使用数据证明需要时：

```Plain Text
Optional Reviewer
```

版本：

```Plain Text
v0.3.0
```

---

# Reviewer 开发触发标准

建议至少积累：

```Plain Text
50–100 个真实开发任务
```

如果：

```Plain Text
Verification PASS
但人工检查仍发现严重错误
> 5%–10%
```

再开发自动 Reviewer。

否则不做。

---

# 项目完成定义

v1\.0 最终必须满足：

```Plain Text
✓ 基于 beettlle/pi-smart-router 源码开发
✓ 可以重新同步 upstream
✓ 原 Router 核心未被大幅重写
✓ Pi 云端模型路由保持正常
✓ Ollama/LM Studio 路由保持正常
✓ Thinking 保持正常
✓ Planning Delegate 保持正常
✓ Risk Guard 工作
✓ Planner 真正只读
✓ Executor 能恢复写权限
✓ Verification 可选启用
✓ Reviewer 可选启用
✓ 没有复制 API Key
✓ 没有新建第二套 Registry
✓ 没有额外的简单任务 LLM 调用
✓ path package 可安装
✓ npm package 可打包
✓ LICENSE 合规
✓ 朋友可独立安装使用
```

---

# 推荐最终架构

```Plain Text
Pi Coding Agent
                        │
                        ▼
              Smart Router Plus
                        │
                  Risk Guard
                        │
                        ▼
               Upstream Router
                        │
      ┌─────────────────┼─────────────────┐
      │                 │                 │
   Local            Economical        Frontier
      │                Cloud            Planner
      │                                  │
      │                          Read-only Guard
      │                                  │
      └─────────────────┬────────────────┘
                        ▼
                     Executor
                        │
                        ▼
                   Verification
                        │
                ┌───────┴───────┐
                │               │
               PASS            FAIL
                │               │
               DONE        Upstream Escalation
                                │
                         Optional Reviewer
```

---

# 最终开发原则

整个项目必须贯彻：

```Plain Text
Use upstream first.
Patch only what is missing.
Keep the fork thin.
Keep upstream mergeable.
```

中文即：

> **能复用上游就绝不重写；只补风险、权限和质量闭环；始终让自己的 fork 保持容易同步原项目。**
> 
> 

---

# 一套完整的首次开发命令

如果从零开始：

```Bash
git clone https://github.com/beettlle/pi-smart-router.git
cd pi-smart-router

npm install

git remote rename origin upstream
git remote add origin https://github.com/<your-account>/pi-smart-router-plus.git

git checkout -b feature/smart-router-plus

pi remove npm:pi-smart-router

pi install /absolute/path/pi-smart-router

pi list
pi --list-models | grep smart-router
```

确认正常后：

```Plain Text
开始写 Risk Guard
```

等你把目录正式改成：

```Plain Text
pi-smart-router-plus
```

再重新安装 path：

```Bash
pi remove /old/absolute/path/pi-smart-router
pi install /new/absolute/path/pi-smart-router-plus
```

---

# 推荐给开发 Agent 的第一条任务

开发 Agent 不应直接开始大改 Router。

第一步任务应该是：

```Plain Text
阅读当前 pi-smart-router 源码、AGENTS.md、package.json、README 和现有 tests。

确认：
1. Router 主入口
2. Planning Delegate 实现位置
3. active tools 的控制位置
4. Pi model/thinking 的调用位置
5. config schema
6. command registration
7. test structure

只输出代码结构分析和最小改造方案。
不要修改文件。
```

第二步才：

```Plain Text
实现 Risk Guard。
```

第三步：

```Plain Text
实现 Planner Read-only Guard。
```

不要直接要求 Agent：

```Plain Text
“按照整个说明书一次性完成全部功能。”
```

---

# 最终定位

Pi Smart Router Plus 不是另一个 Router Framework。

它是：

```Plain Text
pi-smart-router
+
Risk-aware policy
+
Planner safety boundary
+
Verification layer
+
Optional review loop
```

核心价值：

> **继续享受上游 Smart Router 已经成熟的模型路由和成本优化，只对代码开发中真正重要的风险、写权限和结果质量增加一层薄增强。**
> 
> 

这版已经把从指定 GitHub 源码开始二次开发的完整流程写进去了，并且与上游当前官方的源码开发方式保持一致。\(GitHub\)

