# SENTINEL

SENTINEL 是基于状态转移推理与可验证执行的智能合约逻辑漏洞分析 Agent。竞赛 MVP 使用官方 Agnes Harness（AGH）和赛事 Agnes 模型，经受限 MCP 工具调用本地离线 Foundry 测试。

[公开项目介绍](PROJECT_POST.md)说明两个固定样例、模型反馈调整和结论边界。本仓库提供源码、固定测试与[安装复现说明](docs/INSTALL.md)；完整脱敏 AGH 轨迹和运行日志作为赛事提交证据单独提供，仓库不包含赛事 Key、私有 AGH home 或本机原始日志。

## 已完成的本地验证

- Counter 正常样例：Foundry 1/1 通过。
- 人工已知缺陷的 ShareVault：复现断言通过，两条预设不变量断言按预期失败；模型首轮算错 Bob 的提现额，经明确反馈后修正为 0.5 ETH。
- OpenZeppelin Contracts v4.9.4/v4.9.5 的已公开 Multicall 历史问题：固定对照测试为 2 PASS、1 个预设不变量 FAIL；模型预测计数正确，但误判整个套件会通过，收到工具结果后承认错误。

这些结果来自固定、本地授权的离线样例，不代表发现未知漏洞，也不是链上部署审计。完整运行证据须与赛事提交的证据 ZIP 对照；只下载本仓库不能复核既有 AGH 会话轨迹。

## 复现入口

按[安装说明](docs/INSTALL.md)在项目内准备 AGH、Foundry、solc-js 和 bubblewrap。无需模型 Key 的固定 Foundry 测试入口在 `proof/run-*.sh`；AGH 本地 provider 模拟链路在 `proof/agh-foundry-smoke.mjs`。真实模型入口在 `proof/agh-agnes-real-*.mjs`，需参赛者自行配置合规 Agnes Key。

工作原理和验收范围见[架构](docs/ARCHITECTURE.md)、[需求](docs/PRD.md)与[研究计划](docs/RESEARCH_PLAN.md)。本机已验证技术链路；异机联网完整安装仍待验证。

本仓库只用于本地授权合约与离线测试。请勿上传密钥，或运行未经审查的生成代码与任意 Shell 命令。
