# ImHex Data Processor — Built-in Node Catalog

This is a categorized reference of ImHex's **built-in** Data Processor node
`type` identifiers, grounded in the ImHex source tree
(`plugins/builtin/source/content/data_processor_nodes/*.cpp`) and cross-checked
against real `.hexnode` files.

> ### ⚠️ Version caveat — read this first
> ImHex registers these nodes in C++; the exact set and their `type` strings
> **change between versions**. The tables below reflect the `master` branch at
> the time of writing and are meant as a practical reference, **not** a frozen
> spec. To get the *authoritative, exhaustive* list for **your** build, run
> `scripts/extract_nodes.py` against an ImHex source checkout (see the end of
> this file) — it parses the registrations directly. When a `type` fails to
> load, place the node manually in ImHex and **Save** to capture the exact id.

## How `type` / `name` map into a `.hexnode`

Each node in a `.hexnode` stores:

- `type` → the identifier, e.g. `hex.builtin.nodes.bitwise.xor`
- `name` → usually the same id plus `.header`, e.g. `hex.builtin.nodes.bitwise.xor.header`

Source files are grouped by category; the `type` prefix mirrors the category
(e.g. `arithmetic.*` lives in `math_nodes.cpp`).

---

## 1. Constants — `basic_nodes.cpp`

Start nodes that emit a fixed value. No inputs.

| `type` | Node | Output | `data` payload |
|--------|------|--------|----------------|
| `hex.builtin.nodes.constants.int` | Integer | Integer | `input`: math expression (`i128`, e.g. `0x41`, `1 << 8`) |
| `hex.builtin.nodes.constants.float` | Float | Float | `input`: expression |
| `hex.builtin.nodes.constants.nullptr` | Nullptr | Buffer (empty) | — |
| `hex.builtin.nodes.constants.buffer` | Buffer | Buffer | `size` + hex string |
| `hex.builtin.nodes.constants.string` | String | Buffer | string text |
| `hex.builtin.nodes.constants.rgba8` | Color (RGBA8) | Integer×4 / Buffer | color value *(verify key per version)* |

> The Integer node runs a **math evaluator**, so its value field accepts full
> expressions with `+ - * / & | ^ ~ << >>` and functions like `sin/cos/tan`.

## 2. Arithmetic — `math_nodes.cpp`

Two Integer inputs (`a`, `b`) → one Integer output, unless noted.

| `type` | Node | Notes |
|--------|------|-------|
| `hex.builtin.nodes.arithmetic.add` | Add | `a + b` |
| `hex.builtin.nodes.arithmetic.sub` | Subtract | `a - b` |
| `hex.builtin.nodes.arithmetic.mul` | Multiply | `a * b` |
| `hex.builtin.nodes.arithmetic.div` | Divide | throws **Division by zero** if `b == 0` |
| `hex.builtin.nodes.arithmetic.mod` | Modulo | `a % b` |

## 3. Control flow — `control_nodes.cpp`

| `type` | Node | Inputs → Output |
|--------|------|-----------------|
| `hex.builtin.nodes.control_flow.if` | If | Integer `condition`, Buffer `true`, Buffer `false` → Buffer |
| `hex.builtin.nodes.control_flow.equals` | Equals | Integer `a`, `b` → Integer (1/0) |
| `hex.builtin.nodes.control_flow.gt` | Greater Than | Integer `a`, `b` → Integer |
| `hex.builtin.nodes.control_flow.lt` | Less Than | Integer `a`, `b` → Integer |
| `hex.builtin.nodes.control_flow.not` | Boolean Not | Integer → Integer |
| `hex.builtin.nodes.control_flow.and` | Boolean And | Integer `a`, `b` → Integer *(verify)* |
| `hex.builtin.nodes.control_flow.or` | Boolean Or | Integer `a`, `b` → Integer *(verify)* |

## 4. Bitwise — `logic_nodes.cpp`

Operate on Buffers (bytewise).

| `type` | Node |
|--------|------|
| `hex.builtin.nodes.bitwise.and` | Bitwise AND |
| `hex.builtin.nodes.bitwise.or` | Bitwise OR |
| `hex.builtin.nodes.bitwise.xor` | Bitwise XOR |
| `hex.builtin.nodes.bitwise.not` | Bitwise NOT |
| `hex.builtin.nodes.bitwise.shl` | Shift Left *(verify key)* |
| `hex.builtin.nodes.bitwise.shr` | Shift Right *(verify key)* |

## 5. Decode — `decode_nodes.cpp`

Buffer in → Buffer out.

| `type` | Node |
|--------|------|
| `hex.builtin.nodes.decode.base64` | Base64 Decode |
| `hex.builtin.nodes.decode.hex` | Hex Decode |
| `hex.builtin.nodes.decode.url` | URL Decode *(verify)* |

## 6. Data access, buffer ops, casting, crypto — `other_nodes.cpp`

### Data access (`data_access.*`)

| `type` | Node | Role |
|--------|------|------|
| `hex.builtin.nodes.data_access.read` | Read Data | **Start** node → Buffer (reads from the provider) |
| `hex.builtin.nodes.data_access.write` | Write Data | **End** node ← Buffer (writes overlay to the editor) |
| `hex.builtin.nodes.data_access.selection` | Selection | current selection offset/size *(verify)* |

### Buffer operations (`buffer.*`)

| `type` | Node | Role |
|--------|------|------|
| `hex.builtin.nodes.buffer.size` | Buffer Size | Buffer → Integer (length) |
| `hex.builtin.nodes.buffer.repeat` | Repeat Buffer | Buffer + count → Buffer |
| `hex.builtin.nodes.buffer.combine` | Combine Buffers | Buffer + Buffer → Buffer |
| `hex.builtin.nodes.buffer.slice` | Slice Buffer | Buffer + from/size → Buffer |
| `hex.builtin.nodes.buffer.patch` | Patch | overwrite a region *(verify)* |

### Casting (`casting.*`)

| `type` | Node |
|--------|------|
| `hex.builtin.nodes.casting.integer_to_buffer` | Integer → Buffer |
| `hex.builtin.nodes.casting.buffer_to_integer` | Buffer → Integer |
| `hex.builtin.nodes.casting.float_to_buffer` | Float → Buffer |
| `hex.builtin.nodes.casting.buffer_to_float` | Buffer → Float |
| `hex.builtin.nodes.casting.endian` | Byte-swap / endianness |

> Exact casting leaf keys vary by version — regenerate with the script to be sure.

### Crypto & hashing (`crypto.*`)

| `type` | Node |
|--------|------|
| `hex.builtin.nodes.crypto.aesDecrypt` | AES Decrypt |
| `hex.builtin.nodes.crypto.crc` | CRC checksum |
| `hex.builtin.nodes.crypto.md5` / `.sha1` / `.sha256` | Hashes *(verify keys)* |

## 7. Visualizers / Display — `visual_nodes.cpp`

Terminal/preview nodes that render their input rather than transform it
(e.g. image, byte distribution, entropy/digram). Leaf `type` keys differ
noticeably between versions — **regenerate** rather than hand-copy these.

## 8. Custom node I/O — `hex.builtin.nodes.custom.*`

When you **save a node graph as a reusable custom node**, ImHex wraps its
external pins with these:

| `type` | Role |
|--------|------|
| `hex.builtin.nodes.custom.input` | A named external **input** pin of the custom node |
| `hex.builtin.nodes.custom.output` | A named external **output** pin of the custom node |

Their `data` carries `{ "name": "...", "type": <0=Int,1=Float,2=Buffer> }`.
This is why community `.hexnode` files (e.g. a reusable XOR) contain
`custom.input` / `custom.output` boxes instead of `data_access.read/write`.

---

## Regenerating the exhaustive list for your version

`scripts/extract_nodes.py` parses a local ImHex checkout and prints every
registered node `type` grouped by source file — the ground truth for your build:

```bash
# 1. Get the source at the version you run
git clone --depth 1 https://github.com/WerWolv/ImHex

# 2. Extract every node type from the data processor sources
python scripts/extract_nodes.py ImHex/plugins/builtin/source/content/data_processor_nodes

# Optional: emit a markdown table
python scripts/extract_nodes.py ImHex/plugins/builtin/source/content/data_processor_nodes --markdown
```

The script keys off the `Node("hex.builtin.nodes.….header", { dp::Attribute(...) })`
constructor calls, so it stays correct even as nodes are added or renamed.
