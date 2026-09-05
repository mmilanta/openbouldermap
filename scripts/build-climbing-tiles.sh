#!/usr/bin/env bash
# Build tiles/climbing.pmtiles — a tiny PMTiles archive containing only
# bouldering features (boulders + routes + sectors), extracted from an OSM PBF.
#
# Usage:
#   bash scripts/build-climbing-tiles.sh [source ...]
#
#   Each source can be:
#     - A local .osm.pbf file (e.g. data/switzerland.osm.pbf)
#     - A URL (https://...) — downloaded temporarily, filtered, then deleted
#     - Omitted — uses data/switzerland.osm.pbf
#
# Multiple filtered extracts are merged before tile generation. This lets CI
# process Geofabrik's continent extracts one at a time without needing enough
# disk space for the ~95 GB planet file.
#
# Requires: osmium, java >= 17, planetiler.jar (at repo root)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

if (( $# )); then
  SOURCES=("$@")
else
  SOURCES=(data/switzerland.osm.pbf)
fi
FILTERED="data/climbing-filtered.osm.pbf"
OUTPUT="tiles/climbing.pmtiles"

# Tags to keep — only climbing-related keys. The schema only emits features that
# already carry a `climbing`/`climbing:boulder` tag, so keep just those keys.
# (Adding non-climbing keys like `natural`/`sport`/`site` bloats the filtered
# file ~1000x with objects planetiler discards anyway.)
FILTER_TAGS="climbing climbing:boulder climbing:grade:font climbing:start climbing:fa climbing:length"

# Check prerequisites
for cmd in osmium java; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Error: $cmd not found in PATH"; exit 1; }
done
[ -f planetiler.jar ] || { echo "Error: planetiler.jar not found at repo root"; exit 1; }

mkdir -p data tiles

PARTS=()
TEMP_INPUTS=()
cleanup() {
  rm -f "${PARTS[@]}" "${TEMP_INPUTS[@]}"
}
trap cleanup EXIT

for INDEX in "${!SOURCES[@]}"; do
  SOURCE="${SOURCES[$INDEX]}"
  INPUT="$SOURCE"
  PART="data/climbing-filtered-$INDEX.osm.pbf"
  PARTS+=("$PART")

  echo "==> Filtering climbing tags from: $SOURCE"
  if [[ "$SOURCE" == http://* || "$SOURCE" == https://* ]]; then
    command -v curl >/dev/null 2>&1 || { echo "Error: curl not found in PATH"; exit 1; }
    INPUT="data/osm-source-$INDEX.osm.pbf"
    TEMP_INPUTS+=("$INPUT")
    echo "     Downloading extract temporarily so osmium can make the passes needed to preserve referenced geometry ..."
    curl -fL --retry 5 --retry-all-errors -o "$INPUT" "$SOURCE"
  else
    [ -f "$INPUT" ] || { echo "Error: PBF not found at $INPUT"; exit 1; }
  fi

  ORIG_SIZE=$(du -h "$INPUT" | cut -f1)
  osmium tags-filter -o "$PART" --overwrite "$INPUT" $FILTER_TAGS
  echo "     Original: $ORIG_SIZE  →  Filtered: $(du -h "$PART" | cut -f1)"

  if [[ "$INPUT" != "$SOURCE" ]]; then
    rm -f "$INPUT"
  fi
done

if (( ${#PARTS[@]} == 1 )); then
  mv "${PARTS[0]}" "$FILTERED"
else
  echo "==> Merging ${#PARTS[@]} filtered extracts -> $FILTERED"
  osmium merge -o "$FILTERED" --overwrite "${PARTS[@]}"
  rm -f "${PARTS[@]}"
fi
trap - EXIT

echo "==> Extracting sector points from site relations -> data/sectors.geojson"
osmium cat -f opl "$FILTERED" | python3 scripts/extract-sectors.py

# Planetiler 0.10.2 crashes on an empty FeatureCollection. Add one harmless
# untagged point; it matches no schema layer and therefore emits no tile feature.
if ! python3 -c 'import json; raise SystemExit(not json.load(open("data/sectors.geojson"))["features"])'; then
  echo "==> No sector centroids found; adding a non-rendered GeoJSON placeholder"
  printf '%s\n' '{"type":"Feature","geometry":{"type":"Point","coordinates":[0,0]},"properties":{}}' > data/sectors.geojson
fi

echo "==> Running planetiler (climbing-only schema) -> $OUTPUT"
java -Xmx4g -jar planetiler.jar generate-custom \
  --schema=scripts/schema.yml \
  --minzoom=0 \
  --maxzoom=16 \
  --output="$OUTPUT" \
  --force

echo ""
echo "==> Done."
ls -lh "$OUTPUT"
echo ""
echo "Start the app with:  npm run dev"
echo "The basemap tiles come from OpenFreeMap (no local basemap tiles needed)."
