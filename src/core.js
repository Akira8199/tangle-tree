/**
 * Tangle Tree — a k-d tree for 2D points specialised for orthogonal
 * range queries (axis-aligned bounding box lookups).
 *
 * DESIGN CHOICE — why a k-d tree instead of a quadtree or an R-tree:
 *   A k-d tree splits on a single coordinate at each level, giving a
 *   binary tree with depth O(log n) on balanced input and tight,
 *   cache-friendly nodes. For rectangular range queries — by far the
 *   most common spatial query in practice — the binary split prunes
 *   branches cleanly: when the query box lies entirely on one side of
 *   a splitting plane, the other subtree is skipped without traversal.
 *
 * DESIGN CHOICE — duplicate points:
 *   Points are stored in a flat array and referenced by index from the
 *   tree. Duplicate coordinates are permitted and kept as distinct
 *   entries; callers that want uniqueness should deduplicate before
 *   insertion. This keeps semantics simple and predictable.
 *
 * DESIGN CHOICE — balancing:
 *   The bulk loader sorts each slab on its splitting axis and picks the
 *   median, yielding a balanced tree for any input distribution.
 *   Incremental inserts use recursive median re-mediation only when a
 *   subtree becomes more than twice as deep as its sibling — see the
 *   `MAX_IMBALANCE` constant and the `maybeRebalance` routine. This
 *   avoids rebuilding on every insert while bounding worst-case depth.
 */

/**
 * A two-dimensional point with an optional payload.
 *
 * Coordinates may be any finite number. The payload is opaque to the
 * tree and returned verbatim by query results.
 */
export class Point {
  /**
   * @param {number} x
   * @param {number} y
   * @param {*} [data] — optional value carried alongside the point
   */
  constructor(x, y, data = undefined) {
    if (typeof x !== 'number' || typeof y !== 'number') {
      throw new TypeError('Point coordinates must be numbers');
    }
    if (Number.isNaN(x) || Number.isNaN(y)) {
      throw new RangeError('Point coordinates must not be NaN');
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError('Point coordinates must be finite');
    }
    this.x = x;
    this.y = y;
    this.data = data;
  }
}

/**
 * A range query axis-aligned box, specified by minimum and maximum
 * corners (both inclusive).
 */
class Range {
  constructor(minX, minY, maxX, maxY) {
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
  }

  /**
   * A point is inside the box when both coordinates fall within
   * the closed interval [min, max]. Using closed intervals makes
   * degenerate boxes (a point or a line) behave intuitively.
   */
  contains(p) {
    return (
      p.x >= this.minX &&
      p.x <= this.maxX &&
      p.y >= this.minY &&
      p.y <= this.maxY
    );
  }
}

/**
 * Maximum ratio between sibling subtree depths before a rebalance
 * is triggered. A ratio of 2 means a subtree can be at most twice
 * as deep as its sibling before we re-mediate via sorting and
 * re-splitting. This keeps amortised insert cost low while bounding
 * worst-case query time.
 */
const MAX_IMBALANCE = 2;

/**
 * A node in the k-d tree. Stores an index into the tree's point array
 * rather than the point itself, so moving points around during
 * rebalancing only shuffles indices — the Point objects stay put.
 */
class Node {
  /**
   * @param {number} pointIndex — index into TangleTree._points
   * @param {number} axis — 0 for x-split, 1 for y-split
   * @param {number|null} left — left child index, or null
   * @param {number|null} right — right child index, or null
   */
  constructor(pointIndex, axis, left, right) {
    this.pointIndex = pointIndex;
    this.axis = axis;
    this.left = left;
    this.right = right;
  }
}

/**
 * Tangle Tree — the public tree type.
 *
 * Construct empty and feed points via {@link insert} / {@link insertAll},
 * or pass an initial array to the constructor for bulk loading.
 */
export class TangleTree {
  /**
   * @param {Point[]} [points] — optional initial set; bulk-loaded into
   *   a balanced tree via median splitting.
   */
  constructor(points = []) {
    /** @type {Point[]} */
    this._points = [];
    /** @type {Node[]} */
    this._nodes = [];
    /** @type {number|null} */
    this._root = null;

    if (points.length > 0) {
      this.insertAll(points);
    }
  }

  /**
   * Current number of stored points.
   * @returns {number}
   */
  size() {
    return this._points.length;
  }

  /**
   * Insert a single point. Triggers a local rebalance of the subtree
   * touched by the insert if it becomes too deep relative to its
   * sibling.
   *
   * @param {Point} point
   * @returns {void}
   */
  insert(point) {
    if (!(point instanceof Point)) {
      throw new TypeError('insert expects a Point instance');
    }
    const pointIndex = this._points.length;
    this._points.push(point);

    if (this._root === null) {
      this._root = this._newNode(pointIndex, 0);
      return;
    }

    this._root = this._insertRec(this._root, pointIndex, 0);
  }

  /**
   * Insert many points at once. Bulk loading is implemented by
   * collecting all indices, sorting on the splitting axis, and
   * recursing — producing a balanced tree regardless of input order.
   *
   * @param {Point[]} points
   * @returns {void}
   */
  insertAll(points) {
    if (!Array.isArray(points)) {
      throw new TypeError('insertAll expects an array of Points');
    }
    for (const p of points) {
      if (!(p instanceof Point)) {
        throw new TypeError('insertAll expects Point instances');
      }
    }
    const startIndex = this._points.length;
    for (const p of points) {
      this._points.push(p);
    }
    const indices = [];
    for (let i = startIndex; i < this._points.length; i++) {
      indices.push(i);
    }

    if (this._root === null) {
      this._root = this._build(indices, 0);
    } else {
      // Merge new indices into the existing tree by rebuilding from
      // the full set. This is O(n log n) but keeps the tree balanced
      // after a large batch — far better than inserting one by one
      // and relying on incremental rebalancing.
      const all = [];
      for (let i = 0; i < this._points.length; i++) {
        all.push(i);
      }
      this._nodes = [];
      this._root = this._build(all, 0);
    }
  }

  /**
   * Query for every point inside the closed box [minX,maxX] × [minY,maxY].
   *
   * Results are returned in the order they are encountered during tree
   * traversal; this is not sorted. Callers that need sorted output
   * should sort the returned array themselves — sorting inside the
   * library would penalise callers who don't need it.
   *
   * @param {number} minX
   * @param {number} minY
   * @param {number} maxX
   * @param {number} maxY
   * @returns {Point[]}
   */
  query(minX, minY, maxX, maxY) {
    if (
      typeof minX !== 'number' || typeof minY !== 'number' ||
      typeof maxX !== 'number' || typeof maxY !== 'number'
    ) {
      throw new TypeError('query bounds must be numbers');
    }
    // Normalise so minX<=maxX and minY<=maxY regardless of caller
    // argument order — a degenerate "point" query (min==max) still
    // works, and callers can't accidentally create an empty box by
    // flipping corners.
    if (minX > maxX) {
      const t = minX;
      minX = maxX;
      maxX = t;
    }
    if (minY > maxY) {
      const t = minY;
      minY = maxY;
      maxY = t;
    }
    const range = new Range(minX, minY, maxX, maxY);
    const out = [];
    if (this._root !== null) {
      this._queryRec(this._root, range, out);
    }
    return out;
  }

  /**
   * Query and return the stored data payloads (the `.data` field of
   * each matching Point) rather than the Points themselves. Points
   * without a payload contribute `undefined` to the result — this is
   * intentional and lets callers distinguish "matched, no data" from
   * "not matched".
   *
   * @param {number} minX
   * @param {number} minY
   * @param {number} maxX
   * @param {number} maxY
   * @returns {*[]}
   */
  queryData(minX, minY, maxX, maxY) {
    return this.query(minX, minY, maxX, maxY).map(p => p.data);
  }

  // ---- internals ----------------------------------------------------

  /**
   * Allocate a node and return its index in the node array.
   * Storing nodes in a flat array (rather than as objects with
   * pointers) keeps memory compact and avoids GC pressure on large
   * datasets; rebalancing only rewrites integer indices.
   */
  _newNode(pointIndex, axis, left = null, right = null) {
    const idx = this._nodes.length;
    this._nodes.push(new Node(pointIndex, axis, left, right));
    return idx;
  }

  /**
   * Recursively build a balanced subtree from a list of point indices.
   *
   * The list is sorted on the current splitting axis and split at the
   * median. The median element becomes this node's point; elements
   * before the median go left, elements after go right. Axis
   * alternates with depth (0=x, 1=y) so the tree subdivides space in
   * both dimensions.
   *
   * @param {number[]} indices
   * @param {number} axis
   * @returns {number|null} — node index, or null if indices is empty
   */
  _build(indices, axis) {
    if (indices.length === 0) return null;

    // Copy before sorting so we don't mutate the caller's array when
    // this is called from insertAll's merge path.
    const sorted = indices.slice();
    sorted.sort((a, b) => {
      const pa = this._points[a];
      const pb = this._points[b];
      const va = axis === 0 ? pa.x : pa.y;
      const vb = axis === 0 ? pb.x : pb.y;
      if (va < vb) return -1;
      if (va > vb) return 1;
      return 0;
    });

    const mid = sorted.length >> 1;
    const nextAxis = (axis + 1) % 2;
    const left = this._build(sorted.slice(0, mid), nextAxis);
    const right = this._build(sorted.slice(mid + 1), nextAxis);
    return this._newNode(sorted[mid], axis, left, right);
  }

  /**
   * Recursive insert with depth tracking. Returns the (possibly new)
   * node index for the subtree rooted at `nodeIdx`. After insertion,
   * if the subtree is too lopsided, it is rebuilt via {@link _build}
   * to restore balance.
   */
  _insertRec(nodeIdx, pointIdx, depth) {
    const node = this._nodes[nodeIdx];
    const np = this._points[node.pointIndex];
    const ip = this._points[pointIdx];
    const splitVal = node.axis === 0 ? np.x : np.y;
    const insVal = node.axis === 0 ? ip.x : ip.y;

    if (insVal < splitVal) {
      if (node.left === null) {
        node.left = this._newNode(pointIdx, (node.axis + 1) % 2);
      } else {
        node.left = this._insertRec(node.left, pointIdx, depth + 1);
      }
    } else {
      // Points with coordinate equal to the split go right. This is
      // a deliberate, consistent tie-break — k-d trees do not have
      // a canonical handling of equals, but picking one side
      // deterministically keeps the tree well-defined.
      if (node.right === null) {
        node.right = this._newNode(pointIdx, (node.axis + 1) % 2);
      } else {
        node.right = this._insertRec(node.right, pointIdx, depth + 1);
      }
    }

    return this._maybeRebalance(nodeIdx);
  }

  /**
   * If the left or right subtree is more than `MAX_IMBALANCE` times
   * as deep as its sibling, rebuild this whole subtree from scratch
   * via median splitting. Rebuilding only on large imbalance keeps
   * amortised cost low while preventing pathological skew.
   */
  _maybeRebalance(nodeIdx) {
    const node = this._nodes[nodeIdx];
    const leftDepth = this._depth(node.left);
    const rightDepth = this._depth(node.right);

    const deeper = Math.max(leftDepth, rightDepth);
    const shallower = Math.min(leftDepth, rightDepth);

    if (shallower === 0 && deeper > 1) {
      this._rebuild(nodeIdx, node.axis);
    } else if (shallower > 0 && deeper > shallower * MAX_IMBALANCE) {
      this._rebuild(nodeIdx, node.axis);
    }
    return nodeIdx;
  }

  /**
   * Rebuild the subtree rooted at `nodeIdx` by collecting all its
   * point indices, discarding its children, and re-splitting via
   * {@link _build}.
   */
  _rebuild(nodeIdx, axis) {
    const indices = [];
    this._collectIndices(nodeIdx, indices);
    const node = this._nodes[nodeIdx];
    node.left = null;
    node.right = null;
    if (indices.length === 0) return;

    const sorted = indices.slice();
    sorted.sort((a, b) => {
      const pa = this._points[a];
      const pb = this._points[b];
      const va = axis === 0 ? pa.x : pa.y;
      const vb = axis === 0 ? pb.x : pb.y;
      if (va < vb) return -1;
      if (va > vb) return 1;
      return 0;
    });
    const mid = sorted.length >> 1;
    const nextAxis = (axis + 1) % 2;
    const left = this._build(sorted.slice(0, mid), nextAxis);
    const right = this._build(sorted.slice(mid + 1), nextAxis);

    node.pointIndex = sorted[mid];
    node.axis = axis;
    node.left = left;
    node.right = right;
  }

  /**
   * Collect all point indices in the subtree rooted at `nodeIdx`
   * into `out` (in arbitrary order — the caller sorts afterwards).
   */
  _collectIndices(nodeIdx, out) {
    if (nodeIdx === null) return;
    const node = this._nodes[nodeIdx];
    out.push(node.pointIndex);
    this._collectIndices(node.left, out);
    this._collectIndices(node.right, out);
  }

  /**
   * Depth of the subtree rooted at `nodeIdx` (a null subtree has
   * depth 0, a single node has depth 1). Used by rebalancing.
   */
  _depth(nodeIdx) {
    if (nodeIdx === null) return 0;
    const node = this._nodes[nodeIdx];
    return 1 + Math.max(this._depth(node.left), this._depth(node.right));
  }

  /**
   * Recursive range query. At each node we test the node's own
   * point against the box, then decide which subtrees could
   * possibly contain matching points:
   *
   *   - If the query box's minimum along the splitting axis is
   *     less than or equal to the split value, the left subtree may
   *     contain matches. (Boundary semantics are inclusive, so a
   *     point sitting exactly on the box edge must still be
   *     reachable. Since points equal to the split go right at
   *     insert time, but the left subtree can still hold earlier
   *     median picks at the same coordinate, we must descend left
   *     whenever min <= split.)
   *   - If the query box's maximum along the splitting axis is
   *     greater than or equal to the split value, the right
   *     subtree may contain matches (points equal to the split
   *     go right, so we use >= for the right).
   *
   * This pruning is the entire reason the k-d tree exists for
   * orthogonal range queries — it lets us skip subtrees that lie
   * entirely outside the query box.
   */
  _queryRec(nodeIdx, range, out) {
    if (nodeIdx === null) return;
    const node = this._nodes[nodeIdx];
    const p = this._points[node.pointIndex];

    if (range.contains(p)) {
      out.push(p);
    }

    if (node.axis === 0) {
      if (range.minX <= p.x) {
        this._queryRec(node.left, range, out);
      }
      if (range.maxX >= p.x) {
        this._queryRec(node.right, range, out);
      }
    } else {
      if (range.minY <= p.y) {
        this._queryRec(node.left, range, out);
      }
      if (range.maxY >= p.y) {
        this._queryRec(node.right, range, out);
      }
    }
  }
}
