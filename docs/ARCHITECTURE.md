# 架构与信任边界

状态（2026-10-12）：**真实 Agnes 模型已在隔离 AGH 会话中完成 Counter、ShareVault、边界/失败三类固定样例调用，另有 OpenZeppelin Multicall 公开历史问题对照；ShareVault 初轮推理错误，经明确反馈修正，报告仅覆盖人工已知夹具。** 本地模拟 provider 的早期工具链证据单独保留。接口来源和证据见[官方核查](OFFICIAL_RESEARCH.md)。

```text
用户给定的授权样例
    ↓
官方 AGH + 合规 Agnes 模型（真实链路已验证）
    ↓ 合约要点 → 状态转移 → 漏洞假设
    ↓ 官方 stdio MCP 接口（实测选定）
一个固定用途的 Foundry MCP server（四个固定动作）
    ↓ Counter 基线 / ShareVault 状态不变量 / 边界与测试失败样例 / OpenZeppelin Multicall 原版与修复版；固定命令、哈希白名单、超时/资源/离线限制
forge test → 真实结果和日志
    ↓
AGH 记录模型反馈；人工核对状态表与实际测试，再形成有证据的结论
```

## 最小模块

- **AGH 任务**：保存官方执行轨迹。不得替换成自行编写的 Agent 循环。
- **Foundry 适配器**：只接受四个无参数测试动作，映射到固定的测试文件和固定参数；不接受模型生成的 Shell 命令、路径、源码或测试参数。
- **证据目录**：保存工具调用、退出码、标准输出、AGH 轨迹和模型调用标识；禁止保存密钥。

计划书的 M1–M6 在竞赛 P0 中是一条 AGH 流程的六个可检查结果，不要求六个独立服务或 Python 包。[五个报告文件](../reports/findings.md)已按约定生成：`analysis.json` 承载 M1/M2，`hypotheses.json` 承载 M3，`verification.json` 承载 M4/M5，`findings.md` 与 `execution_trace.json` 承载 M6。它们是依据真实轨迹人工复核的摘要，保留初轮错误与纠错，不伪称模型一次生成的正确答案。字段边界见[决策 D-014](DECISIONS.md)。

## 执行控制

已验证工具是一个无参数本地 stdio MCP server，AGH session 暴露 `sentinel_foundry_counter_test`、`sentinel_foundry_share_vault_test` 与 `sentinel_foundry_cases_test` 与 `sentinel_foundry_oz_test`。独立真实入口每次使用唯一 `sessionKey`；调用前通过精确工具名及空参数条件取得一次性许可，其他权限请求拒绝。复用持久 MCP 服务前核对其执行相关定义字段。服务按工具复制经 SHA-256 固定的 runner、配置和 Solidity 文件到项目 `.deps/tmp/` 临时夹具，使用固定 argv 启动 bubblewrap；Foundry 子进程只能写 `/work` 临时夹具，宿主根目录只读，网络与 PID namespace 隔离，并受 30 秒、4 GiB 地址空间、20 秒 CPU 和 64 进程限制。执行 `forge test --offline --threads 1`，Foundry 配置关闭 FFI。Foundry 子进程限制已由 AGH 工具结果实测；MCP server Node 进程本身不在同一 bubblewrap 内，按仓库内固定可信工具代码管理。工具启动/编译故障与 Solidity 断言结果分开记录。

`proof/foundry` 包含无漏洞 Counter 基线、一个本地故意含缺陷的 ShareVault 夹具，以及独立的边界/失败夹具。Counter 的 `testIncrement` 为 1/1 通过；ShareVault 的量化复现断言通过、两条指定不变量断言失败并被分类为 `expected_invariant_violations_observed`；零值存款边界断言通过；独立 harness 断言按预期失败并被分类为 `expected_fixture_test_failure_no_finding`。三类均由真实 Agnes 模型经 AGH 复跑并解释；OpenZeppelin Multicall 的第四个固定工具也完成真实模型对照复现，见[实测报告](../reports/openzeppelin_multicall.md)；ShareVault 模型推理先错后改，完整记录见[真实轨迹](../evidence/agh-agnes-real-sharevault-corrected-session.jsonl)。边界/失败轨迹见[真实 cases 记录](../evidence/agh-agnes-real-cases-session.jsonl)，历史模拟证据仍在 `evidence/agh-foundry-t08-simulated.*`。

## 发展路径

竞赛版只保留一个 AGH 任务、一个 MCP server 和一个授权漏洞样例，另提供正常、边界、失败三类验收输入。之后科研平台可在相同输入/输出契约上加入固定数据集、基线和重复实验；SRCA 集成通过版本化报告接口另行设计，不进入竞赛关键路径。
