#!/usr/bin/env python3
"""Generate a worldwide .osc that inserts the boulder level into the hierarchy.

New model:

    problem  node     climbing=route_bottom
      -> boulder relation  type=site + climbing=boulder + climbing:boulder=yes
        -> sector  relation type=site + climbing=crag   + climbing:boulder=yes
          -> area  relation type=site + climbing=area   + climbing:boulder=yes

Only problems that can be *confidently* assigned to an already-mapped physical
boulder are restructured. A problem is assigned when:

  * the route_bottom node is a vertex of a `climbing=boulder` way, or
  * the node lies strictly inside the closed `climbing=boulder` polygon.

For each such boulder a new `type=site` relation is created whose members are
the physical way plus the assigned problems. The problems are removed from any
bouldering sector/area relation that directly contained them, and the new
boulder relation is added to that parent instead.

Problems that are not on a mapped boulder are left exactly as they are. This is
deliberate: a boulder is a physical object and cannot be invented from
coordinates.

Input : OPL text on stdin (produced by
        `osmium cat -f opl data/climbing-filtered.osm.pbf`)
Output: the .osc path given as the first argument
        (default: changes/bouldering-restructure.osc)
"""
from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

DEFAULT_OUT = Path("changes/bouldering-restructure.osc")


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
            x_cross = (x2 - x1) * (y - y1) / (y2 - y1) + x1
            if x < x_cross:
                inside = not inside
    return inside


def xml(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def serialize_relation(rid: int, version: int | None, members: list[tuple[str, int, str]], tags: dict[str, str], created: bool) -> str:
    member_types = {"n": "node", "w": "way", "r": "relation"}
    attrs = f'id="{rid}"'
    if not created and version is not None:
        attrs += f' version="{version}"'
    lines = [f"    <relation {attrs}>"]
    for mtype, ref, role in members:
        lines.append(f'      <member type="{member_types[mtype]}" ref="{ref}" role="{xml(role)}" />')
    for key in sorted(tags):
        lines.append(f'      <tag k="{xml(key)}" v="{xml(tags[key])}" />')
    lines.append("    </relation>")
    return "\n".join(lines)


def main() -> None:
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT

    node_coords: dict[int, tuple[float, float]] = {}
    node_tags: dict[int, dict[str, str]] = {}
    ways: dict[int, dict] = {}
    rels: dict[int, dict] = {}

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
            tags, _ = split_tags(line, "x")
            node_tags[oid] = tags
            if " x" in line and " y" in line:
                _, _, xy = line.rpartition(" x")
                lon_str, _, lat_str = xy.partition(" y")
                try:
                    node_coords[oid] = (float(lon_str), float(lat_str))
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

    route_nodes = {oid: t for oid, t in node_tags.items() if t.get("climbing") == "route_bottom"}

    # Restrict the mechanical edit to the three Swiss regions being worked on.
    # (south, west, north, east)
    REGIONS = [
        (46.42, 8.84, 46.44, 8.86),   # Ticino — Verzasca/Chironico
        (46.55, 8.54, 46.68, 8.59),   # Uri — Schöllenen/Gotthard
        (47.06, 9.18, 47.12, 9.22),   # Glarus — Walensee/Murg
    ]

    def way_centroid(way: dict) -> tuple[float, float] | None:
        pts = [node_coords[n] for n in way["nodes"] if n in node_coords]
        if not pts:
            return None
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))

    def in_regions(lon: float, lat: float) -> bool:
        return any(south <= lat <= north and west <= lon <= east for south, west, north, east in REGIONS)

    boulder_ways = {
        oid: w for oid, w in ways.items()
        if w["tags"].get("climbing") == "boulder"
        and w["tags"].get("natural") in {"bare_rock", "stone"}
        and w["tags"].get("sport") == "climbing"
        and (c := way_centroid(w)) is not None
        and in_regions(*c)
    }
    # Sector or area relations that currently hold problems directly.
    bouldering_parents = {
        oid: r for oid, r in rels.items()
        if r["tags"].get("type") == "site"
        and r["tags"].get("climbing:boulder") == "yes"
        and r["tags"].get("climbing") in {"crag", "area"}
    }

    # Assign each problem to at most one physical boulder.
    boulder_problems: dict[int, set[int]] = defaultdict(set)
    problem_boulder: dict[int, int] = {}
    warnings: list[str] = []

    for wid in sorted(boulder_ways):
        way = boulder_ways[wid]
        ids = way["nodes"]
        ids_set = set(ids)
        ring = [node_coords[n] for n in ids if n in node_coords]
        closed = len(ids) >= 4 and ids[0] == ids[-1]

        for pid in sorted(route_nodes):
            if pid in problem_boulder or pid not in node_coords:
                continue
            assigned = False
            if pid in ids_set:
                assigned = True
            elif closed and len(ring) >= 4 and point_in_ring(node_coords[pid], ring):
                assigned = True
            if assigned:
                problem_boulder[pid] = wid
                boulder_problems[wid].add(pid)

    creates: list[tuple[int, list[tuple[str, int, str]], dict[str, str]]] = []
    modifies: list[tuple[int, int | None, list[tuple[str, int, str]], dict[str, str]]] = []
    parent_of_boulder: dict[int, set[int]] = defaultdict(set)
    boulder_neg: dict[int, int] = {}

    for i, wid in enumerate(sorted(boulder_problems)):
        neg_id = -(i + 1)
        boulder_neg[wid] = neg_id
        pids = boulder_problems[wid]
        way = boulder_ways[wid]

        tags: dict[str, str] = {
            "type": "site",
            "climbing": "boulder",
            "climbing:boulder": "yes",
            "sport": "climbing",
        }
        if way["tags"].get("name"):
            tags["name"] = way["tags"]["name"]

        members: list[tuple[str, int, str]] = [("w", wid, "")]
        members += [("n", pid, "") for pid in sorted(pids)]
        creates.append((neg_id, members, tags))

        # Find bouldering parents that directly contain the assigned problems.
        for pid in pids:
            for prid, rel in bouldering_parents.items():
                if any(m[0] == "n" and m[1] == pid for m in rel["members"]):
                    parent_of_boulder[wid].add(prid)

        if len(parent_of_boulder[wid]) > 1:
            warnings.append(
                f"boulder way {wid} has problems in multiple parents {sorted(parent_of_boulder[wid])}; "
                f"the new boulder relation will be added to all of them"
            )

    # Build the <modify> entries for each affected parent relation. A parent can
    # contain problems from several boulders, so accumulate on top of the members
    # already modified by earlier boulders instead of overwriting them.
    modified_parents: dict[int, dict] = {}
    for wid, prid_set in parent_of_boulder.items():
        neg_id = boulder_neg[wid]
        for prid in prid_set:
            rel = rels[prid]
            entry = modified_parents.get(prid)
            base_members = entry["members"] if entry else rel["members"]
            remove_nodes = boulder_problems[wid]
            remove_ways = {wid}
            new_members = [
                m for m in base_members
                if not (m[0] == "n" and m[1] in remove_nodes)
                and not (m[0] == "w" and m[1] in remove_ways)
            ]
            if ("r", neg_id, "") not in new_members:
                new_members.append(("r", neg_id, ""))
            modified_parents[prid] = {
                "members": new_members,
                "tags": rel["tags"],
                "version": rel["version"],
            }

    for prid in sorted(modified_parents):
        m = modified_parents[prid]
        modifies.append((prid, m["version"], m["members"], m["tags"]))

    # Serialize.
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        f.write('<osmChange version="0.6" generator="OpenBoulderMap boulder-restructure">\n')
        if creates:
            f.write("  <create>\n")
            for neg_id, members, tags in creates:
                f.write(serialize_relation(neg_id, None, members, tags, created=True) + "\n")
            f.write("  </create>\n")
        if modifies:
            f.write("  <modify>\n")
            for prid, version, members, tags in modifies:
                f.write(serialize_relation(prid, version, members, tags, created=False) + "\n")
            f.write("  </modify>\n")
        f.write("</osmChange>\n")

    assigned = sum(len(p) for p in boulder_problems.values())
    print(f"wrote {out_path}")
    print(f"  physical boulders with problems: {len(boulder_problems)}")
    print(f"  problems assigned to boulders:   {assigned}")
    print(f"  created boulder relations:       {len(creates)}")
    print(f"  modified parent relations:       {len(modifies)}")
    for warning in warnings:
        print(f"  warning: {warning}", file=sys.stderr)


if __name__ == "__main__":
    main()
