# SENTINEL 项目开发计划书

**Project:** SENTINEL  
**Full Name:** State-aware Intelligent Security Agent  
**Version:** 0.1.0  
**Date:** 2026-10-08  
**Development Mode:** Solo Developer + AI-assisted Engineering  
**Primary Language:** Python / TypeScript（依据 AGH 插件接口确定）  
**Research Domain:** AI × Cybersecurity × Blockchain

## 1. 项目愿景

构建一个具有状态理解、自主推理、工具执行和反馈验证能力的智能合约安全智能体。

区别于传统智能合约静态分析工具，SENTINEL 不仅分析代码中可能存在的危险模式，还关注合约执行过程中状态变量、交易序列和业务约束之间的关系。

系统的核心工作流为：

```text
                  ┌────────────────────┐
                  │   Solidity Project │
                  └─────────┬──────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │  Contract Analysis    │
                │  合约解析与结构理解     │
                └───────────┬───────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │ State Transition      │
                │ Modeling              │
                │ 状态转移关系建模        │
                └───────────┬───────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │ Vulnerability         │
                │ Hypothesis Generation │
                │ 漏洞假设生成           │
                └───────────┬───────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │ Foundry Verification  │
                │ 本地测试生成与验证      │
                └───────────┬───────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │ Feedback & Refinement │
                │ 执行反馈与假设修正      │
                └───────────┬───────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │ Evidence-based Report │
                │ 可验证安全分析报告      │
                └───────────────────────┘
```

AGH 必须是真正负责运行与调度上述流程的智能体底座，而不能只是外围包装。

### 核心原则

**Every finding must be supported by evidence.**

每一项最终标记为「已验证」的漏洞，都必须有相应的测试结果作为证据。

没有执行证据的判断，只能被标记为待验证假设。

---

## 2. 项目目标

项目同时服务于三个目标，但必须区分各自的交付要求。

| 方向 | 目标 | 交付物 |
|---|---|---|
| 竞赛 | 开发符合 AGH 规范的可运行 Agent | V0.1 MVP |
| 科研 | 验证状态转移表示对逻辑漏洞发现的贡献 | 实验平台与论文 |
| 创业 | 构建自动化智能合约安全产品 | SENTINEL Engine |

### 优先级

```text
P0：符合竞赛规则
 ↓
P1：完成可靠的端到端漏洞验证
 ↓
P2：形成初步科研实验能力
 ↓
P3：增强用户体验与展示效果
 ↓
P4：商业化功能
```

**绝对不能为了开发商业功能而牺牲竞赛交付。**

---

## 3. 竞赛 MVP 功能范围

### M1：Contract Analyzer

功能：

- 读取本地 Solidity 项目。
- 检查项目结构。
- 识别合约、函数、状态变量。
- 提取关键状态修改位置。
- 识别访问控制和资金操作相关逻辑。

输出：

`contract_analysis.json`

验收标准：

能够正确识别至少三个测试合约的主要函数、状态变量和状态修改关系。

### M2：State Transition Analyzer

功能：

分析合约执行前后的状态变化。

采用以下抽象：

\[
S_{t+1}=T(S_t,A_t)
\]

其中：

- \(S_t\)：执行前的合约状态。
- \(A_t\)：交易操作及参数。
- \(T\)：状态转移函数。
- \(S_{t+1}\)：执行后的状态。

MVP 阶段使用：

**规则提取 + Agnes 语义分析 + JSON 状态关系表示。**

不要求立即训练神经网络。

输出：

`state_transitions.json`

验收标准：

对预先设计的合约样例，能够提取关键状态转移以及潜在的不变量约束。

### M3：Vulnerability Reasoner

功能：

根据状态变化和业务约束生成漏洞假设。

第一版只研究三个类别：

1. 权限与角色状态错误。
2. 奖励、余额或份额记账错误。
3. 多交易序列导致的业务不变量破坏。

不需要支持所有 SWC 漏洞类型。

输出：

`hypotheses.json`

每条假设至少包含：

```json
{
  "id": "HYP-001",
  "category": "accounting_invariant_violation",
  "contract": "ExampleVault",
  "function": "withdraw",
  "description": "Potential accounting inconsistency",
  "preconditions": [],
  "expected_invariant": "Recorded liabilities must match obligations",
  "confidence": "unverified"
}
```

### M4：Foundry Verification

这是整个项目最关键的模块。

功能：

- 根据漏洞假设生成 Foundry 测试。
- 在本地授权测试项目中执行。
- 捕获编译结果。
- 捕获测试输出。
- 判断测试是否成功证明违反了相关不变量。
- 将测试执行证据关联到原始假设。

**注意：测试通过不等于发现漏洞。**

必须区分：

- 编译成功。
- 测试运行成功。
- 测试正确触发了预期行为。
- 测试证明业务不变量被违反。

输出：

`verification_result.json`

### M5：Feedback Engine

当测试执行失败时，系统需要判断原因：

```text
Compilation Error
        │
        ▼
修复生成代码
        │
        ▼
重新执行
```

```text
Test Passed
     │
     ▼
检查测试断言
     │
     ▼
确认是否构成漏洞证据
```

```text
Test Failed
     │
     ▼
区分执行错误与假设不成立
     │
     ▼
修正或放弃假设
```

每条假设默认最多进行两轮修复，避免进入无限循环。

### M6：Evidence Reporter

生成以下文件：

```text
reports/
├── analysis.json
├── hypotheses.json
├── verification.json
├── findings.md
└── execution_trace.json
```

报告至少说明：

- 涉及的合约和函数。
- 违反的业务约束。
- 触发条件。
- 测试方法。
- 测试结果。
- 证据文件。
- 是否已完成验证。

---

## 4. 系统技术架构

建议使用：

| 组件 | 方案 |
|---|---|
| Agent Runtime | Agnes Harness |
| LLM | Agnes 模型 |
| 智能体扩展 | AGH Plugin / MCP |
| 合约工具链 | Foundry |
| 合约语言 | Solidity |
| 分析服务 | Python 3.11+ |
| 数据交换 | JSON |
| 报告 | Markdown / JSON |
| 前端 | 优先使用 AGH 原生工作台 |
| 测试 | pytest + forge test |
| 版本管理 | Git |

具体版本以环境兼容性测试结果为准。

### 项目结构

建议 Work 初始化以下结构：

```text
sentinel/
│
├── README.md
├── LICENSE
├── pyproject.toml
├── .gitignore
├── .env.example
│
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── DEVELOPMENT_PLAN.md
│   ├── RESEARCH_PLAN.md
│   ├── SUBMISSION_CHECKLIST.md
│   └── DECISIONS.md
│
├── agent/
│   ├── prompts/
│   ├── workflows/
│   └── skills/
│
├── integrations/
│   └── agh/
│
├── sentinel/
│   ├── analyzer/
│   ├── state/
│   ├── reasoning/
│   ├── verification/
│   ├── feedback/
│   ├── reporting/
│   └── schemas/
│
├── contracts/
│   └── fixtures/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── experiments/
│   ├── datasets/
│   ├── baselines/
│   └── results/
│
├── reports/
│
└── scripts/
```

注意：这只是初始架构建议，Work 应先检查 AGH 的实际插件机制，再决定 `integrations/agh/` 的具体结构。

---

## 5. 核心科研创新

后续论文建议使用题目：

**State-Aware Agentic Vulnerability Discovery for Smart Contracts via Execution-Guided Verification**

中文：

《基于状态感知与执行反馈的智能合约逻辑漏洞自主发现方法》

重点研究三个问题：

**RQ1：状态转移表示是否能够提升复杂逻辑漏洞发现能力？**

**RQ2：执行反馈是否能够提高 Agent 的推理与测试效率？**

**RQ3：状态引导的测试生成是否能够减少漏洞发现所需的计算预算？**

### 实验设计

至少安排四种方法：

| 方法 | 状态表示 | 执行反馈 |
|---|---|---|
| Baseline A | 无 | 无 |
| Baseline B | 无 | 有 |
| SENTINEL-A | 有 | 无 |
| SENTINEL-Full | 有 | 有 |

使用相同模型、测试预算和样本集比较。

核心指标：

- 已验证漏洞发现率。
- 误报率。
- 状态覆盖率。
- 首次发现漏洞的时间。
- Token 使用量。
- 测试执行次数。

论文阶段再考虑图结构编码、表示学习、神经状态预测等方法。

**竞赛阶段不训练模型，不把尚未验证的科研创新写成既定成果。**

---

## 6. 七天开发排期

由于只有一名开发者，建议把每天任务严格限定。

| 日期 | 任务 | 完成标准 |
|---|---|---|
| 10.08 | AGH 环境、项目骨架、Foundry 验证 | 实现最小工具调用 |
| 10.09 | 合约解析与状态提取 | 输出有效 JSON |
| 10.10 | 漏洞假设生成 | 至少一个有效案例 |
| 10.11 | Foundry 自动验证 | 端到端执行成功 |
| 10.12 | 反馈修正与报告 | 完整闭环 |
| 10.13 | 测试及初步实验 | 三类样例与对比结果 |
| 10.14 | 视频、文档、提交材料 | 交付包完整 |
| 10.15 | 最终检查与提交 | 12:00 前完成 |

**10 月 10 日中午前还必须完成赛事报名。**

### 降级原则

如果开发时间不足：

首先取消独立前端。

其次取消复杂的跨合约分析。

再次取消多种漏洞类型支持。

最后减少非必要的可视化。

但始终保留：

**AGH → 状态分析 → 假设生成 → Foundry 验证 → 反馈 → 报告。**

---

## 7. 竞赛验收标准

项目只有满足下列条件，才可以认定为 V0.1 完成。

| 验收项 | 标准 |
|---|---|
| AGH 集成 | 真实通过 AGH 完成连续任务 |
| 模型合规 | 全部模型调用符合赛事限制 |
| 智能体执行 | 至少三个连续步骤 |
| 状态分析 | 生成可检查的状态关系 |
| 漏洞推理 | 生成具有具体触发条件的假设 |
| 测试验证 | Foundry 成功执行 |
| 执行反馈 | 至少展示一次反馈处理 |
| 安全证据 | 验证结果与测试日志对应 |
| 正常样例 | 正确处理无漏洞合约 |
| 边界样例 | 正确处理复杂输入或边界状态 |
| 失败样例 | 能处理编译或测试失败 |
| 演示材料 | 3–5 分钟视频 |
| 运行记录 | 完整 AGH 调用证据 |
| 可复现性 | 根据 README 可重新运行 |

所有合约测试均应限制在本地授权测试环境中。禁止将真实资金操作或未经授权的链上攻击行为作为演示流程。

