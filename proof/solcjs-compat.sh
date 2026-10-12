#!/usr/bin/bash
set -euo pipefail

solcjs=${SENTINEL_SOLCJS:?Set SENTINEL_SOLCJS to the reviewed local solc-js binary}
args=()
skip_value=0
standard_json=0
for arg in "$@"; do
  if ((skip_value)); then
    skip_value=0
    continue
  fi
  case "$arg" in
    --allow-paths) skip_value=1 ;;
    --allow-paths=*) ;;
    --standard-json) standard_json=1; args+=("$arg") ;;
    *) args+=("$arg") ;;
  esac
done
((skip_value == 0)) || exit 2
if ((standard_json)); then
  set -o pipefail
  input_file=$(/usr/bin/mktemp "${TMPDIR:-/tmp}/sentinel-solc-XXXXXX")
  output_file=$(/usr/bin/mktemp "${TMPDIR:-/tmp}/sentinel-solc-XXXXXX")
  trap '/usr/bin/rm -f -- "$input_file" "$output_file"' EXIT
  /usr/bin/cat > "$input_file"
  "$solcjs" "${args[@]}" < "$input_file" > "$output_file"
  /usr/bin/sed '/^>>> Cannot retry compilation with SMT because there are no SMT solvers available\.$/d' "$output_file"
  exit
fi
exec "$solcjs" "${args[@]}"
