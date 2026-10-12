# 从空目录重建 SENTINEL 本地验证环境

适用范围：Linux x86_64；本项目实测为 Node 26.2.0、Foundry 1.7.1、solc-js 0.8.36。需要预先安装 Node.js ≥24.10、npm、Git、curl、tar，以及 `/usr/bin/bwrap`、`/usr/bin/prlimit`、`/usr/bin/timeout` 和 Bash。Linux 必须允许 bubblewrap 创建 user、network 与 PID namespace。本页所有**下载文件和包缓存**都落在项目 `.deps/`；不包含赛事 Key。

官方依据：[AGH 源码安装指南](https://github.com/AgnesAI-Labs/agnes-harness/blob/main/docs/guide/install.md)、[Foundry v1.7.1 发布页](https://github.com/foundry-rs/foundry/releases/tag/v1.7.1)。AGH 接口仍以本项目固定提交为准；若该提交无法从官方仓库取到，立即停下并记录，不以其他 Agent 运行时替代。

## 1. 在项目内安装 AGH

从 SENTINEL 根目录运行，先确认 `.deps/agnes-harness` 不存在：

```bash
set -euo pipefail
SENTINEL_ROOT="$PWD"
mkdir -p "$SENTINEL_ROOT/.deps/bootstrap" "$SENTINEL_ROOT/.deps/npm-cache" \
  "$SENTINEL_ROOT/.deps/pnpm-store" "$SENTINEL_ROOT/.deps/cache" \
  "$SENTINEL_ROOT/.deps/node-gyp" "$SENTINEL_ROOT/.deps/tmp"
export npm_config_cache="$SENTINEL_ROOT/.deps/npm-cache"
export npm_config_devdir="$SENTINEL_ROOT/.deps/node-gyp"
export XDG_CACHE_HOME="$SENTINEL_ROOT/.deps/cache"
npm install --prefix "$SENTINEL_ROOT/.deps/bootstrap" --no-audit --no-fund --save-exact pnpm@10.34.5
export PATH="$SENTINEL_ROOT/.deps/bootstrap/node_modules/.bin:$PATH"
git clone https://github.com/AgnesAI-Labs/agnes-harness.git "$SENTINEL_ROOT/.deps/agnes-harness"
git -C "$SENTINEL_ROOT/.deps/agnes-harness" checkout --detach cde816b88c737b9fd04e7ef55b899e7b4cd55eb7
test "$(git -C "$SENTINEL_ROOT/.deps/agnes-harness" rev-parse HEAD)" = cde816b88c737b9fd04e7ef55b899e7b4cd55eb7
cd "$SENTINEL_ROOT/.deps/agnes-harness"
pnpm install --frozen-lockfile --store-dir "$SENTINEL_ROOT/.deps/pnpm-store"
pnpm --filter @agnes/cli build:local --output-dir "$SENTINEL_ROOT/.deps/agh-runtime"
cd "$SENTINEL_ROOT"
node .deps/agh-runtime/agnes.mjs --version
```

当前本机 `.deps/agnes-harness` 无 `.git` 元数据，但其非忽略文件的 Git 树哈希与官方固定提交的树哈希 `1bc3b25df5d0a423f9e982e64608e075529aa6fe` 一致，见来源核验记录（见赛事提交包）。这不检查被忽略的 `node_modules` 和构建输出；干净重建时仍须通过上面的 Git 提交校验。

## 2. 在项目内安装离线 Solidity 工具

本项目固定工具路径为 `.deps/tools/foundry/forge` 和 `.deps/tools/solcjs/node_modules/.bin/solcjs`。以下只适用于 Linux x86_64：

```bash
mkdir -p "$SENTINEL_ROOT/.deps/downloads" "$SENTINEL_ROOT/.deps/tools/foundry" \
  "$SENTINEL_ROOT/.deps/tools/solcjs"
curl -fL --retry 3 \
  -o "$SENTINEL_ROOT/.deps/downloads/foundry_v1.7.1_linux_amd64.tar.gz" \
  https://github.com/foundry-rs/foundry/releases/download/v1.7.1/foundry_v1.7.1_linux_amd64.tar.gz
printf '%s  %s\n' 'cf7e688ed0c4c48adffca788b496076e31060b67ac5afe1e43dbb5499c20c88b' \
  "$SENTINEL_ROOT/.deps/downloads/foundry_v1.7.1_linux_amd64.tar.gz" | sha256sum --check -
tar -xzf "$SENTINEL_ROOT/.deps/downloads/foundry_v1.7.1_linux_amd64.tar.gz" \
  -C "$SENTINEL_ROOT/.deps/tools/foundry" forge
"$SENTINEL_ROOT/.deps/tools/foundry/forge" --version
sha256sum "$SENTINEL_ROOT/.deps/tools/foundry/forge"
npm install --prefix "$SENTINEL_ROOT/.deps/tools/solcjs" \
  --no-audit --no-fund --save-exact solc@0.8.36
"$SENTINEL_ROOT/.deps/tools/solcjs/node_modules/.bin/solcjs" --version
```

归档 SHA-256 已与[官方 GitHub Release API](https://api.github.com/repos/foundry-rs/foundry/releases/tags/v1.7.1) 的资产摘要核对。当前本机 Forge 二进制 SHA-256 是 `4f77da0810de94325734855d0ad58d70640aa8a5b2a837608ddf8c26da34355c`，版本输出为 `1.7.1`、commit `4072e48705af9d93e3c0f6e29e93b5e9a40caed8`。后者是本机参考指纹；solc-js 版本应为 `0.8.36`。

本机原有的 Foundry 发布归档在一次失败的恢复下载后被误删，当前保有经核对的 Forge 二进制和官方归档摘要。官方归档 URL 于 2026-10-11 连接超时，所以上面的 Foundry 下载步骤仍未完整验收；不得把本机既有二进制当作空目录安装验收。

2026-10-11 已在项目内新目录从固定 AGH 源码归档重建：源码 Git 树与官方提交相同；上面的 npm 命令安装 pnpm 10.34.5，47 个 workspace 的依赖通过项目 pnpm 缓存离线安装（467 个包，0 下载），并用 `pnpm --filter @agnes/cli build:local` 构建出 Node 26.2.0 独立运行时。该源码的另一份独立构建已在全新 `AGH_HOME` 得到空会话列表后正常停止。solc-js 0.8.36 也从项目 npm 缓存独立离线安装。见重建记录（见赛事提交包）。此验证使用官方提交归档和既有项目缓存，尚不能证明新机器 Git clone、联网下载依赖或 Foundry 归档获取成功。

## 3. 验证

无需赛事 Key，先运行 AGH 官方本地 provider fixture 的模拟链路：

```bash
./.deps/agnes-harness/node_modules/.bin/tsx proof/agh-foundry-smoke.mjs
```

模拟结果仅证明本机 AGH→MCP→Foundry 工具链。本公开仓库不含历史会话与日志；取得赛事提交的证据 ZIP 并将其中 `evidence/`、`reports/` 放回仓库后，才可运行 `node proof/test-evidence-safety.mjs` 与 `node proof/check-technical-readiness.mjs` 离线复核既有轨迹。要复跑真实 Agnes 模型，必须先用赛事 Key 完成 `proof/agh-agnes-real-probe.mjs` 的 `config.test/save`；Key 只从标准输入传入，AGH 私有 home 位于被忽略的 `.deps/agh-real-home`。不要把 Key 写入脚本、公开日志或提交包。真实复跑命令见 [README](../README.md)。OpenZeppelin 历史对照使用包内保留 MIT 许可证和 SHA-256 固定的官方 v4.9.4/v4.9.5 源码，命令为 `./.deps/agnes-harness/node_modules/.bin/tsx proof/agh-agnes-real-counter.mjs openzeppelin`；详细证据见实测报告（见赛事提交包）。
