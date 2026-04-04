/** Binary min-heap ordered by numeric key (default: element itself as number). */
export class MinHeap<T> {
  private readonly data: T[] = [];
  private readonly key: (item: T) => number;

  constructor(key: (item: T) => number = (x) => x as unknown as number) {
    this.key = key;
  }

  get size(): number {
    return this.data.length;
  }

  isEmpty(): boolean {
    return this.data.length === 0;
  }

  peek(): T | undefined {
    return this.data[0];
  }

  push(item: T): void {
    this.data.push(item);
    this.siftUp(this.data.length - 1);
  }

  pop(): T | undefined {
    const arr = this.data;
    if (arr.length === 0) return undefined;
    const min = arr[0];
    const last = arr.pop()!;
    if (arr.length > 0) {
      arr[0] = last;
      this.siftDown(0);
    }
    return min;
  }

  /** Copy of all items sorted by key (for UI / debug; does not modify the heap). */
  snapshotSorted(): T[] {
    const k = this.key;
    return [...this.data].sort((a, b) => k(a) - k(b));
  }

  private siftUp(i: number): void {
    const arr = this.data;
    const k = this.key;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k(arr[i]) >= k(arr[p])) break;
      [arr[i], arr[p]] = [arr[p], arr[i]];
      i = p;
    }
  }

  private siftDown(i: number): void {
    const arr = this.data;
    const k = this.key;
    const n = arr.length;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let smallest = i;
      if (l < n && k(arr[l]) < k(arr[smallest])) smallest = l;
      if (r < n && k(arr[r]) < k(arr[smallest])) smallest = r;
      if (smallest === i) break;
      [arr[i], arr[smallest]] = [arr[smallest], arr[i]];
      i = smallest;
    }
  }
}
