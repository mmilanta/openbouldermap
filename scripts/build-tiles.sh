#!/usr/bin/env bash
# Build tiles/switzerland.pmtiles from OSM data.
# Run from the repo root. Requires: java (>=17). No contours for now.
#
#   --download   download a fresh switzerland.osm.pbf from Geofabrik first
#   --skip-pbf   skip the PBF existence check (useful with --download if
#                you know it'll be fetched)
set -euo pipefail

DOWNLOAD=false
SKIP_PBF=false
PBF_URL="https://download.geofabrik.de/europe/switzerland-latest.osm.pbf"

for arg in "$@"; do
  case "$arg" in
    --download) DOWNLOAD=true ;;
    --skip-pbf) SKIP_PBF=true ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

if $DOWNLOAD; then
  echo "==> Downloading fresh PBF from Geofabrik ..."
  curl -fLo data/switzerland.osm.pbf "$PBF_URL"
  ls -lh data/switzerland.osm.pbf
  SKIP_PBF=true
fi

if ! $SKIP_PBF; then
  INPUTS=(planetiler.jar data/switzerland.osm.pbf)
  for f in "${INPUTS[@]}"; do
    [ -f "$f" ] || { echo "missing $f (see README)"; exit 1; }
  done
fi

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
