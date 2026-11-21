# Circuit format and ROBDD contract

## Version 1 circuit

A circuit has exactly `version`, `name`, `inputs`, `gates`, and `outputs`. `version` is 1. Names match `[a-z][a-z0-9_]{0,31}`. There are 1–32 unique inputs, at most 512 gates and 1–33 named outputs. An input can be unused. Gate names cannot duplicate inputs or prior gates. Constants are wire strings `"0"` and `"1"`; neither is a legal input or gate identifier.

```json
{
  "version": 1,
  "name": "example_mux",
  "inputs": ["select", "low", "high"],
  "gates": [{ "id": "g0", "op": "mux", "args": ["select", "low", "high"] }],
  "outputs": [{ "name": "out", "wire": "g0" }]
}
```

Each gate has exactly `id`, `op`, and `args`. Legal operations and argument meanings:

| Operation | Arity | Boolean meaning |
| --- | ---: | --- |
| `not` | 1 | `!arg0` |
| `and` | 2 | `arg0 && arg1` |
| `or` | 2 | `arg0 || arg1` |
| `xor` | 2 | `arg0 !== arg1` |
| `mux` | 3 | `arg0 ? arg2 : arg1` (select, low, high) |

Arguments must reference constants, inputs or earlier gates. This representation rejects forward references and cycles rather than topologically sorting a general graph. Output objects have exactly `name` and `wire`; names are unique, and each wire must already exist. Multiple outputs may share a wire.

The parser accepts formatting whitespace but requires JSON token spelling to round-trip through `JSON.stringify`. Duplicate keys and alternate token encodings are rejected. Object field order is not prescribed. Files are limited to 262,144 UTF-8 bytes. The CLI checks size before loading, and the parser checks string byte length. This is intentionally a small custom format, not Verilog/VHDL/BLIF support or arbitrary JSON interoperability.

Assignments contain exactly every input name once as an object key, with Boolean values. Extra/missing inputs and numeric 0/1 instead of booleans are invalid.

## Manager invariants

An order is an exact input permutation with no duplicates. All functions compiled into a manager use it. IDs 0 and 1 represent false and true. Nonterminals have:

```text
id: manager-local integer >= 2
level: index into the manager's variable order
low: root after setting this variable false
high: root after setting this variable true
```

Every nonterminal child is at a strictly greater level. Equal children return that child directly. The unique table identifies `(level, low, high)` and ensures no duplicate nonterminal triples in one manager. A manager does not expose raw node creation.

`apply` supports commutative AND, OR and XOR. It normalizes operand IDs, applies terminal identities, consults a computed cache, recursively co-factors on the earlier operand level, and reconstructs through the unique table. Complement is XOR with terminal 1. Mux uses separate AND/OR/NOT operations. There are no complement-tagged edges or dynamic reordering.

Numbers are manager-local handles, not globally meaningful function identifiers. Out-of-range IDs fail; a coincident numeric handle from another manager cannot be detected. The caller must keep handles with their originating manager.

## Comparison result

Input sets and output-name sets must be identical. Output array position is irrelevant. Construct `d[name]=XOR(left[name],right[name])` in a shared manager, then `miter=OR(all d)` in sorted output-name order.

- `EQUIVALENT`: final miter is terminal 0; witness is null.
- `INEQUIVALENT`: final miter is nonzero. A total false-first satisfying assignment is replayed by the separate direct Boolean gate evaluator. At least one named output must differ.
- `UNKNOWN`: a node or cache allocation would exceed the configured budget before completion. No miter, output maps, reachable graph or witness is returned. Diagnostic stage identifies left compilation, right compilation or miter construction.

Malformed input is an error, not UNKNOWN. A counterexample replay inconsistency is also an error, not a claimed proof result. No probability appears in any of the three statuses.

## Resource and witness bounds

The node budget counts allocated nonterminals, including unreachable intermediates; terminals are free. Existing unique-table nodes can be reused at a full budget. Creating a new nonterminal beyond the limit fails. Cache entries count memoized nonterminal operation subproblems; terminal shortcuts do not require entries. The cache has no eviction. Valid budgets are 0–100,000 nodes and 0–200,000 cache entries. Node/cache limits bound these structures rather than process heap bytes or wall-clock time.

Low-level operations are not transactional: intermediate nodes/cache entries can remain allocated when a later step exhausts a limit. `compareCircuits` discards its manager on UNKNOWN. Callers using `BDD` directly should likewise discard a manager after `BudgetExceeded`.

A nonzero reduced node represents a satisfiable function. To find a witness, prefer its false child whenever that child is nonzero; otherwise select true. Variables skipped by a reduced edge remain false. The resulting complete assignment is lexicographically first by the manager order, false before true. This order is not necessarily ascending integer operand value and does not define a minimal repair.

## Independent finite oracle and evidence

The direct evaluator executes the validated gate list without BDD operations. Truth-table enumeration is separately limited to 12 inputs (4,096 assignments). It rejects larger domains instead of sampling. Small arithmetic tests compare with host integer addition; mux tests compare with indexed selection.

Snapshot diagnostics include roots and all nodes reachable from output/difference/miter roots, with terminals implicit. Stored node IDs can have gaps because unreachable intermediates are omitted. Evidence tests traverse these snapshots independently and compare small-domain values to the Boolean oracle.

The symbolic equivalence argument uses canonical fixed-order reduced graphs. This is an exact algorithm under its assumptions, but the code is not verified in a theorem prover, and saved diagnostics are not an independently checked proof-certificate format. Bounded exhaustive tests, source hashes and replay artifacts support review of the actual implementation.
