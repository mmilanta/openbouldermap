#!/usr/bin/env bash
# Build tiles/chironico.pmtiles from OSM + Copernicus DEM.
# Run from the repo root. Requires: java (>=17), uv, internet the first time.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

echo "==> [1/4] Inputs present?"
for f in planetiler.jar data/switzerland.osm.pbf data/dem_n46e008.tif; do
  [ -f "$f" ] || { echo "missing $f (see README)"; exit 1; }
done

echo "==> [2/4] Generating contour GeoJSON from DEM (uv ephemeral env)..."
uv run --with rasterio --with numpy --with matplotlib \
  python scripts/generate-contours.py

echo "==> [3/4] Running planetiler (custom schema) -> tiles/chironico.pmtiles"
mkdir -p tiles
java -Xmx4g -jar planetiler.jar generate-custom \
  --schema=scripts/schema.yml \
  --bounds=8.820,46.405,8.875,46.445 \
  --minzoom=11 \
  --maxzoom=16 \
  --output=tiles/chironico.pmtiles \
  --force

echo "==> [4/4] Done."
ls -la tiles/chironico.pmtiles
echo "Start the app with:  npm run dev   (then open the printed URL)"
