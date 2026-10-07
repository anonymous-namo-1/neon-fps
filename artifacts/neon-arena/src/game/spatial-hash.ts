/**
 * Uniform grid broadphase.
 *
 * Enemy separation used to compare every enemy against every other enemy,
 * which is O(n^2) and became the dominant cost once waves grew past a couple
 * of dozen units. Enemies only ever push against neighbours within a couple of
 * metres, so bucketing them by cell and visiting the 3x3 neighbourhood turns
 * the same query into roughly O(n).
 *
 * The grid is rebuilt every simulation step rather than incrementally updated:
 * clearing and refilling reused arrays is cheaper than tracking cell
 * transitions, and it cannot drift out of sync with the world.
 */

export interface GridItem {
  position: { x: number; z: number };
}

export class SpatialHash<T extends GridItem> {
  private readonly cells = new Map<number, T[]>();
  private readonly spare: T[][] = [];
  private readonly cellSize: number;
  private readonly inverse: number;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
    this.inverse = 1 / cellSize;
  }

  /**
   * Cell coordinates are packed into a single number so the map can use a
   * primitive key -- string keys like `${x}:${z}` would allocate on every
   * insert and every query.
   */
  private key(cx: number, cz: number): number {
    // Offset keeps the value positive; 4096 cells per axis is far beyond any
    // arena size we build.
    return ((cx + 2048) << 12) | (cz + 2048);
  }

  clear(): void {
    for (const bucket of this.cells.values()) {
      bucket.length = 0;
      this.spare.push(bucket);
    }
    this.cells.clear();
  }

  insert(item: T): void {
    const cx = Math.floor(item.position.x * this.inverse);
    const cz = Math.floor(item.position.z * this.inverse);
    const k = this.key(cx, cz);
    let bucket = this.cells.get(k);
    if (!bucket) {
      bucket = this.spare.pop() ?? [];
      this.cells.set(k, bucket);
    }
    bucket.push(item);
  }

  /**
   * Visits every item in the 3x3 cell neighbourhood around a point. The
   * callback form avoids allocating a result array per query, which matters
   * because this runs once per enemy per simulation step.
   *
   * Cell size must be at least the largest interaction radius, otherwise a
   * neighbour two cells away could be missed.
   */
  forEachNear(x: number, z: number, visit: (item: T) => void): void {
    const cx = Math.floor(x * this.inverse);
    const cz = Math.floor(z * this.inverse);

    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const bucket = this.cells.get(this.key(cx + ox, cz + oz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) visit(bucket[i]!);
      }
    }
  }

  get size(): number {
    return this.cellSize;
  }
}
