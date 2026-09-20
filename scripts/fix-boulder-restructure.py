#!/usr/bin/env python3
"""Repair the partially-applied boulder restructure.

The first changeset contained a bug: when a sector held problems from several
boulders, only the last boulder was wired into the sector and only its problems
were removed. As a result, most problems are still direct members of their
sector *and* members of a new `climbing=boulder` relation, and most boulder
relations never got a parent.

This script compares the pre-migration snapshot ("old") with the current OSM
data ("new"), re-derives the intended hierarchy, and emits an .osc that:

  * removes every problem (and physical way) that belongs to a created boulder
    relation from the sector/area that still holds it directly, and
  * adds each created boulder relation to that sector/area.

Input : two OPL files (produced with `osmium cat -f opl <pbf>`) as arguments:
        <old-pre-migration.opl> <new-current.opl>
Output: the .osc path (default: changes/bouldering-restructure-fix.osc)
"""
from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

DEFAULT_OUT = Path("changes/bouldering-restructure-fix.osc")

# Must match scripts/generate-boulder-restructure.py.
REGIONS = [
    (46.42, 8.84, 46.44, 8.86),   # Ticino — Verzasca/Chironico
    (46.55, 8.54, 46.68, 8.59),   # Uri — Schöllenen/Gotthard
    (47.06, 9.18, 47.12, 9.22),   # Glarus — Walensee/Murg
]


def opl_decode(s: str) -> str:
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
            try:
                out.append(chr(int(s[i + 1 : j], 16)))
            except ValueError:
                out.append(s[i + 1 : j])
            i = j + 1
        else:
            out.append(c)
            i += 1
    return "".join(out)


def parse_tags(s: str) -> dict[str, str]:
    tags: dict[str, str] = {}
    for part in s.split(","):
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


def parse_members(s: str) -> list[tuple[str, int, str]]:
    members: list[tuple[str, int, str]] = []
    for part in s.split(","):
        if not part or "@" not in part:
            continue
        ref, role = part.split("@", 1)
        if ref and ref[0] in {"n", "w", "r"} and ref[1:].isdigit():
            members.append((ref[0], int(ref[1:]), opl_decode(role)))
    return members


def version_of(line: str) -> int | None:
    for token in line.split(" "):
        if token.startswith("v") and token[1:].isdigit():
            return int(token[1:])
    return None


def point_in_ring(point: tuple[float, float], ring: list[tuple[float, float]]) -> bool:
    x, y = point
    inside = False
    for i in range(len(ring) - 1):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        if (y1 > y) != (y2 > y):
            if x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                inside = not inside
    return inside


def xml(s: str) -> str:
    return (
        s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        .replace('"', "&quot;").replace("'", "&apos;")
    )


def load(path: str) -> tuple[dict, dict, dict, dict]:
    coords: dict[int, tuple[float, float]] = {}
    node_tags: dict[int, dict[str, str]] = {}
    ways: dict[int, dict] = {}
    rels: dict[int, dict] = {}
    for line in open(path):
        line = line.rstrip("\n")
        if not line:
            continue
        otype = line[0]
        oid_str = line[1:].split(" ", 1)[0]
        if not oid_str.isdigit():
            continue
        oid = int(oid_str)
        if otype == "n":
            tags, _ = split_tags(line, "x")
            node_tags[oid] = tags
            if " x" in line and " y" in line:
                _, _, xy = line.rpartition(" x")
                lon_str, _, lat_str = xy.partition(" y")
                try:
                    coords[oid] = (float(lon_str), float(lat_str))
                except ValueError:
                    pass
        elif otype == "w":
            tags, rest = split_tags(line, "N")
            ways[oid] = {
                "nodes": [int(t[1:]) for t in rest.split(",") if len(t) > 1 and t[1:].isdigit()],
                "tags": tags,
                "version": version_of(line),
            }
        elif otype == "r":
            tags, rest = split_tags(line, "M")
            rels[oid] = {
                "members": parse_members(rest),
                "tags": tags,
                "version": version_of(line),
            }
    return coords, node_tags, ways, rels


def way_centroid(way: dict, coords: dict) -> tuple[float, float] | None:
    pts = [coords[n] for n in way["nodes"] if n in coords]
    if not pts:
        return None
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def in_regions(lon: float, lat: float) -> bool:
    return any(south <= lat <= north and west <= lon <= east for south, west, north, east in REGIONS)


def serialize_relation(rid: int, version: int | None, members: list[tuple[str, int, str]], tags: dict[str, str]) -> str:
    member_types = {"n": "node", "w": "way", "r": "relation"}
    attrs = f'id="{rid}"'
    if version is not None:
        attrs += f' version="{version}"'
    lines = [f"    <relation {attrs}>"]
    for mtype, ref, role in members:
        lines.append(f'      <member type="{member_types[mtype]}" ref="{ref}" role="{xml(role)}" />')
    for key in sorted(tags):
        lines.append(f'      <tag k="{xml(key)}" v="{xml(tags[key])}" />')
    lines.append("    </relation>")
    return "\n".join(lines)


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit("usage: fix-boulder-restructure.py <old.opl> <new.opl> [out.osc]")
    out_path = Path(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_OUT

    ocoords, onodes, oways, orels = load(sys.argv[1])
    _, _, nways, nrels = load(sys.argv[2])

    # --- Re-derive the intended assignments from the pre-migration snapshot ---
    route_nodes = {oid for oid, t in onodes.items() if t.get("climbing") == "route_bottom"}
    boulder_ways = {
        oid: w for oid, w in oways.items()
        if w["tags"].get("climbing") == "boulder"
        and w["tags"].get("natural") in {"bare_rock", "stone"}
        and w["tags"].get("sport") == "climbing"
        and (c := way_centroid(w, ocoords)) is not None
        and in_regions(*c)
    }

    problem_boulder: dict[int, int] = {}
    boulder_problems: dict[int, set[int]] = defaultdict(set)
    for wid in sorted(boulder_ways):
        ids = boulder_ways[wid]["nodes"]
        ids_set = set(ids)
        ring = [ocoords[n] for n in ids if n in ocoords]
        closed = len(ids) >= 4 and ids[0] == ids[-1]
        for pid in sorted(route_nodes):
            if pid in problem_boulder or pid not in ocoords:
                continue
            if pid in ids_set or (closed and len(ring) >= 4 and point_in_ring(ocoords[pid], ring)):
                problem_boulder[pid] = wid
                boulder_problems[wid].add(pid)

    # --- Match each intended boulder to its real relation in the current data ---
    real_id: dict[int, int] = {}
    unmatched: list[int] = []
    new_boulder_rels = {
        rid: r for rid, r in nrels.items()
        if r["tags"].get("climbing") == "boulder" and r["tags"].get("type") == "site"
    }
    for wid, probs in boulder_problems.items():
        signature = frozenset(probs)
        for rid, r in new_boulder_rels.items():
            node_sig = frozenset(ref for ty, ref, _ in r["members"] if ty == "n")
            has_way = any(ty == "w" and ref == wid for ty, ref, _ in r["members"])
            if node_sig == signature and has_way:
                real_id[wid] = rid
                break
        if wid not in real_id:
            unmatched.append(wid)

    # --- Rebuild each parent's correct member list from the current state ---
    bouldering_parents_old = {
        oid: r for oid, r in orels.items()
        if r["tags"].get("type") == "site"
        and r["tags"].get("climbing:boulder") == "yes"
        and r["tags"].get("climbing") in {"crag", "area"}
    }

    changes: list[tuple[int, int | None, list[tuple[str, int, str]], dict[str, str]]] = []
    stats: list[str] = []
    for prid in sorted(bouldering_parents_old):
        old_members = orels[prid]["members"]
        assigned_in_parent = {ref for ty, ref, _ in old_members if ty == "n" and ref in problem_boulder}
        if not assigned_in_parent:
            continue
        current = nrels.get(prid)
        if not current:
            continue

        boulders = {problem_boulder[p] for p in assigned_in_parent if problem_boulder[p] in real_id}
        remove_nodes = {p for p in assigned_in_parent if problem_boulder[p] in real_id}
        remove_ways = {wid for wid in boulders if wid in nways}
        add_rels = {real_id[wid] for wid in boulders}

        new_members = [
            m for m in current["members"]
            if not (m[0] == "n" and m[1] in remove_nodes)
            and not (m[0] == "w" and m[1] in remove_ways)
        ]
        for rid in sorted(add_rels):
            if not any(m[0] == "r" and m[1] == rid for m in new_members):
                new_members.append(("r", rid, ""))

        if new_members != current["members"]:
            changes.append((prid, current["version"], new_members, current["tags"]))
            removed = sum(1 for m in current["members"] if m not in new_members)
            stats.append(f"  {current['tags'].get('name', prid)} ({prid}): add {len(add_rels)} boulder relations, remove {removed} members")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        f.write('<osmChange version="0.6" generator="OpenBoulderMap boulder-restructure-fix">\n')
        if changes:
            f.write("  <modify>\n")
            for prid, version, members, tags in changes:
                f.write(serialize_relation(prid, version, members, tags) + "\n")
            f.write("  </modify>\n")
        f.write("</osmChange>\n")

    print(f"wrote {out_path}")
    print(f"  boulders matched to real relations: {len(real_id)}/{len(boulder_problems)}")
    if unmatched:
        print(f"  WARNING unmatched boulder ways: {unmatched[:10]}", file=sys.stderr)
    print(f"  parent relations to repair: {len(changes)}")
    for line in stats:
        print(line)


if __name__ == "__main__":
    main()
