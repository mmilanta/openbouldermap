#!/usr/bin/env bash
# Build tiles/switzerland.pmtiles from OSM data.
# Run from the repo root. Requires: java (>=17). No contours for now.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

INPUTS=(planetiler.jar data/switzerland.osm.pbf)
for f in "${INPUTS[@]}"; do
  [ -f "$f" ] || { echo "missing $f (see README)"; exit 1; }
done

mkdir -p tiles

echo "==> Running planetiler (custom schema) -> tiles/switzerland.pmtiles"
java -Xmx4g -jar planetiler.jar generate-custom \
  --schema=scripts/schema.yml \
  --bounds=5.95,45.82,10.49,47.81 \
  --minzoom=7 \
  --maxzoom=16 \
  --output=tiles/switzerland.pmtiles \
  --force

echo "==> Done."
ls -lh tiles/switzerland.pmtiles
echo "Start the app with:  npm run dev"
