#!/usr/bin/env python3
"""
extract_nodes.py — Extract every built-in ImHex Data Processor node type
from an ImHex source checkout.

The exhaustive, authoritative list of Data Processor nodes lives in the ImHex
C++ source, not in any published doc, and it changes between versions. This
script parses the node registrations so you can regenerate an accurate catalog
for the exact ImHex version you run.

It works by scanning the data_processor_nodes/*.cpp files for the base-class
constructor calls of the form:

    Node("hex.builtin.nodes.<category>.<name>.header", { dp::Attribute(...), ... })

and reconstructs, per node:
    - the header key (and derived `type` id, i.e. header without ".header")
    - each attribute's IO direction (In/Out) and data type (Integer/Float/Buffer)

Usage:
    python extract_nodes.py <path-to-data_processor_nodes-dir> [--markdown]

Example:
    git clone --depth 1 https://github.com/WerWolv/ImHex
    python extract_nodes.py ImHex/plugins/builtin/source/content/data_processor_nodes
    python extract_nodes.py ImHex/plugins/builtin/source/content/data_processor_nodes --markdown
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# Matches: Node ( "….header" , {   ... first attribute block ...
NODE_RE = re.compile(
    r'Node\s*\(\s*"(?P<header>hex\.builtin\.nodes\.[a-zA-Z0-9_.]+?\.header)"\s*,\s*\{',
    re.DOTALL,
)

# Matches individual dp::Attribute(IOType::In|Out, Type::Integer|Float|Buffer, "label")
ATTR_RE = re.compile(
    r'dp::Attribute\s*\(\s*'
    r'dp::Attribute::IOType::(?P<io>In|Out)\s*,\s*'
    r'dp::Attribute::Type::(?P<type>Integer|Float|Buffer)\s*,\s*'
    r'"(?P<label>[^"]*)"',
)


def brace_slice(text: str, open_index: int) -> str:
    """Return the substring of the {...} block starting at text[open_index]=='{'."""
    depth = 0
    for i in range(open_index, len(text)):
        c = text[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[open_index : i + 1]
    return text[open_index:]


def parse_file(path: Path) -> list[dict]:
    src = path.read_text(encoding="utf-8", errors="replace")
    nodes: list[dict] = []
    for m in NODE_RE.finditer(src):
        header = m.group("header")
        block = brace_slice(src, m.end() - 1)  # m.end()-1 points at the '{'
        attrs = [
            {"io": a.group("io"), "type": a.group("type"), "label": a.group("label")}
            for a in ATTR_RE.finditer(block)
        ]
        nodes.append(
            {
                "header": header,
                "type": header[: -len(".header")],
                "category": header.split(".")[3] if len(header.split(".")) > 3 else "?",
                "attrs": attrs,
                "file": path.name,
            }
        )
    return nodes


def collect(directory: Path) -> list[dict]:
    files = sorted(directory.glob("*.cpp"))
    if not files:
        sys.exit(f"No .cpp files found in {directory}")
    out: list[dict] = []
    for f in files:
        out.extend(parse_file(f))
    return out


def fmt_attrs(attrs: list[dict]) -> str:
    ins = [f"{a['type']}" for a in attrs if a["io"] == "In"]
    outs = [f"{a['type']}" for a in attrs if a["io"] == "Out"]
    return f"in: {', '.join(ins) or '—'} | out: {', '.join(outs) or '—'}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("directory", type=Path, help="Path to data_processor_nodes/ directory")
    ap.add_argument("--markdown", action="store_true", help="Emit a Markdown table")
    args = ap.parse_args()

    nodes = collect(args.directory)
    nodes.sort(key=lambda n: (n["file"], n["type"]))

    if args.markdown:
        print("| `type` | Category | Pins | Source |")
        print("|--------|----------|------|--------|")
        for n in nodes:
            print(f"| `{n['type']}` | {n['category']} | {fmt_attrs(n['attrs'])} | {n['file']} |")
    else:
        current = None
        for n in nodes:
            if n["file"] != current:
                current = n["file"]
                print(f"\n=== {current} ===")
            print(f"  {n['type']}")
            print(f"      {fmt_attrs(n['attrs'])}")

    print(f"\nTotal nodes found: {len(nodes)}", file=sys.stderr)


if __name__ == "__main__":
    main()
