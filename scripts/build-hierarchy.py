#!/usr/bin/env python3
"""Derive the bouldering hierarchy for OpenBoulderMap.

Input : OPL text on stdin (produced by `osmium cat -f opl data/climbing-filtered.osm.pbf`)
Outputs:
  data/sectors.geojson        area + sector centroid points (map labels)
  data/boulders.geojson       physical rock geometry with its sector link
  tiles/climbing-index.json   viewer tree + problem records (no live OSM API)

Model (see data-schema.md):
  area  (type=site + climbing=area  + climbing:boulder=yes)  — nested, ranked
    └─ sector (type=site + climbing=crag + climbing:boulder=yes) — the boulder
         └─ problem (node, climbing=route_bottom)

The physical rock (`climbing=boulder` + `natural∈{stone,bare_rock}`) is linked
to its sector through relation membership; a crag is expected to have exactly
one rock. Rocks without a sector are still emitted (the viewer dims them).

Run from the repo root:
  osmium cat -f opl data/climbing-filtered.osm.pbf | python3 scripts/build-hierarchy.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

SECTORS_OUT = Path("data/sectors.geojson")
BOULDERS_OUT = Path("data/boulders.geojson")
INDEX_OUT = Path("tiles/climbing-index.json")

MAX_RANK = 5      # deepest allowed area rank; exceeding it is a build error
MAX_DEPTH = 6     # bound for geometry collection (defensive, not the rank cap)
ROCK_NATURAL = {"stone", "bare_rock"}


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
    if " T" not in line:
        return {}, ""
    tags_part = line.split(" T", 1)[1]
    if f" {marker}" in tags_part:
        tags_str, rest = tags_part.split(f" {marker}", 1)
    else:
        tags_str, rest = tags_part, ""
    return parse_tags(tags_str), rest


def parse_members(member_str: str) -> list[tuple[str, int, str]]:
    members: list[tuple[str, int, str]] = []
    for part in member_str.split(","):
        if not part or "@" not in part:
            continue
        ref, role = part.split("@", 1)
        if not ref:
            continue
        mtype, digits = ref[0], ref[1:]
        if mtype in {"n", "w", "r"} and digits.isdigit():
            members.append((mtype, int(digits), opl_decode(role)))
    return members


def centroid(coords: list[tuple[float, float]]) -> tuple[float, float] | None:
    if not coords:
        return None
    return (sum(c[0] for c in coords) / len(coords), sum(c[1] for c in coords) / len(coords))


def main() -> None:
    sectors_out = Path(sys.argv[1]) if len(sys.argv) > 1 else SECTORS_OUT
    boulders_out = Path(sys.argv[2]) if len(sys.argv) > 2 else BOULDERS_OUT
    index_out = Path(sys.argv[3]) if len(sys.argv) > 3 else INDEX_OUT

    node_coords: dict[int, tuple[float, float]] = {}
    node_tags: dict[int, dict[str, str]] = {}
    way_nodes: dict[int, list[int]] = {}
    way_tags: dict[int, dict[str, str]] = {}
    rel_tags: dict[int, dict[str, str]] = {}
    rel_members: dict[int, list[tuple[str, int, str]]] = {}

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
            node_tags[oid] = tags
        elif otype == "w":
            if " N" in line:
                refs_str = line.rsplit(" N", 1)[1]
                way_nodes[oid] = [int(t[1:]) for t in refs_str.split(",") if len(t) > 1 and t[1:].isdigit()]
            tags, _ = split_tags(line, "N")
            way_tags[oid] = tags
        elif otype == "r":
            tags, member_str = split_tags(line, "M")
            rel_tags[oid] = tags
            rel_members[oid] = parse_members(member_str)

    def is_rock(tags: dict[str, str]) -> bool:
        return tags.get("climbing") == "boulder" and tags.get("natural") in ROCK_NATURAL

    def is_site(tags: dict[str, str]) -> bool:
        return tags.get("type") == "site" and tags.get("climbing:boulder") == "yes"

    areas = {rid for rid, t in rel_tags.items() if is_site(t) and t.get("climbing") == "area"}
    crags = {rid for rid, t in rel_tags.items() if is_site(t) and t.get("climbing") == "crag"}
    problems = {nid for nid, t in node_tags.items() if t.get("climbing") == "route_bottom"}
    rocks = (
        {("n", nid) for nid, t in node_tags.items() if is_rock(t)}
        | {("w", wid) for wid, t in way_tags.items() if is_rock(t)}
        | {("r", rid) for rid, t in rel_tags.items() if is_rock(t)}
    )

    def collect_coords(refs: list[tuple[str, int, str]], depth: int = 0) -> list[tuple[float, float]]:
        if depth > MAX_DEPTH:
            return []
        out: list[tuple[float, float]] = []
        for mtype, mid, _role in refs:
            if mtype == "n" and mid in node_coords:
                out.append(node_coords[mid])
            elif mtype == "w" and mid in way_nodes:
                out.extend(node_coords[n] for n in way_nodes[mid] if n in node_coords)
            elif mtype == "r" and mid in rel_members:
                out.extend(collect_coords(rel_members[mid], depth + 1))
        return out

    def group_point(rid: int) -> tuple[float, float] | None:
        return centroid(collect_coords(rel_members.get(rid, [])))

    # ---- area tree -----------------------------------------------------
    area_parent_candidates: dict[int, list[int]] = {}
    for parent in areas:
        for mtype, mid, _role in rel_members.get(parent, []):
            if mtype == "r" and mid in areas and mid != parent:
                area_parent_candidates.setdefault(mid, []).append(parent)

    area_parent: dict[int, int | None] = {}
    for child, parents in area_parent_candidates.items():
        ordered = sorted(set(parents))
        if len(ordered) > 1:
            print(f"warning: area {child} has {len(ordered)} parents {ordered}; using {ordered[0]}", file=sys.stderr)
        area_parent[child] = ordered[0]

    def area_rank(rid: int) -> int:
        rank = 0
        seen = {rid}
        cur = area_parent.get(rid)
        while cur is not None:
            if cur in seen:
                raise SystemExit(f"error: cycle in area parents involving relation {cur}")
            seen.add(cur)
            rank += 1
            if rank > MAX_RANK:
                raise SystemExit(
                    f"error: area {rid} nests deeper than the allowed rank {MAX_RANK}. "
                    "Fix the OSM hierarchy or raise MAX_RANK."
                )
            cur = area_parent.get(cur)
        return rank

    ranks = {rid: area_rank(rid) for rid in areas}

    # ---- crag -> area, crag -> rock, crag -> problems ------------------
    crag_parent_candidates: dict[int, list[int]] = {}
    for parent in areas:
        for mtype, mid, _role in rel_members.get(parent, []):
            if mtype == "r" and mid in crags:
                crag_parent_candidates.setdefault(mid, []).append(parent)
    crag_parent: dict[int, int | None] = {}
    for crag, parents in crag_parent_candidates.items():
        ordered = sorted(set(parents))
        if len(ordered) > 1:
            print(f"warning: boulder {crag} is in {len(ordered)} areas {ordered}; using {ordered[0]}", file=sys.stderr)
        crag_parent[crag] = ordered[0]

    crag_rock: dict[int, tuple[str, int] | None] = {}
    crag_problems: dict[int, list[int]] = {}
    problem_crag: dict[int, int] = {}
    for crag in crags:
        rock_found: tuple[str, int] | None = None
        found: list[int] = []
        for mtype, mid, _role in rel_members.get(crag, []):
            key = (mtype, mid)
            if key in rocks and rock_found is None:
                rock_found = key
            elif mtype == "n" and mid in problems:
                found.append(mid)
        if rock_found is None:
            print(f"warning: boulder relation {crag} has no physical rock member", file=sys.stderr)
        crag_rock[crag] = rock_found
        crag_problems[crag] = found
        for pid in found:
            existing = problem_crag.get(pid)
            if existing is not None and existing != crag:
                print(f"warning: problem {pid} belongs to boulders {existing} and {crag}; using {min(existing, crag)}", file=sys.stderr)
                problem_crag[pid] = min(existing, crag)
            else:
                problem_crag[pid] = crag

    # ---- problem records ----------------------------------------------
    problem_ids = sorted(problems)
    problem_index: dict[int, int] = {}
    problem_rows: list[list[object]] = []
    for pid in problem_ids:
        tags = node_tags.get(pid, {})
        lon, lat = node_coords.get(pid, (None, None))
        if lon is None:
            continue
        problem_index[pid] = len(problem_rows)
        problem_rows.append([
            tags.get("name", ""),
            pid,
            problem_crag.get(pid, -1),
            round(lon, 5), round(lat, 5),
            tags.get("climbing:grade:font", ""),
            tags.get("climbing:grade:hueco", ""),
            tags.get("wikimedia_commons", ""),
            tags.get("wikimedia_commons:path", ""),
            tags.get("description", ""),
            tags.get("climbing:fa", tags.get("fa", "")),
            tags.get("climbing:length", ""),
            tags.get("url", ""),
            tags.get("climbing:start", ""),
        ])

    # ---- area / sector rows + geojson points --------------------------
    area_children: dict[int, list[int]] = {rid: [] for rid in areas}
    area_sectors: dict[int, list[int]] = {rid: [] for rid in areas}
    for crag, parent in crag_parent.items():
        if parent in area_sectors:
            area_sectors[parent].append(crag)
    for child, parent in area_parent.items():
        if parent in area_children:
            area_children[parent].append(child)

    # Display band counts from the bottom: band 0 is the deepest existing area
    # level, band 1 the one above it, and so on. The viewer anchors zoom bands
    # to these, so areas of two levels never share a zoom.
    max_rank = max(ranks.values(), default=0)
    area_rows: list[list[object]] = []
    for rid in sorted(areas):
        point = group_point(rid)
        area_rows.append([
            rid,
            rel_tags[rid].get("name", ""),
            ranks[rid],
            area_parent.get(rid, -1) if area_parent.get(rid) is not None else -1,
            round(point[0], 6) if point else None,
            round(point[1], 6) if point else None,
            sorted(area_children[rid]),
            sorted(area_sectors[rid]),
            max_rank - ranks[rid],
        ])

    sector_rows: list[list[object]] = []
    for crag in sorted(crags):
        point = group_point(crag)
        rock = crag_rock.get(crag)
        sector_rows.append([
            crag,
            rel_tags[crag].get("name", ""),
            crag_parent.get(crag, -1) if crag_parent.get(crag) is not None else -1,
            round(point[0], 6) if point else None,
            round(point[1], 6) if point else None,
            f"{rock[0]}/{rock[1]}" if rock else None,
            [problem_index[p] for p in crag_problems.get(crag, []) if p in problem_index],
        ])

    def rock_sector(key: tuple[str, int]) -> int | None:
        for crag, rock in crag_rock.items():
            if rock == key:
                return crag
        return None

    # ---- output: viewer index -----------------------------------------
    index_out.parent.mkdir(parents=True, exist_ok=True)
    with index_out.open("w") as f:
        json.dump({
            "version": 1,
            "maxRank": max_rank,
            "areas": area_rows,
            "sectors": sector_rows,
            "problems": problem_rows,
        }, f, ensure_ascii=False, separators=(",", ":"))

    # ---- output: sector/area label points -----------------------------
    features = []
    for rid, name, rank, _parent, lon, lat, children, sectors, band in area_rows:
        if lon is None:
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "name": name,
                "climbing": "area",
                "kind": "area",
                "osm_id": rid,
                "osm_type": "relation",
                "rank": rank,
                "band": band,
                "area_count": len(children),
                "sector_count": len(sectors),
            },
        })
    for crag, name, parent, lon, lat, rock, problem_indices in sector_rows:
        if lon is None:
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "name": name,
                "climbing": "crag",
                "kind": "sector",
                "osm_id": crag,
                "osm_type": "relation",
                "rank": ranks.get(parent, 0) + 1,
                "problem_count": len(problem_indices),
                "has_rock": 1 if rock else 0,
            },
        })
    sectors_out.parent.mkdir(parents=True, exist_ok=True)
    with sectors_out.open("w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f)

    # ---- output: physical rock geometry -------------------------------
    def ring(points: list[tuple[float, float]]) -> list[list[float]]:
        closed = [list(p) for p in points]
        if closed and closed[0] != closed[-1]:
            closed.append(list(closed[0]))
        return closed

    def way_ring(wid: int) -> list[list[float]] | None:
        ids = way_nodes.get(wid, [])
        if len(ids) < 4:
            return None
        coords = [node_coords[i] for i in ids if i in node_coords]
        if len(coords) < 4:
            return None
        return ring(coords)

    rock_features = []
    for key in sorted(rocks):
        mtype, mid = key
        props = {
            "name": (node_tags if mtype == "n" else way_tags if mtype == "w" else rel_tags).get(mid, {}).get("name", ""),
            "osm_type": {"n": "node", "w": "way", "r": "relation"}[mtype],
            "osm_id": mid,
            "sector": rock_sector(key) if rock_sector(key) is not None else -1,
        }
        if mtype == "n":
            if mid in node_coords:
                lon, lat = node_coords[mid]
                rock_features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": props})
        elif mtype == "w":
            r = way_ring(mid)
            if r:
                rock_features.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [r]}, "properties": props})
        else:
            outers: list[list[list[float]]] = []
            inners: list[list[list[float]]] = []
            for mmtype, mmid, role in rel_members.get(mid, []):
                if mmtype != "w":
                    continue
                r = way_ring(mmid)
                if not r:
                    continue
                (inners if role == "inner" else outers).append(r)
            if not outers:
                p = group_point(mid)
                if p:
                    rock_features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(p[0], 6), round(p[1], 6)]}, "properties": props})
                continue
            polygons = [[o] for o in outers]
            if len(polygons) == 1:
                polygons[0].extend(inners)
                geom = {"type": "Polygon", "coordinates": polygons[0]}
            else:
                geom = {"type": "MultiPolygon", "coordinates": polygons}
            rock_features.append({"type": "Feature", "geometry": geom, "properties": props})

    boulders_out.parent.mkdir(parents=True, exist_ok=True)
    with boulders_out.open("w") as f:
        json.dump({"type": "FeatureCollection", "features": rock_features}, f)

    # ---- summary -------------------------------------------------------
    orphans = sum(1 for row in sector_rows if row[2] == -1)
    loose = sum(1 for row in problem_rows if row[2] == -1)
    print(
        f"wrote {len(area_rows)} areas (max rank {max_rank}), {len(sector_rows)} boulders "
        f"({orphans} without an area), {len(problem_rows)} problems ({loose} without a boulder), "
        f"{len(rock_features)} rocks -> {index_out}, {sectors_out}, {boulders_out}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
