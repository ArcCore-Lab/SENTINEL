# SENTINEL

SENTINEL 是面向智能合约逻辑漏洞的状态转移推理与可验证执行 Agent。当前优先目标是参加 2026 江苏省 AI+科学与工程创新实践黑客松；科研实验平台和 SRCA Web3 模块为后续方向。

项目愿景和完整模块目标见用户提供的[开发计划书](pdplan.md)。竞赛截止前的执行范围与验收以 [PRD](docs/PRD.md) 和 [任务清单](docs/TASKS.md) 为准。

[公开项目介绍](PROJECT_POST.md)概述已验证的运行链路、测试结果和能力边界。

**当前状态（2026-10-13）：技术作品和实机演示视频已达到本地提交材料验收门槛。** 真实赛事 Agnes 模型经官方 AGH 调用固定 MCP 工具和离线 Foundry：Counter 1/1 通过；ShareVault 已知缺陷夹具的复现断言通过、两条不变量断言按预期失败；零值存款边界测试通过，刻意失败测试被判为“无漏洞发现”。ShareVault 模型首轮状态推理有误，经明确反馈后修正，不能称为独立漏洞发现。另以 OpenZeppelin Contracts v4.9.4/v4.9.5 原版源码完成已公开 Multicall 历史问题的真实模型与 Foundry 对照复现，见[报告](reports/openzeppelin_multicall.md)；它不是新漏洞或链上部署审计。三类真实链路见 [Counter 日志](evidence/agh-agnes-real-counter.log)、[ShareVault 日志](evidence/agh-agnes-real-sharevault.log)、[边界/失败日志](evidence/agh-agnes-real-cases.log)；[技术验收记录](evidence/technical-readiness.log)与[报告](reports/findings.md)给出证据边界。

## 模型验收状态

赛事邮件提供的 Key 已通过官方 AGH `config.test/save` 配置于项目忽略目录 `.deps/agh-real-home`（权限 0700），实际账号目录返回 `agnes-3.0-flash`，route 为 `agnes-ai`。真实模型调用、工具执行与反馈见[脱敏 AGH 轨迹](evidence/agh-agnes-real-sharevault-corrected-session.jsonl)。当前轨迹来自独立会话和中性 MCP 工具描述，仍包含首轮错误和显式纠错；提示也已说明这是人工已知缺陷夹具，不可作为自主发现证据。历史 [fixture 记录](evidence/agh-foundry-t08-simulated-session.jsonl)仅证明工具链。

## 最小技术验证

空目录重建步骤见[本地安装说明](docs/INSTALL.md)。在具备 `.deps/` 本地依赖时，可复跑：

```bash
./.deps/agnes-harness/node_modules/.bin/tsx proof/agh-foundry-smoke.mjs
```

该脚本使用隔离 `AGH_HOME` 和 AGH 官方本地 provider fixture；它不调用真实模型。在当前机器的私有赛事 Key 已配置、赛事网络可用时，真实模型的固定样例可分别复跑：

```bash
./.deps/agnes-harness/node_modules/.bin/tsx proof/agh-agnes-real-counter.mjs
./.deps/agnes-harness/node_modules/.bin/tsx proof/agh-agnes-real-counter.mjs cases
./.deps/agnes-harness/node_modules/.bin/tsx proof/agh-agnes-real-sharevault.mjs
```

演示 AGH 的完整启动、运行与结束时，在 daemon 原先未运行且赛事 Key 已配置的本机执行 `node proof/record-agh-counter-lifecycle.mjs`。它显式启动官方 AGH、运行上述固定 Counter 工具链、确认 daemon 已停止，并把同一次运行的时间与状态写入 `evidence/agh-counter-lifecycle.log`。这会发起真实 Agnes 请求并更新 Counter 证据；提交前须重建证据包和校验记录。若已有 AGH daemon 正在运行，脚本会拒绝打断它。

提交视频使用 `bash proof/run-native-demo.sh` 在本机全屏终端录制。脚本先查阅已保存的 ShareVault 脱敏会话，随后调用上述生命周期入口发起新 Counter 会话；它不会重跑 ShareVault。实际录屏与证据见 `submission/本科生组-U312-防反鸟最强！-冯钰皓/`。

`proof/agh-agnes-correct-sharevault.mjs` 只用于最新 ShareVault 回合确实推理错误后的明确纠错，不应在新运行中无条件执行。三个独立真实入口每次创建唯一 AGH 会话；纠错入口只加载对应 ShareVault 会话并核对源事件。模型可能不按提示调用工具，此时脚本失败且不覆盖既有通过证据；当前 ShareVault 报告来自随后通过的新隔离回合及其明确纠错。该真实运行脚本的 `PASS_TOOLCHAIN_ONLY` 只验收工具链。MCP 只开放预审的无参数固定工具；复用服务时核对执行相关定义字段，并校验夹具 SHA-256。Foundry 子进程使用 bubblewrap（宿主根目录只读、仅临时 `/work` 可写、网络与 PID namespace 隔离）、固定命令、30 秒超时和 CPU/地址空间/进程上限。MCP server 本身由本地 AGH 进程启动，按固定可信仓库代码管理；Foundry 子进程才由 bubblewrap 隔离。

边界/失败样例由同一固定脚本的 `cases` 模式运行；真实开源库对照可运行 `./.deps/agnes-harness/node_modules/.bin/tsx proof/agh-agnes-real-counter.mjs openzeppelin`，需已有赛事 Key、网络和受限 Foundry 环境。完成真实调用后，可离线核对所有公开证据：

```bash
node proof/check-technical-readiness.mjs
```

该检查不发起模型请求，只核对固定夹具的已保存轨迹、报告、同一运行关联和脱敏状态；移除私有 `.deps/` 的公开源码副本中也已运行通过。公开真实轨迹已裁剪到对应回合，原始完整 AGH 轨迹留在私有 home。它不能证明未知合约上的发现率，也不能代替新一轮模型推理复核。

直接运行 Foundry 的独立基线证据见 [受限测试](evidence/foundry-sandbox.log)和[清理环境测试](evidence/foundry-sanitized-env.log)。它们不能代替 AGH 集成证据。

## 文档

- [需求与验收](docs/PRD.md)
- [架构和执行边界](docs/ARCHITECTURE.md)
- [排期](docs/DEVELOPMENT_PLAN.md)
- [科研计划](docs/RESEARCH_PLAN.md)
- [提交清单](docs/SUBMISSION_CHECKLIST.md)
- [决策记录](docs/DECISIONS.md)
- [任务清单](docs/TASKS.md)
- [官方资料与技术验证](docs/OFFICIAL_RESEARCH.md)
- [项目内安装与重建](docs/INSTALL.md)
- [Ponytail 审查与修复记录](docs/PONYTAIL_AUDIT.md)
- [ShareVault 样例状态与不变量](docs/fixtures/SHARE_VAULT_CASE.md)
- [OpenZeppelin Multicall 历史问题实测](reports/openzeppelin_multicall.md)

本仓库仅允许在本地授权合约和离线测试环境中验证。竞赛运行只能使用赛事允许的 Agnes 模型；不得上传密钥、未经审查的合约或伪造执行证据。
