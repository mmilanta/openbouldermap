#!/usr/bin/env bash
# Build tiles/climbing.pmtiles — a tiny PMTiles archive containing only
# bouldering features (boulders + routes + sectors), extracted from an OSM PBF.
#
# Usage:
#   bash scripts/build-climbing-tiles.sh [source]
#
#   source can be:
#     - A local .osm.pbf file (e.g. data/switzerland.osm.pbf)
#     - A URL (https://...) — osmium will stream-filter directly, no disk temp file
#     - Omitted — uses data/switzerland.osm.pbf
#
# Planet URL (streams ~87 GB, writes only a few MB):
#   bash scripts/build-climbing-tiles.sh https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf
#
# Continent extract (download first):
#   curl -Lo data/europe.osm.pbf https://download.geofabrik.de/europe-latest.osm.pbf
#   bash scripts/build-climbing-tiles.sh data/europe.osm.pbf
#
# Requires: osmium, java >= 17, planetiler.jar (at repo root)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

SOURCE="${1:-data/switzerland.osm.pbf}"
FILTERED="data/climbing-filtered.osm.pbf"
OUTPUT="tiles/climbing.pmtiles"

# Tags to keep — everything climbing-related plus sport/site/type for context
FILTER_TAGS="climbing climbing:boulder climbing:grade:font climbing:start climbing:fa climbing:length site sport natural"

# Check prerequisites
for cmd in osmium java; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Error: $cmd not found in PATH"; exit 1; }
done
[ -f planetiler.jar ] || { echo "Error: planetiler.jar not found at repo root"; exit 1; }

mkdir -p data tiles

echo "==> Filtering climbing tags from: $SOURCE"
if [[ "$SOURCE" == http://* || "$SOURCE" == https://* ]]; then
  echo "     Streaming directly from URL (no full download needed) ..."
  osmium tags-filter -o "$FILTERED" "$SOURCE" $FILTER_TAGS
else
  [ -f "$SOURCE" ] || { echo "Error: PBF not found at $SOURCE"; exit 1; }
  ORIG_SIZE=$(du -h "$SOURCE" | cut -f1)
  osmium tags-filter -o "$FILTERED" "$SOURCE" $FILTER_TAGS
  echo "     Original: $ORIG_SIZE  →  Filtered: $(du -h "$FILTERED" | cut -f1)"
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
