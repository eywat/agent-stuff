---
name: hexnode
description: "Use this skill whenever the user wants to create, read, edit, or understand ImHex Data Processor node-graph files (.hexnode files). Triggers include: any mention of \".hexnode\", \"ImHex data processor\", \"ImHex node graph\", \"node editor\" in the context of ImHex, or requests to build/modify a visual data pre-processing pipeline for ImHex (XOR, Base64, AES, gzip, CRC, endianness swaps, etc.). Also use when serializing a node layout to JSON, adding nodes/links, or explaining how a .hexnode file maps to the on-screen node graph. Do NOT use for .hexpat Pattern Language files (those parse binary formats and are a different skill), nor for unrelated hex-editing tasks."
license: Proprietary.
---

# ImHex `.hexnode` file creation, editing, and analysis

## Overview

The **ImHex Data Processor** is a node-based visual scripting engine that
pre-processes bytes before they are displayed or read by the rest of ImHex
(e.g. XORing every byte with `0x41` before showing it in the Editor).

A **`.hexnode`** file is the **JSON serialization of a Data Processor node
graph**. It stores three things:

1. The **nodes** placed on the canvas (type, id, position, per-node data).
2. The **attributes** (the input/output pins on each node).
3. The **links** (wires) connecting one node's output pin to another's input pin.

These files live in the `nodes/` folder of an ImHex configuration directory and
in the `nodes/` folder of the official `ImHex-Patterns` repository.

> ⚠️ **Reliability note.** The `.hexnode` JSON schema and the built-in node
> `type` identifiers are ImHex **internal** details that can shift between
> versions. The *guaranteed-valid* way to produce a file for a specific build
> is to place the nodes in the Data Processor view and use **Save**. Treat
> hand-written `.hexnode` files (including from this skill) as templates:
> generate, then verify by loading them in the target ImHex version.

## Quick Reference

| Task | Approach |
|------|----------|
| Understand a `.hexnode` | Parse the JSON: read the `nodes` map, then follow the `links` map |
| Look up a node `type` | See **`NODES.md`** (full catalog) |
| Get the exact list for your build | Run **`scripts/extract_nodes.py`** on an ImHex checkout |
| Create a new graph | Start from `examples/`, renumber ids/attrs, rewire `links` |
| Validate | `python -m json.tool file.hexnode`, then load in ImHex |
| Install | Copy into ImHex config `nodes/` folder (paths below) |

### Install / config locations

| OS | Path |
|----|------|
| Windows | `%APPDATA%\ImHex\nodes\` |
| Linux | `~/.local/share/imhex/nodes/` |
| macOS | `~/Library/Application Support/imhex/nodes/` |

---

## File structure

A `.hexnode` file is a single JSON object with two top-level members,
**`nodes`** and **`links`**. Both are **objects (maps) keyed by stringified id**
— *not* arrays. (This matches how ImHex actually serializes graphs; see the
real files under `nodes/` in the ImHex-Patterns repo.)

```json
{
    "nodes": {
        "1": { ... },
        "3": { ... }
    },
    "links": {
        "500": { ... }
    }
}
```

### The `nodes` map

Each value describes one node on the canvas. The map key is the node's `id` as
a string.

```json
"3": {
    "id": 3,
    "type": "hex.builtin.nodes.bitwise.xor",
    "name": "hex.builtin.nodes.bitwise.xor.header",
    "pos": { "x": 380.0, "y": 180.0 },
    "attrs": [ 300, 301, 302 ],
    "data": null
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `id` | int | Unique node id (also used as the map key, as a string). |
| `type` | string | The **built-in node identifier**. Determines behavior and pin layout. |
| `name` | string | Header/localization key — usually `<type>.header`. May be a plain string for custom nodes. |
| `pos` | `{x, y}` floats | Canvas position, purely cosmetic. |
| `attrs` | int[] | **Ordered** list of attribute (pin) ids; order defines pin index (inputs then outputs). |
| `data` | object \| null | Per-node saved settings (e.g. `{"input": "0x41"}` for a constant). `null` when the node has none. |

### The `links` map

Each value is one wire between two attribute ids. The map key is the link's
`id` as a string.

```json
"500": { "id": 500, "from": 100, "to": 300 }
```

| Field | Type | Meaning |
|-------|------|---------|
| `id` | int | Unique link id (also the map key, as a string). |
| `from` | int | The **output** attribute id (source). |
| `to` | int | The **input** attribute id (sink). |

> Some exported graphs (custom nodes saved for reuse) wrap the above inside an
> outer object with its own `attrs`/`data` and a nested
> `data.nodes.{nodes,links}`. The core `nodes`/`links` schema is identical.

**Rules that must hold:**

- Every `from`/`to` must reference an attribute id that appears in some node's
  `attrs` array.
- A link always goes **output → input** (source pin to sink pin).
- Pin types must match. There are three attribute types:
  - **Integer** (`i128`) — circular pins.
  - **Float** (`double`) — triangular pins.
  - **Buffer** (`std::vector<u8>`) — rectangular pins.
  You cannot wire a Buffer pin to an Integer pin, etc.

### Id conventions used in this skill

The numbers are arbitrary but must be **unique within their scope**. A tidy
scheme that keeps files readable:

- Node `id`: small ints `1, 2, 3, …`
- Attribute ids: block per node, e.g. node 1 → `100…`, node 2 → `200…`
- Link `id`: another block, e.g. `500…`

---

## Execution model (why wiring direction matters)

The Data Processor is **pull-based** with **lazy evaluation**:

- Execution begins at **End Nodes** — nodes with a side effect and no output
  pins, such as *Write Data* (writes an overlay back to the Hex Editor).
- The engine then **recursively requests data** from upstream inputs, only
  evaluating the nodes needed to produce that output.
- **Start Nodes** have no inputs (e.g. *Read Data*, constants).
- Cycles are detected to prevent infinite loops.

Practical consequence: a graph does nothing unless it terminates in an End Node
(typically *Write Data*). A chain that stops at a display node still needs a
sink to affect the editor.

---

## Built-in node identifiers

The full, categorized catalog of built-in node `type` ids — Constants,
Arithmetic, Control flow, Bitwise, Decode, Data access, Buffer ops, Casting,
Crypto, Visualizers, and Custom I/O — lives in **`NODES.md`** next to this file.

Because ImHex registers nodes in C++ and the set changes between versions, that
catalog is a practical reference, **not** a frozen spec. To generate the
*authoritative, exhaustive* list for the exact ImHex version you run, use the
included extractor against a source checkout:

```bash
git clone --depth 1 https://github.com/WerWolv/ImHex
python scripts/extract_nodes.py \
    ImHex/plugins/builtin/source/content/data_processor_nodes --markdown
```

It parses the `Node("hex.builtin.nodes.….header", { dp::Attribute(...) })`
registrations, so it stays correct as nodes are added or renamed.

### Most-used ids (quick reference)

| Purpose | `type` |
|---------|--------|
| Read data (start) | `hex.builtin.nodes.data_access.read` |
| Write data (end) | `hex.builtin.nodes.data_access.write` |
| Integer constant | `hex.builtin.nodes.constants.int` |
| Bitwise XOR | `hex.builtin.nodes.bitwise.xor` |
| Repeat / size buffer | `hex.builtin.nodes.buffer.repeat` / `hex.builtin.nodes.buffer.size` |
| Arithmetic | `hex.builtin.nodes.arithmetic.add` / `.sub` / `.mul` / `.div` / `.mod` |
| Base64 / Hex decode | `hex.builtin.nodes.decode.base64` / `hex.builtin.nodes.decode.hex` |
| Custom node pins | `hex.builtin.nodes.custom.input` / `hex.builtin.nodes.custom.output` |

> ⚠️ In older docs the XOR node was shown as `hex.builtin.nodes.buffer.xor`.
> In current ImHex it is `hex.builtin.nodes.bitwise.xor` — always confirm the
> id against your version (or regenerate with the script).

---

## Authoring workflow

1. **Sketch the pipeline** as a left→right chain ending in an End Node.
2. **List the nodes**; assign each a unique `id` and a block of attribute ids.
3. **Fill `attrs`** in inputs-then-outputs order for each node.
4. **Wire `links`** output→input, matching pin types.
5. **Set per-node `data`** (e.g. constant values).
6. **Validate JSON**: `python -m json.tool file.hexnode`.
7. **Load in ImHex** (target version) and confirm the graph renders + runs.
8. If a node mismatches, place it manually in ImHex, **Save**, and copy the
   exact `type`/`data` it emits.

---

## Worked example — Read → XOR → Write

Chain: **Read Data → Bitwise XOR → Write Data**, XORing the file against a
repeated key pad. See `examples/xor_decode.hexnode`. This uses the real
map-based schema and confirmed node ids (`data_access.read/write`,
`bitwise.xor`, `constants.int`, `buffer.repeat`).

```json
{
    "nodes": {
        "1": { "id": 1, "type": "hex.builtin.nodes.data_access.read",  "name": "hex.builtin.nodes.data_access.read.header",  "pos": {"x": 60,  "y": 140}, "attrs": [10, 11, 12], "data": null },
        "2": { "id": 2, "type": "hex.builtin.nodes.constants.int",     "name": "hex.builtin.nodes.constants.int.header",     "pos": {"x": 60,  "y": 320}, "attrs": [20],         "data": {"input": "0x41"} },
        "3": { "id": 3, "type": "hex.builtin.nodes.buffer.repeat",     "name": "hex.builtin.nodes.buffer.repeat.header",     "pos": {"x": 320, "y": 300}, "attrs": [30, 31, 32], "data": null },
        "4": { "id": 4, "type": "hex.builtin.nodes.bitwise.xor",       "name": "hex.builtin.nodes.bitwise.xor.header",       "pos": {"x": 600, "y": 200}, "attrs": [40, 41, 42], "data": null },
        "5": { "id": 5, "type": "hex.builtin.nodes.data_access.write", "name": "hex.builtin.nodes.data_access.write.header", "pos": {"x": 880, "y": 200}, "attrs": [50],         "data": null }
    ],
    "links": {
        "100": { "id": 100, "from": 12, "to": 40 },
        "101": { "id": 101, "from": 20, "to": 30 },
        "102": { "id": 102, "from": 32, "to": 41 },
        "103": { "id": 103, "from": 42, "to": 50 }
    }
}
```

> ⚠️ The **attribute ids and their order per node** (`attrs`) depend on how each
> node registers its pins in your ImHex version. The values above are a
> structurally-valid template. For a guaranteed-correct file, build the graph
> once in ImHex and **Save** — then reuse the exact `attrs`/`type` it emits.
> `bitwise.xor` takes two Buffer inputs, so a single-byte key is repeated to the
> data length via `buffer.repeat` before XORing.

---

## Validation checklist

- [ ] File is valid JSON (`python -m json.tool`).
- [ ] Top-level object has `nodes` and `links` **maps** (keyed by string id).
- [ ] Each map key equals its value's `id` (as a string).
- [ ] Every node `id` is unique; every attribute id is unique across the file.
- [ ] Every link `from`/`to` exists in some node's `attrs`.
- [ ] Links go output→input and pin **types match**.
- [ ] The graph ends in an End Node (e.g. *Write Data*).
- [ ] `type` ids exist in your ImHex version (cross-check with `NODES.md` /
      `scripts/extract_nodes.py`).
- [ ] Loads and runs in the **target** ImHex version.
