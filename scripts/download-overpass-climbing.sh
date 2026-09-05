#!/usr/bin/env bash
# Download climbing-tagged OSM objects (plus their referenced geometry) from
# Overpass and write a PBF suitable for scripts/build-climbing-tiles.sh.
#
# By default one global tag-index query is used. For a quick smoke test:
#   scripts/download-overpass-climbing.sh \
#     --bbox 46.38,8.82,46.48,8.90 \
#     --output data/overpass-test.osm.pbf
#
# Full-world download:
#   scripts/download-overpass-climbing.sh
#   bash scripts/build-climbing-tiles.sh data/overpass-climbing.osm.pbf
#
# BBOX order is south,west,north,east (Overpass convention).
# Requires: curl, osmium
set -euo pipefail

ENDPOINT="${OVERPASS_ENDPOINT:-https://overpass-api.de/api/interpreter}"
OUTPUT="data/overpass-climbing.osm.pbf"
BBOX=""
KEEP_PARTS=false
MAX_ATTEMPTS=5

usage() {
  cat <<'EOF'
Usage: scripts/download-overpass-climbing.sh [options]

Options:
  --bbox S,W,N,E       Download one bounding box instead of the whole world
  --output FILE        Output PBF (default: data/overpass-climbing.osm.pbf)
  --endpoint URL       Overpass interpreter endpoint
  --attempts N         Attempts per request (default: 5)
  --keep-parts         Keep the temporary XML and PBF parts
  -h, --help           Show this help

Environment:
  OVERPASS_ENDPOINT    Alternative to --endpoint
EOF
}

while (( $# )); do
  case "$1" in
    --bbox)
      [[ $# -ge 2 ]] || { echo "Missing value for --bbox" >&2; exit 2; }
      BBOX="$2"; shift 2 ;;
    --output)
      [[ $# -ge 2 ]] || { echo "Missing value for --output" >&2; exit 2; }
      OUTPUT="$2"; shift 2 ;;
    --endpoint)
      [[ $# -ge 2 ]] || { echo "Missing value for --endpoint" >&2; exit 2; }
      ENDPOINT="$2"; shift 2 ;;
    --attempts)
      [[ $# -ge 2 ]] || { echo "Missing value for --attempts" >&2; exit 2; }
      MAX_ATTEMPTS="$2"; shift 2 ;;
    --keep-parts) KEEP_PARTS=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

for command in curl osmium; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Error: $command is required" >&2
    exit 1
  }
done
[[ "$MAX_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || {
  echo "Error: --attempts must be a positive integer" >&2
  exit 2
}

# A global key lookup uses Overpass's tag index and is much cheaper than huge
# bounding-box scans. A bbox is retained for quick local tests.
if [[ -n "$BBOX" ]]; then
  BBOXES=("$BBOX")
else
  BBOXES=("")
fi

mkdir -p "$(dirname "$OUTPUT")"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/openbouldermap-overpass.XXXXXX")"
cleanup() {
  if [[ "$KEEP_PARTS" == true ]]; then
    echo "Temporary parts kept at: $WORK_DIR"
  else
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT INT TERM

PARTS=()
TOTAL=${#BBOXES[@]}
for INDEX in "${!BBOXES[@]}"; do
  BOX="${BBOXES[$INDEX]}"
  NUMBER=$((INDEX + 1))
  XML="$WORK_DIR/part-$NUMBER.osm"
  PBF="$WORK_DIR/part-$NUMBER.osm.pbf"
  QUERY="$WORK_DIR/query-$NUMBER.overpassql"

  if [[ -n "$BOX" ]]; then
    SCOPE="($BOX)"
    LABEL="bbox $BOX"
  else
    SCOPE=""
    LABEL="the global climbing tag index"
  fi

  cat >"$QUERY" <<EOF
[out:xml][timeout:1800][maxsize:1073741824];
nwr["climbing"]$SCOPE;
(._;>;);
out meta;
EOF

  echo "==> [$NUMBER/$TOTAL] Querying $LABEL"
  SUCCESS=false
  for ATTEMPT in $(seq 1 "$MAX_ATTEMPTS"); do
    rm -f "$XML"
    HTTP_CODE="$(curl -sS -L \
      --connect-timeout 30 --max-time 1900 \
      --retry 2 --retry-all-errors --retry-delay 10 \
      -o "$XML" -w '%{http_code}' \
      --data-urlencode "data@$QUERY" "$ENDPOINT" || true)"

    # Overpass often reports query failures as HTTP 200 XML containing <remark>.
    if [[ "$HTTP_CODE" =~ ^2[0-9][0-9]$ ]] \
      && [[ -s "$XML" ]] \
      && ! grep -q '<remark' "$XML" \
      && osmium fileinfo "$XML" >/dev/null 2>&1; then
      OBJECTS="$(osmium fileinfo -e "$XML" \
        | awk '/Number of (nodes|ways|relations):/ { total += $NF } END { print total + 0 }')"
      if (( OBJECTS > 0 )); then
        SUCCESS=true
        break
      fi
      echo "    Query returned no OSM objects; check the bbox." >&2
      break
    fi

    echo "    Attempt $ATTEMPT/$MAX_ATTEMPTS failed (HTTP ${HTTP_CODE:-none})." >&2
    if [[ -f "$XML" ]] && grep -o '<remark[^>]*>.*</remark>' "$XML" >&2; then
      :
    fi
    (( ATTEMPT < MAX_ATTEMPTS )) && sleep $((ATTEMPT * 20))
  done

  [[ "$SUCCESS" == true ]] || {
    echo "Error: Overpass query failed for bbox $BOX after $MAX_ATTEMPTS attempts" >&2
    exit 1
  }

  osmium cat "$XML" -o "$PBF" --overwrite
  PARTS+=("$PBF")
  echo "    Received $(du -h "$PBF" | cut -f1)"
done

# Keep a .pbf suffix so osmium can infer the temporary file's format.
TEMP_OUTPUT="$OUTPUT.tmp.pbf"
rm -f "$TEMP_OUTPUT"
if (( ${#PARTS[@]} == 1 )); then
  cp "${PARTS[0]}" "$TEMP_OUTPUT"
else
  echo "==> Merging ${#PARTS[@]} parts"
  osmium merge "${PARTS[@]}" -o "$TEMP_OUTPUT" --overwrite
fi

# Validate before replacing an existing successful download.
osmium fileinfo "$TEMP_OUTPUT" >/dev/null
mv "$TEMP_OUTPUT" "$OUTPUT"
echo "==> Done: $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
