# OpenBoulderMap — data pipeline Makefile
#
# Mirrors the daily CI job (.github/workflows/update-data.yml):
#
#   make download   Download worldwide climbing data from Overpass into data/
#   make tiles      Rebuild tiles/climbing.pmtiles (+ index/metadata)
#   make serve      Start the dev server at http://localhost:5173
#   make test       Typecheck + unit tests
#
# Override the input with any OSM PBF:  make tiles PBF=data/europe.osm.pbf
# Prerequisites: curl, osmium, java >= 21, node >= 22, python3. See README.md.

SHELL := /bin/bash

PLANETILER_VERSION := 0.10.2
PLANETILER_URL     := https://github.com/onthegomap/planetiler/releases/download/v$(PLANETILER_VERSION)/planetiler.jar

PBF            ?= data/overpass-climbing.osm.pbf
CLIMBING_TILES := tiles/climbing.pmtiles

.DEFAULT_GOAL := help

.PHONY: help download tiles serve serve-tiles test clean

help: ## Show available targets
	@grep -E '^[a-zA-Z_.-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-14s %s\n", $$1, $$2}'

download: ## Download worldwide climbing data from Overpass (force refresh)
	bash scripts/download-overpass-climbing.sh --output data/overpass-climbing.osm.pbf

data/overpass-climbing.osm.pbf:
	bash scripts/download-overpass-climbing.sh --output $@

planetiler.jar: ## Download the pinned planetiler release
	curl -fLo $@ $(PLANETILER_URL)

tiles: planetiler.jar $(PBF) ## Rebuild tiles/climbing.pmtiles from $(PBF)
	bash scripts/build-climbing-tiles.sh $(PBF)

node_modules: package-lock.json
	npm install
	@touch $@

serve: node_modules ## Start the Vite dev server
	npm run dev

serve-tiles: node_modules ## Start XYZ tile server for Maputnik (port 8081)
	npm run serve-tiles

test: node_modules ## Typecheck and run unit tests
	npm run typecheck
	npm test

clean: ## Remove regenerable intermediate data (keeps the committed tiles)
	rm -f data/overpass-climbing.osm.pbf data/climbing-filtered.osm.pbf data/sectors.geojson data/boulders.geojson
