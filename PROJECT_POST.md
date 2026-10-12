# SENTINEL：让智能合约状态推理接受本地执行验证

发布日期：2026-10-13。发布平台：GitHub。

我们完成了 SENTINEL 的本地竞赛原型。赛事 Agnes `agnes-3.0-flash` 模型在官方 Agnes Harness（AGH）中分析 Solidity 合约的状态变量、操作顺序和业务不变量，再调用经过审查的无参数 MCP 工具运行离线 Foundry 测试。AGH 保存任务输入、模型预测、工具调用、实际结果和反馈调整，供人工复核。

第一个样例是本地人工已知缺陷的 ShareVault：Alice、Bob 各存入 1 ETH 后依次提现，Bob 实际只取回 0.5 ETH。复现断言通过，两条预设的不变量断言失败。模型首次把 Bob 的取回额算错，在明确反馈后才修正；这条错误和纠错都保存在同一 AGH 会话中。

第二个样例使用 OpenZeppelin Contracts v4.9.4/v4.9.5 的官方公开源码，在本地对照其[已公开的 Multicall 历史问题](https://github.com/OpenZeppelin/openzeppelin-contracts/security/advisories/GHSA-699g-q6qh-q4v8)：旧版一个子调用执行两次，修复版执行一次。固定测试得到 2 PASS、1 个预设不变量 FAIL。模型预测计数值正确，但误判整个测试套件会通过；收到 Foundry 结果后承认这一错误。第三方源码保留 MIT 许可。

目前的结论限于这些固定、本地授权的离线样例；项目没有审计线上部署，也不宣称发现未知漏洞或测得泛化准确率。仓库提供[复现说明](docs/INSTALL.md)与[固定测试](proof/foundry/test/ShareVault.t.sol)；完整脱敏 AGH 轨迹、Foundry 结果与人工复核报告作为赛事提交证据单独提供。
