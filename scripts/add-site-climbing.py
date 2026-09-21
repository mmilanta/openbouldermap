#!/usr/bin/env python3
"""Add the missing `site=climbing`/`sport=climbing` tags to climbing site relations.

iD/OSM flags every `type=site` relation that carries no `site=*` or `sport=*` tag
("Climbing Crag has incomplete tags; suggested update: + site=climbing
+ sport=climbing"). The boulder restructure added the `type=site` relations
without those tags, so this fetches their *current* versions straight from the
OSM API and emits an .osc that only adds the missing tags. Everything else
(members, other tags, versions) is copied verbatim from the live data, so the
result uploads cleanly.

Input : relation ids. By default every positive relation id referenced by
        changes/*.osc is used.
Output: the .osc path given as the first argument
        (default: changes/bouldering-site-climbing-fix.osc)
"""
from __future__ import annotations

import glob
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

DEFAULT_OUT = Path("changes/bouldering-site-climbing-fix.osc")
API = "https://api.openstreetmap.org/api/0.6/relations"
BATCH = 50

MEMBER_TYPES = {"node": "n", "way": "w", "relation": "r"}


def xml(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def ids_from_changes() -> list[int]:
    ids: set[int] = set()
    for path in glob.glob("changes/*.osc"):
        for action in ET.parse(path).getroot():
            for rel in action.findall("relation"):
                rid = rel.get("id")
                if rid and int(rid) > 0:
                    ids.add(int(rid))
    return sorted(ids)


def fetch(ids: list[int]) -> list[ET.Element]:
    out: list[ET.Element] = []
    for i in range(0, len(ids), BATCH):
        chunk = ids[i : i + BATCH]
        query = urllib.parse.urlencode({"relations": ",".join(map(str, chunk))})
        req = urllib.request.Request(
            f"{API}?{query}",
            headers={"User-Agent": "OpenBoulderMap add-site-climbing (https://openbouldermap.org)"},
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            root = ET.fromstring(resp.read())
        out.extend(root.findall("relation"))
    return out


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    out_path = Path(args[0]) if args else DEFAULT_OUT
    ids = [int(a) for a in args[1:]] or ids_from_changes()
    if not ids:
        raise SystemExit("no relation ids to fix")

    def tag(rel: ET.Element, key: str) -> str | None:
        el = rel.find(f"tag[@k='{key}']")
        return el.get("v") if el is not None else None

    relations = fetch(ids)
    missing = [
        r for r in relations
        if r.get("visible") != "false"
        and tag(r, "type") == "site"
        and (tag(r, "site") is None or tag(r, "sport") is None)
    ]

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<osmChange version="0.6" generator="OpenBoulderMap add-site-climbing">',
        "  <modify>",
    ]
    for rel in sorted(missing, key=lambda r: int(r.get("id"))):
        rid = rel.get("id")
        lines.append(f'    <relation id="{rid}" version="{rel.get("version")}">')
        for member in rel.findall("member"):
            mtype = MEMBER_TYPES[member.get("type")]
            lines.append(
                f'      <member type="{member.get("type")}" ref="{member.get("ref")}" '
                f'role="{xml(member.get("role") or "")}" />'
            )
        tags = {t.get("k"): t.get("v") for t in rel.findall("tag")}
        tags["site"] = "climbing"
        tags["sport"] = "climbing"
        for key in sorted(tags):
            lines.append(f'      <tag k="{xml(key)}" v="{xml(tags[key])}" />')
        lines.append("    </relation>")
    lines.append("  </modify>")
    lines.append("</osmChange>")
    lines.append("")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines))

    for rel in sorted(missing, key=lambda r: int(r.get("id"))):
        name = tag(rel, "name") or ""
        climbing = tag(rel, "climbing") or ""
        added = ", ".join(k for k in ("site", "sport") if tag(rel, k) is None)
        print(f"  + {added}=climbing  {rel.get('id')} (v{rel.get('version')}, climbing={climbing}, name={name!r})")
    print(f"\n{len(missing)} of {len(relations)} relations fixed -> {out_path}")


if __name__ == "__main__":
    main()
