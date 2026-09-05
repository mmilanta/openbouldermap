#!/usr/bin/env python3
"""Extract bouldering area and sector points from OSM site relations.

The hierarchy is represented by `type=site` relations: an outer
`climbing=area` contains `climbing=crag` sectors, and sectors contain problems.
Planetiler can't turn these node-membered site relations into polygons, so this
script emits a centroid point for each area and sector.

Input : OPL text on stdin (produced by `osmium cat -f opl data/climbing-filtered.osm.pbf`)
Output: data/sectors.geojson (GeoJSON FeatureCollection of Points)

Run from the repo root:
  osmium cat -f opl data/climbing-filtered.osm.pbf | python3 scripts/extract-sectors.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

OUT = Path("data/sectors.geojson")


def opl_decode(s: str) -> str:
    """Decode an OPL-escaped string (space -> %20%, comma -> %2c%, ...)."""
    out: list[str] = []
    i = 0
    while i < len(s):
        c = s[i]
        if c == "%":
            j = s.find("%", i + 1)
            if j == -1:
                out.append(c)
                i += 1
                continue
            hexpart = s[i + 1 : j]
            try:
                out.append(chr(int(hexpart, 16)))
            except ValueError:
                out.append(hexpart)
            i = j + 1
        else:
            out.append(c)
            i += 1
    return "".join(out)


def parse_tags(tag_str: str) -> dict[str, str]:
    """Parse the OPL tag list (comma-separated key=value, values OPL-escaped)."""
    tags: dict[str, str] = {}
    for part in tag_str.split(","):
        if not part:
            continue
        if "=" in part:
            key, value = part.split("=", 1)
            tags[key] = opl_decode(value)
        else:
            tags[part] = ""
    return tags


def parse_members(member_str: str) -> list[tuple[str, int]]:
    """Parse the OPL member list -> [(type, id), ...]."""
    members: list[tuple[str, int]] = []
    for part in member_str.split(","):
        if not part or "@" not in part:
            continue
        ref, _role = part.split("@", 1)
        if not ref:
            continue
        mtype = ref[0]
        digits = ref[1:]
        if digits.isdigit():
            members.append((mtype, int(digits)))
    return members


def main() -> None:
    node_coords: dict[int, tuple[float, float]] = {}
    way_nodes: dict[int, list[int]] = {}
    # Bouldering site relations: id -> (name, climbing value, members).
    sites: dict[int, tuple[str, str, list[tuple[str, int]]]] = {}

    for line in sys.stdin:
        line = line.rstrip("\n")
        if not line:
            continue
        otype = line[0]

        if otype == "n":
            # n<id> v1 ... T<tags> x<lon> y<lat>
            oid_str = line[1:].split(" ", 1)[0]
            if not oid_str.isdigit():
                continue
            oid = int(oid_str)
            if " x" in line and " y" in line:
                # last two tokens are x<lon> y<lat>
                _, _, xy = line.rpartition(" x")
                lon_str, _, lat_str = xy.partition(" y")
                try:
                    node_coords[oid] = (float(lon_str), float(lat_str))
                except ValueError:
                    pass

        elif otype == "w":
            # w<id> v1 ... T<tags> N<n1>,<n2>,...
            oid_str = line[1:].split(" ", 1)[0]
            if not oid_str.isdigit():
                continue
            oid = int(oid_str)
            if " N" in line:
                refs_str = line.rsplit(" N", 1)[1]
                refs = [int(t[1:]) for t in refs_str.split(",") if len(t) > 1 and t[1:].isdigit()]
                way_nodes[oid] = refs

        elif otype == "r":
            # r<id> v1 ... T<tags> M<members>
            oid_str = line[1:].split(" ", 1)[0]
            if not oid_str.isdigit():
                continue
            oid = int(oid_str)
            if " T" not in line:
                continue
            tags_part = line.split(" T", 1)[1]
            if " M" in tags_part:
                tags_str, member_str = tags_part.split(" M", 1)
            else:
                tags_str, member_str = tags_part, ""
            tags = parse_tags(tags_str)
            climbing = tags.get("climbing")
            if (
                tags.get("type") == "site"
                and tags.get("site") == "climbing"
                and tags.get("climbing:boulder") == "yes"
                and climbing in {"area", "crag"}
                and tags.get("name")
            ):
                sites[oid] = (tags["name"], climbing, parse_members(member_str))

    # Some datasets tag both the destination and its immediate child sectors as
    # climbing=area (for example Chironico). Infer those children as sectors
    # from the site-relation hierarchy, while preserving explicit crag tags.
    child_site_ids = {
        member_id
        for _parent_id, (_name, _climbing, members) in sites.items()
        for member_type, member_id in members
        if member_type == "r" and member_id in sites
    }

    # Resolve each site's members (nodes, ways, nested relations) to coordinates.
    features = []
    for rel_id, (name, climbing, members) in sorted(sites.items()):
        effective_climbing = "crag" if climbing == "crag" or rel_id in child_site_ids else "area"
        coords: list[tuple[float, float]] = []

        def collect(refs: list[tuple[str, int]], depth: int = 0) -> None:
            if depth > 4:
                return
            for mtype, mid in refs:
                if mtype == "n":
                    if mid in node_coords:
                        coords.append(node_coords[mid])
                elif mtype == "w":
                    if mid in way_nodes:
                        collect([("n", n) for n in way_nodes[mid]], depth + 1)
                elif mtype == "r":
                    if mid in sites:
                        collect(sites[mid][2], depth + 1)

        collect(members)
        if not coords:
            print(f"warning: no coordinates for climbing site {rel_id} ({name})", file=sys.stderr)
            continue
        lon = sum(c[0] for c in coords) / len(coords)
        lat = sum(c[1] for c in coords) / len(coords)
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
                "properties": {
                    "name": name,
                    "climbing": effective_climbing,
                    "kind": "area" if effective_climbing == "area" else "sector",
                    "osm_id": rel_id,
                    "osm_type": "relation",
                },
            }
        )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f)
    area_count = sum(f["properties"]["kind"] == "area" for f in features)
    sector_count = len(features) - area_count
    print(f"wrote {area_count} area and {sector_count} sector points to {OUT}")


if __name__ == "__main__":
    main()
