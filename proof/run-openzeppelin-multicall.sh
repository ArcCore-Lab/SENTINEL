#!/usr/bin/env bash
set -euo pipefail

proof_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/foundry" && pwd -P)
solc_bin=${SENTINEL_SOLC:?Set SENTINEL_SOLC to the reviewed local compiler adapter}
solcjs_bin=${SENTINEL_SOLCJS:?Set SENTINEL_SOLCJS to a reviewed local solc-js binary}
forge_bin=${SENTINEL_FORGE:-$(command -v forge)}
[[ "$solc_bin" = /* && -f "$solc_bin" && -x "$solc_bin" && "$solcjs_bin" = /* && -f "$solcjs_bin" && -x "$solcjs_bin" && "$forge_bin" = /* && -f "$forge_bin" && -x "$forge_bin" ]] || exit 2

cd "$proof_dir"
if [[ "${SENTINEL_IN_SANDBOX:-0}" == 1 ]]; then
  exec /usr/bin/prlimit --as=4294967296 --cpu=20 --nproc=64 -- \
    /usr/bin/timeout 30s "$forge_bin" test \
      --root "$proof_dir" --offline --use "$solc_bin" --threads 1 \
      --match-path test/OpenZeppelinMulticall.t.sol -vv
fi
exec /usr/bin/unshare --user --map-root-user --net --pid --fork -- \
  /usr/bin/prlimit --as=4294967296 --cpu=20 --nproc=64 -- \
  /usr/bin/timeout 30s "$forge_bin" test \
    --root "$proof_dir" --offline --use "$solc_bin" --threads 1 \
    --match-path test/OpenZeppelinMulticall.t.sol -vv
