# OpenBoulderMap — data pipeline Makefile
#
#   make download   Re-download the OSM extract (+ DEM) into data/
#   make tiles      Rebuild tiles/*.pmtiles from local OSM data
#   make serve      Start the dev server at http://localhost:5173
#
# Prerequisites: curl, osmium, java >= 17, node >= 18, planetiler.jar (repo root).
# See README.md.

SHELL := /bin/bash

# ---- URLs ------------------------------------------------------------------
SWITZERLAND_URL := https://download.geofabrik.de/europe/switzerland-latest.osm.pbf
PLANET_URL      := https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf
DEM_URL         := https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N46_00_E008_00_DEM/Copernicus_DSM_COG_10_N46_00_E008_00_DEM.tif

# ---- Files -----------------------------------------------------------------
SWITZERLAND_PBF := data/switzerland.osm.pbf
PLANET_PBF      := data/planet.osm.pbf
DEM_TIF         := data/dem_n46e008.tif
CLIMBING_TILES  := tiles/climbing.pmtiles
SWISS_TILES     := tiles/switzerland.pmtiles

.DEFAULT_GOAL := help

.PHONY: help download download-planet tiles serve serve-tiles clean

## ---------------------------------------------------------------- help
help: ## Show available targets
	@echo "OpenBoulderMap Makefile"
	@echo ""
	@echo "  make download       Re-download data (Switzerland extract + DEM) into data/"
	@echo "  make download-planet Download the full planet (~70 GB) — warning: huge"
	@echo "  make tiles          Rebuild tiles/climbing.pmtiles + tiles/switzerland.pmtiles"
	@echo "  make serve          Start the dev server at http://localhost:5173"
	@echo "  make serve-tiles    Start the XYZ tile server for Maputnik (port 8081)"
	@echo "  make clean          Remove regenerable data + tiles"

## ---------------------------------------------------------------- download
download: ## Re-download all data (force)
	rm -f $(SWITZERLAND_PBF) $(DEM_TIF)
	$(MAKE) $(SWITZERLAND_PBF) $(DEM_TIF)

download-planet: ## Download the full planet PBF (~70 GB)
	curl -fLo $(PLANET_PBF) $(PLANET_URL)
	ls -lh $(PLANET_PBF)

data:
	mkdir -p data

$(SWITZERLAND_PBF): | data
	@echo "==> Downloading Switzerland OSM extract ..."
	curl -fLo $@ $(SWITZERLAND_URL)
	ls -lh $@

$(DEM_TIF): | data
	@echo "==> Downloading Copernicus DEM tile (N46 E008, for contours) ..."
	curl -fLo $@ $(DEM_URL)
	ls -lh $@

## ---------------------------------------------------------------- tiles
tiles: $(SWITZERLAND_PBF) ## Rebuild PMTiles from local OSM data (auto-downloads PBF if missing)
	@test -f planetiler.jar || { echo "Error: planetiler.jar not found at repo root (see README)"; exit 1; }
	@command -v osmium >/dev/null 2>&1 || { echo "Error: osmium not found in PATH"; exit 1; }
	@command -v java >/dev/null 2>&1 || { echo "Error: java not found in PATH"; exit 1; }
	bash scripts/build-climbing-tiles.sh $(SWITZERLAND_PBF)
	bash scripts/build-tiles.sh

## ---------------------------------------------------------------- serve
node_modules:
	npm install

serve: node_modules $(CLIMBING_TILES) ## Start the Vite dev server
	npm run dev

serve-tiles: node_modules $(CLIMBING_TILES) ## Start XYZ tile server for Maputnik (port 8081)
	npm run serve-tiles

## ---------------------------------------------------------------- clean
clean: ## Remove regenerable data and tiles
	rm -rf $(SWITZERLAND_PBF) $(PLANET_PBF) $(DEM_TIF) data/climbing-filtered.osm.pbf $(CLIMBING_TILES) $(SWISS_TILES)
	@echo "==> Cleaned. Rebuild with:  make download && make tiles"
