# Tangle Tree

A k-d tree for two-dimensional points, built for fast orthogonal range queries (axis-aligned bounding box lookups). Stores points in a binary space partition and prunes subtrees that fall entirely outside the query box.

## Usage

```js
import { TangleTree, Point } from 'tangle-tree';

const tree = new TangleTree([
  new Point(1, 1, 'apple'),
  new Point(7, 3, 'pear'),
  new Point(2, 9, 'plum'),
  new Point(8, 8, 'grape'),
]);

// Find all points inside the box [0,0]–[5,10].
const hits = tree.query(0, 0, 5, 10);
// → [Point{x:1,y:1}, Point{x:2,y:9}]

// Or get just the payloads:
const labels = tree.queryData(0, 0, 5, 10);
// → ['apple', 'plum'] (order depends on traversal)
```

## Why this exists

When you have a static or slowly-changing set of points and need to answer many rectangular range queries, scanning the whole set each time is wasteful. A k-d tree partitions space so that each query only descends into subtrees whose splitting region could intersect the query box.

The trade-off: k-d trees are awkward for *moving* points — updating a coordinate means removing and re-inserting. This library is tuned for the write-once / query-many case. Bulk loading via the constructor produces a balanced tree in O(n log n); incremental `insert` is supported but triggers local rebalancing when a subtree becomes lopsided, so it is slower than bulk loading for large batches.

## Edge cases worth knowing

- **Query bounds are normalised.** If you pass `maxX < minX` (or the same for Y), the tree swaps them internally. This means a "point" query where all four bounds are equal returns exactly that point if present.
- **Duplicate points are kept as distinct entries.** If you insert two `Point(3, 3)` objects, both appear in query results. Deduplicate beforehand if you want uniqueness.
- **Boundary semantics are inclusive.** A point exactly on the query box edge is returned.
- **Points with equal split coordinates go right.** This is a deterministic tie-break; it keeps the tree well-defined but means results are not in sorted order — sort the returned array if you need that.
- **Coordinates must be finite numbers.** `NaN` and `Infinity` are rejected at construction.

## Exports

- `Point` — point class. Constructor: `new Point(x, y, data?)`. Coordinates must be finite numbers; `data` is optional and opaque.
- `TangleTree` — the tree. Constructor: `new TangleTree(points?)`. Methods: `insert(point)`, `insertAll(points)`, `query(minX, minY, maxX, maxY)` → `Point[]`, `queryData(minX, minY, maxX, maxY)` → `any[]`, `size()` → `number`. The default export is `TangleTree`.
