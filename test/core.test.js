import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TangleTree, Point } from '../src/index.js';

// ---------- Point construction ----------

test('Point stores coordinates and optional data', () => {
  const p = new Point(3, 4, 'hello');
  assert.equal(p.x, 3);
  assert.equal(p.y, 4);
  assert.equal(p.data, 'hello');
});

test('Point defaults data to undefined', () => {
  const p = new Point(1, 2);
  assert.equal(p.data, undefined);
});

test('Point rejects non-number coordinates', () => {
  assert.throws(() => new Point('x', 2), TypeError);
  assert.throws(() => new Point(1, null), TypeError);
});

test('Point rejects NaN and Infinity', () => {
  assert.throws(() => new Point(NaN, 2), RangeError);
  assert.throws(() => new Point(1, Infinity), RangeError);
  assert.throws(() => new Point(-Infinity, 0), RangeError);
});

// ---------- Basic query ----------

test('query on empty tree returns empty array', () => {
  const tree = new TangleTree();
  assert.deepEqual(tree.query(0, 0, 10, 10), []);
});

test('query returns the single inserted point when inside the box', () => {
  const tree = new TangleTree();
  tree.insert(new Point(5, 5));
  const r = tree.query(0, 0, 10, 10);
  assert.equal(r.length, 1);
  assert.equal(r[0].x, 5);
  assert.equal(r[0].y, 5);
});

test('query excludes points outside the box', () => {
  const tree = new TangleTree();
  tree.insert(new Point(5, 5));
  assert.deepEqual(tree.query(6, 6, 10, 10), []);
});

test('query with closed bounds includes boundary points', () => {
  const tree = new TangleTree();
  tree.insert(new Point(1, 1));
  tree.insert(new Point(3, 3));
  tree.insert(new Point(5, 5));
  const r = tree.query(1, 1, 3, 3);
  assert.equal(r.length, 2);
  const xs = r.map(p => p.x).sort((a, b) => a - b);
  assert.deepEqual(xs, [1, 3]);
});

// ---------- Bulk loading ----------

test('bulk-loaded points are all queryable', () => {
  const pts = [
    new Point(1, 1),
    new Point(2, 8),
    new Point(3, 3),
    new Point(7, 2),
    new Point(9, 9),
  ];
  const tree = new TangleTree(pts);
  assert.equal(tree.size(), 5);
  const r = tree.query(0, 0, 10, 10);
  assert.equal(r.length, 5);
});

test('bulk load produces a balanced tree via median splitting', () => {
  // Insert in sorted x order; a naive insert would produce a
  // degenerate right-leaning chain. Bulk loading should still
  // give a shallow, balanced tree.
  const pts = [];
  for (let i = 0; i < 31; i++) {
    pts.push(new Point(i, i));
  }
  const tree = new TangleTree(pts);
  // Balanced tree of 31 nodes has depth 5.
  assert.equal(tree._depth(tree._root), 5);
});

test('insertAll rejects non-Point entries', () => {
  const tree = new TangleTree();
  assert.throws(
    () => tree.insertAll([new Point(1, 1), { x: 2, y: 2 }]),
    TypeError,
  );
});

test('insertAll merges with existing points by full rebuild', () => {
  const tree = new TangleTree([new Point(1, 1), new Point(2, 2)]);
  tree.insertAll([new Point(3, 3), new Point(4, 4)]);
  assert.equal(tree.size(), 4);
  const r = tree.query(0, 0, 5, 5);
  assert.equal(r.length, 4);
});

// ---------- Edge cases on coordinates ----------

test('negative coordinates work correctly', () => {
  const pts = [
    new Point(-5, -5),
    new Point(-3, 1),
    new Point(0, -2),
    new Point(2, 3),
  ];
  const tree = new TangleTree(pts);
  const r = tree.query(-4, -4, 1, 1);
  assert.equal(r.length, 2);
  const xs = r.map(p => p.x).sort((a, b) => a - b);
  assert.deepEqual(xs, [-3, 0]);
});

test('query with swapped corners normalises correctly', () => {
  const tree = new TangleTree([new Point(2, 2), new Point(8, 8)]);
  // Caller passes maxX as the first arg and minX as the third.
  const r = tree.query(10, 10, 0, 0);
  assert.equal(r.length, 2);
});

test('degenerate point query (min == max) returns exactly that point', () => {
  const tree = new TangleTree([
    new Point(1, 1),
    new Point(2, 2),
    new Point(3, 3),
  ]);
  const r = tree.query(2, 2, 2, 2);
  assert.equal(r.length, 1);
  assert.equal(r[0].x, 2);
  assert.equal(r[0].y, 2);
});

test('degenerate line query along x returns matching column', () => {
  const tree = new TangleTree([
    new Point(2, 1),
    new Point(2, 5),
    new Point(3, 5),
  ]);
  const r = tree.query(2, 0, 2, 10);
  assert.equal(r.length, 2);
  for (const p of r) {
    assert.equal(p.x, 2);
  }
});

test('query with all points outside returns empty array', () => {
  const tree = new TangleTree([
    new Point(100, 100),
    new Point(200, 200),
  ]);
  assert.deepEqual(tree.query(0, 0, 50, 50), []);
});

// ---------- Duplicate points ----------

test('duplicate coordinate points are stored as distinct entries', () => {
  const tree = new TangleTree([
    new Point(1, 1, 'a'),
    new Point(1, 1, 'b'),
    new Point(1, 1, 'c'),
  ]);
  const r = tree.query(1, 1, 1, 1);
  assert.equal(r.length, 3);
  const datas = r.map(p => p.data).sort();
  assert.deepEqual(datas, ['a', 'b', 'c']);
});

test('single-insert duplicates are all queryable', () => {
  const tree = new TangleTree();
  tree.insert(new Point(5, 5, 'one'));
  tree.insert(new Point(5, 5, 'two'));
  tree.insert(new Point(5, 5, 'three'));
  const r = tree.query(5, 5, 5, 5);
  assert.equal(r.length, 3);
});

// ---------- Payload handling ----------

test('queryData returns the data payloads of matching points', () => {
  const tree = new TangleTree([
    new Point(1, 1, 'alpha'),
    new Point(2, 2, 'beta'),
    new Point(3, 3, 'gamma'),
  ]);
  const r = tree.queryData(0, 0, 2, 2);
  assert.deepEqual(r.sort(), ['alpha', 'beta']);
});

test('queryData includes undefined for points without payload', () => {
  const tree = new TangleTree([
    new Point(1, 1),
    new Point(2, 2, 'tagged'),
  ]);
  const r = tree.queryData(0, 0, 3, 3);
  assert.equal(r.length, 2);
  assert.ok(r.includes('tagged'));
  assert.ok(r.includes(undefined));
});

// ---------- Rebalancing after many single inserts ----------

test('tree stays queryable after many sequential single inserts', () => {
  // Inserting x=0,1,2,...,29 sequentially would create a
  // right-leaning chain without rebalancing. With rebalancing,
  // the tree should remain shallow and all points queryable.
  const tree = new TangleTree();
  for (let i = 0; i < 30; i++) {
    tree.insert(new Point(i, i * 2));
  }
  assert.equal(tree.size(), 30);
  const r = tree.query(0, 0, 29, 58);
  assert.equal(r.length, 30);
  // Depth should be bounded — not a 30-deep chain.
  assert.ok(tree._depth(tree._root) <= 12);
});

// ---------- Larger random-ish dataset correctness ----------

test('range query matches brute-force on a known scatter', () => {
  // Deterministic pseudo-scatter (no Math.random — tests must be
  // reproducible). Using a simple LCG so the pattern is fixed
  // across runs and platforms.
  let seed = 42;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  const pts = [];
  for (let i = 0; i < 200; i++) {
    pts.push(new Point(next() % 1000, next() % 1000, i));
  }
  const tree = new TangleTree(pts);

  const boxes = [
    [0, 0, 100, 100],
    [200, 200, 400, 400],
    [500, 500, 1000, 1000],
    [0, 0, 1000, 1000],
    [333, 333, 333, 333],
    [999, 999, 0, 0],
  ];

  for (const [minX, minY, maxX, maxY] of boxes) {
    const treeResult = tree.query(minX, minY, maxX, maxY);
    const brute = pts.filter(p =>
      p.x >= Math.min(minX, maxX) && p.x <= Math.max(minX, maxX) &&
      p.y >= Math.min(minY, maxY) && p.y <= Math.max(minY, maxY),
    );
    assert.equal(
      treeResult.length, brute.length,
      `box [${minX},${minY},${maxX},${maxY}] count mismatch`,
    );
  }
});

// ---------- Error handling ----------

test('insert rejects non-Point', () => {
  const tree = new TangleTree();
  assert.throws(() => tree.insert({ x: 1, y: 2 }), TypeError);
  assert.throws(() => tree.insert(5), TypeError);
});

test('query rejects non-number bounds', () => {
  const tree = new TangleTree([new Point(1, 1)]);
  assert.throws(() => tree.query('0', 0, 10, 10), TypeError);
  assert.throws(() => tree.query(0, 0, null, 10), TypeError);
});

// ---------- size() accuracy ----------

test('size reflects inserts and bulk loads', () => {
  const tree = new TangleTree();
  assert.equal(tree.size(), 0);
  tree.insert(new Point(1, 1));
  assert.equal(tree.size(), 1);
  tree.insert(new Point(2, 2));
  assert.equal(tree.size(), 2);
  tree.insertAll([new Point(3, 3), new Point(4, 4), new Point(5, 5)]);
  assert.equal(tree.size(), 5);
});
