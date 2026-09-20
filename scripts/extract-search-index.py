#!/usr/bin/env python3
"""Build the compact worldwide search index used by the viewer search bar.

Only named boulder problems, bouldering sectors and bouldering areas are
indexed. The viewer fetches this file lazily on first search interaction, so
it never slows down the initial page load for people who only browse.

Input : OPL text on stdin (produced by
        `osmium cat -f opl data/climbing-filtered.osm.pbf`)
Output: tiles/climbing-search.json (or the path given as the first argument)

Output shape::

    {
      "parents": [[sectorName, areaName], ...],
      "rows": [ [name, kind, osm_type, osm_id, lon, lat, font, hueco, parent] , ... ]
    }

    kind:     p = boulder problem, s = sector, a = area
    osm_type: n = node, w = way, r = relation
    font:     Font grade for problems ("" if none)
    hueco:    Hueco (V) grade for problems ("" if none)
    parent:   index into "parents" for problems (-1 if none); omitted/ignored
              for sectors and areas

Parent names are deduplicated into the `parents` table because many problems
share a sector. Rows are sorted by name so the file gzips well. Coordinates are
rounded to ~11 m, which is plenty for a fly-to.

Run from the repo root:
  osmium cat -f opl data/climbing-filtered.osm.pbf | python3 scripts/extract-search-index.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

DEFAULT_OUT = Path("tiles/climbing-search.json")

# Geometry is only needed to place a search result on the map, so a shallow
# recursion depth is plenty and prevents pathological nesting from looping.
MAX_DEPTH = 5


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
    """Parse the OPL tag list (comma-separated key=value, values escaped)."""
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


def split_tags(line: str, marker: str) -> tuple[dict[str, str], str]:
    """Return (tags, remainder) for an OPL line, remainder after `marker`."""
    if " T" not in line:
        return {}, ""
    tags_part = line.split(" T", 1)[1]
    if f" {marker}" in tags_part:
        tags_str, rest = tags_part.split(f" {marker}", 1)
    else:
        tags_str, rest = tags_part, ""
    return parse_tags(tags_str), rest


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
        if mtype in {"n", "w", "r"} and digits.isdigit():
            members.append((mtype, int(digits)))
    return members


def candidate_kind(tags: dict[str, str]) -> str | None:
    """Map climbing tags to a searchable kind, or None."""
    climbing = tags.get("climbing")
    if climbing == "route_bottom":
        return "p"
    if climbing == "crag" and tags.get("climbing:boulder") == "yes":
        return "s"
    if climbing == "area" and tags.get("climbing:boulder") == "yes":
        return "a"
    return None


def main() -> None:
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT

    node_coords: dict[int, tuple[float, float]] = {}
    way_nodes: dict[int, list[int]] = {}
    # Candidate sectors/areas on ways and relations need geometry resolved later.
    way_candidates: dict[int, tuple[str, dict[str, str]]] = {}
    rel_candidates: dict[int, tuple[str, dict[str, str]]] = {}
    relation_members: dict[int, list[tuple[str, int]]] = {}
    relation_tags: dict[int, dict[str, str]] = {}
    problems: list[tuple[str, int, float, float, str]] = []
    node_points: list[list[object]] = []

    for line in sys.stdin:
        line = line.rstrip("\n")
        if not line:
            continue
        otype = line[0]
        oid_str = line[1:].split(" ", 1)[0]
        if not oid_str.isdigit():
            continue
        oid = int(oid_str)

        if otype == "n":
            if " x" in line and " y" in line:
                _, _, xy = line.rpartition(" x")
                lon_str, _, lat_str = xy.partition(" y")
                try:
                    node_coords[oid] = (float(lon_str), float(lat_str))
                except ValueError:
                    pass
            tags, _ = split_tags(line, "x")
            kind = candidate_kind(tags)
            name = tags.get("name", "").strip()
            if not name or kind is None or oid not in node_coords:
                continue
            lon, lat = node_coords[oid]
            if kind == "p":
                problems.append((name, oid, lon, lat, tags.get("climbing:grade:font", ""), tags.get("climbing:grade:hueco", "")))
            else:
                # Node-tagged crags/areas are not drawn as polygons by the tiles
                # but are real, searchable places.
                node_points.append([name, kind, "n", oid, round(lon, 4), round(lat, 4)])

        elif otype == "w":
            if " N" in line:
                refs_str = line.rsplit(" N", 1)[1]
                way_nodes[oid] = [int(t[1:]) for t in refs_str.split(",") if len(t) > 1 and t[1:].isdigit()]
            tags, _ = split_tags(line, "N")
            kind = candidate_kind(tags)
            name = tags.get("name", "").strip()
            if name and kind in {"s", "a"}:
                way_candidates[oid] = (name, tags)

        elif otype == "r":
            tags, member_str = split_tags(line, "M")
            relation_members[oid] = parse_members(member_str)
            relation_tags[oid] = tags
            kind = candidate_kind(tags)
            name = tags.get("name", "").strip()
            if name and kind in {"s", "a"}:
                rel_candidates[oid] = (name, tags)

    # Site relations sometimes tag a child sector as climbing=area. Infer those
    # children as sectors, matching scripts/extract-sectors.py.
    site_ids = {
        oid
        for oid, (_name, tags) in rel_candidates.items()
        if tags.get("type") == "site"
    }
    child_site_ids = {
        member_id
        for oid in site_ids
        for member_type, member_id in relation_members.get(oid, [])
        if member_type == "r" and member_id in site_ids
    }

    def collect_coords(refs: list[tuple[str, int]], depth: int = 0) -> list[tuple[float, float]]:
        if depth > MAX_DEPTH:
            return []
        coords: list[tuple[float, float]] = []
        for mtype, mid in refs:
            if mtype == "n" and mid in node_coords:
                coords.append(node_coords[mid])
            elif mtype == "w" and mid in way_nodes:
                coords.extend(collect_coords([("n", n) for n in way_nodes[mid]], depth + 1))
            elif mtype == "r" and mid in relation_members:
                coords.extend(collect_coords(relation_members[mid], depth + 1))
        return coords

    def centroid(coords: list[tuple[float, float]]) -> tuple[float, float] | None:
        if not coords:
            return None
        return (sum(c[0] for c in coords) / len(coords), sum(c[1] for c in coords) / len(coords))

    # ---- mapped hierarchy for problems: problem node -> crag -> area ----
    # The tiles only render bouldering sectors (climbing:boulder=yes), but every
    # route sits inside a mapped climbing crag whose name is useful context.
    problem_ids = {oid for (_name, oid, _lon, _lat, _font, _hueco) in problems}
    sector_parent: dict[int, int] = {}
    preferred: dict[int, bool] = {}
    for rid, members in relation_members.items():
        tags = relation_tags[rid]
        if tags.get("type") != "site" or tags.get("climbing") != "crag" or not tags.get("name"):
            continue
        is_boulder = tags.get("climbing:boulder") == "yes"
        for member_type, member_id in members:
            if member_type != "n" or member_id not in problem_ids:
                continue
            if member_id not in sector_parent or (is_boulder and not preferred.get(member_id)):
                sector_parent[member_id] = rid
                preferred[member_id] = is_boulder

    area_parent: dict[int, int] = {}
    direct_area: dict[int, int] = {}
    for rid, members in relation_members.items():
        tags = relation_tags[rid]
        if tags.get("type") != "site" or tags.get("climbing") != "area" or not tags.get("name"):
            continue
        for member_type, member_id in members:
            if member_type == "r" and relation_tags.get(member_id, {}).get("climbing") == "crag":
                area_parent.setdefault(member_id, rid)
            elif member_type == "n" and member_id in problem_ids:
                direct_area.setdefault(member_id, rid)

    parents: list[list[str]] = []
    parent_index: dict[tuple[str, str], int] = {}
    problem_parent: dict[int, int] = {}
    for oid in problem_ids:
        sector_id = sector_parent.get(oid)
        sector_name = relation_tags[sector_id].get("name", "") if sector_id else ""
        area_id = area_parent.get(sector_id) if sector_id else direct_area.get(oid)
        area_name = relation_tags[area_id].get("name", "") if area_id else ""
        if not sector_name and not area_name:
            continue
        pair = (sector_name, area_name)
        if pair not in parent_index:
            parent_index[pair] = len(parents)
            parents.append(list(pair))
        problem_parent[oid] = parent_index[pair]

    # ---- rows ----
    rows: list[list[object]] = []
    rows.extend(node_points)
    for name, oid, lon, lat, font, hueco in problems:
        rows.append([name, "p", "n", oid, round(lon, 4), round(lat, 4), font, hueco, problem_parent.get(oid, -1)])

    for oid, (name, tags) in way_candidates.items():
        point = centroid([node_coords[n] for n in way_nodes.get(oid, []) if n in node_coords])
        if point:
            kind = "s" if tags.get("climbing") == "crag" else "a"
            rows.append([name, kind, "w", oid, round(point[0], 4), round(point[1], 4)])

    for oid, (name, tags) in rel_candidates.items():
        point = centroid(collect_coords(relation_members.get(oid, [])))
        if not point:
            continue
        if tags.get("climbing") == "crag" or oid in child_site_ids:
            kind = "s"
        else:
            kind = "a"
        rows.append([name, kind, "r", oid, round(point[0], 4), round(point[1], 4)])

    rows.sort(key=lambda r: str(r[0]).casefold())

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as f:
        json.dump({"parents": parents, "rows": rows}, f, ensure_ascii=False, separators=(",", ":"))

    problems_n = sum(r[1] == "p" for r in rows)
    sectors_n = sum(r[1] == "s" for r in rows)
    areas_n = sum(r[1] == "a" for r in rows)
    with_parent = sum(1 for r in rows if r[1] == "p" and r[8] != -1)
    print(f"wrote {len(rows)} search rows ({problems_n} problems, {sectors_n} sectors, {areas_n} areas; "
          f"{with_parent} problems with sector/area context) and {len(parents)} parent pairs to {out_path}")


if __name__ == "__main__":
    main()
