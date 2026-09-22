import type { DependencyGraph } from './index';

/** Binary min-heap of document positions. */
class MinHeap {
  private readonly items: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(value: number): void {
    this.items.push(value);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent] <= this.items[index]) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }

  pop(): number {
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length) {
      this.items[0] = last;
      this.siftDown();
    }
    return top;
  }

  private siftDown(): void {
    let index = 0;
    for (;;) {
      const left = 2 * index + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.items.length && this.items[left] < this.items[smallest]) smallest = left;
      if (right < this.items.length && this.items[right] < this.items[smallest]) smallest = right;
      if (smallest === index) return;
      [this.items[smallest], this.items[index]] = [this.items[index], this.items[smallest]];
      index = smallest;
    }
  }
}

function dependentsOf(orderable: ReadonlyMap<string, string[]>): Map<string, string[]> {
  const dependents = new Map<string, string[]>();
  for (const label of orderable.keys()) dependents.set(label, []);
  for (const [label, dependencies] of orderable) {
    for (const dependency of dependencies) dependents.get(dependency)!.push(label);
  }
  return dependents;
}

/** Kahn ordering with document position as the deterministic tie-breaker. */
export function heapOrder(graph: DependencyGraph, orderable: ReadonlyMap<string, string[]>): string[] {
  const position = new Map(graph.labels.map((label, index) => [label, index] as const));
  const remaining = new Map([...orderable].map(([label, dependencies]) => [label, dependencies.length]));
  const dependents = dependentsOf(orderable);
  const ready = new MinHeap();
  for (const [label, count] of remaining) if (count === 0) ready.push(position.get(label)!);
  const ordered: string[] = [];
  while (ready.size) {
    const label = graph.labels[ready.pop()];
    ordered.push(label);
    for (const dependent of dependents.get(label)!) {
      const left = remaining.get(dependent)! - 1;
      remaining.set(dependent, left);
      if (left === 0) ready.push(position.get(dependent)!);
    }
  }
  return ordered;
}
