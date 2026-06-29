#!/usr/bin/env python3
"""Generate contour line GeoJSON from a Copernicus DEM tile, clipped to the AOI.

Outputs data/contours.geojson with LineString features carrying a `height`
integer attribute (meters). Consumed by scripts/schema.yml (planetiler custom
map `contours` layer).

Run with:  uv run --with rasterio --with numpy --with matplotlib \
                 python scripts/generate-contours.py
"""
from __future__ import annotations
import json
import math
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds
from rasterio.transform import xy as transform_xy
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

DEM = Path("data/dem_n46e008.tif")
OUT = Path("data/contours.geojson")

# Chironico AOI + a small buffer so contour lines run past tile edges.
BUF = 0.004  # ~400 m
MINLON, MINLAT, MAXLON, MAXLAT = 8.820 - BUF, 46.405 - BUF, 8.875 + BUF, 46.445 + BUF

INTERVAL = 10  # meters between contour lines
BASE = 0

def main() -> None:
    if not DEM.exists():
        sys.exit(f"missing DEM tile: {DEM}")
    with rasterio.open(DEM) as src:
        win = from_bounds(MINLON, MINLAT, MAXLON, MAXLAT, src.transform)
        arr = src.read(1, window=win, masked=True)
        win_transform = src.window_transform(win)

    if arr.mask.all() if np.ma.isMaskedArray(arr) else np.all(np.isnan(arr)):
        sys.exit("DEM window is empty / nodata")

    h, w = arr.shape
    rows, cols = np.meshgrid(np.arange(h), np.arange(w), indexing="ij")
    xs, ys = transform_xy(win_transform, rows, cols)
    X = np.asarray(xs).reshape(arr.shape)
    Y = np.asarray(ys).reshape(arr.shape)

    z = arr.filled(np.nan) if np.ma.isMaskedArray(arr) else np.asarray(arr, float)
    finite = z[np.isfinite(z)]
    if finite.size == 0:
        sys.exit("no finite elevation values")
    zmin = int(math.floor(finite.min() / INTERVAL) * INTERVAL)
    zmax = int(math.ceil(finite.max() / INTERVAL) * INTERVAL)
    levels = list(range(max(BASE, zmin), zmax + 1, INTERVAL))
    if not levels:
        sys.exit("no contour levels to draw")

    fig, ax = plt.subplots(figsize=(6, 6), dpi=80)
    cs = ax.contour(X, Y, z, levels=levels)
    plt.close(fig)

    features = []
    for level, segs in zip(cs.levels, cs.allsegs):
        for seg in segs:
            if seg is None or len(seg) < 2:
                continue
            coords = [[float(x), float(y)] for x, y in seg]
            features.append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": coords},
                "properties": {"height": int(level)},
            })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f)
    print(f"wrote {len(features)} contour lines to {OUT} "
          f"(levels {levels[0]}..{levels[-1]} m)")

if __name__ == "__main__":
    main()
