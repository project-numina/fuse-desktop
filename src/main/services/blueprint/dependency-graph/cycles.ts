import type { DependencyGraph } from './index';

interface RegisteredGraph {
  order: string[];
  successors: Map<string, string[]>;
}

interface ComponentState {
  indexOf: Map<string, number>;
  lowOf: Map<string, number>;
  stack: string[];
  onStack: Set<string>;
  groups: Map<string, Set<string>>;
  counter: number;
}

function registeredGraph(remaining: ReadonlyMap<string, ReadonlyMap<string, true>>): RegisteredGraph {
  const order: string[] = [];
  const successors = new Map<string, string[]>();
  const register = (node: string): void => {
    if (successors.has(node)) return;
    successors.set(node, []);
    order.push(node);
  };
  for (const [node, predecessors] of remaining) {
    register(node);
    for (const predecessor of predecessors.keys()) {
      register(predecessor);
      successors.get(predecessor)!.push(node);
    }
  }
  return { order, successors };
}

/** Match Python graphlib's dependency-to-dependent search and registration order. */
function cycleFrom(start: string, successors: ReadonlyMap<string, string[]>, seen: Set<string>): string[] | null {
  const stack: string[] = [];
  const iterators: Array<() => string | undefined> = [];
  const stackIndex = new Map<string, number>();
  let node = start;
  for (;;) {
    if (seen.has(node)) {
      const at = stackIndex.get(node);
      if (at !== undefined) return [...stack.slice(at), node];
    } else {
      seen.add(node);
      const values = successors.get(node)!;
      let cursor = 0;
      iterators.push(() => (cursor < values.length ? values[cursor++] : undefined));
      stackIndex.set(node, stack.length);
      stack.push(node);
    }
    let next: string | undefined;
    while (stack.length) {
      next = iterators[iterators.length - 1]();
      if (next !== undefined) break;
      stackIndex.delete(stack.pop()!);
      iterators.pop();
    }
    if (next === undefined) return null;
    node = next;
  }
}

function findCycle(remaining: ReadonlyMap<string, ReadonlyMap<string, true>>): string[] | null {
  const { order, successors } = registeredGraph(remaining);
  const seen = new Set<string>();
  for (const start of order) {
    if (seen.has(start)) continue;
    const cycle = cycleFrom(start, successors, seen);
    if (cycle !== null) return cycle;
  }
  return null;
}

function normalizeCycle(cyclePath: readonly string[]): string[] {
  const members = cyclePath.slice(0, -1);
  let pivot = 0;
  for (let index = 1; index < members.length; index += 1) {
    if (members[index] < members[pivot]) pivot = index;
  }
  return [...members.slice(pivot), ...members.slice(0, pivot)];
}

function compareCycles(first: readonly string[], second: readonly string[]): number {
  const length = Math.min(first.length, second.length);
  for (let index = 0; index < length; index += 1) {
    if (first[index] < second[index]) return -1;
    if (first[index] > second[index]) return 1;
  }
  return first.length - second.length;
}

/** Report enough normalized cycles to make Python graphlib's sort progress. */
export function detectCycles(labels: readonly string[], edges: ReadonlyMap<string, string[]>): string[][] {
  const remaining = new Map<string, Map<string, true>>();
  for (const label of labels) {
    remaining.set(label, new Map(edges.get(label)!.map((dependency) => [dependency, true] as const)));
  }
  const cycles: string[][] = [];
  for (;;) {
    const cyclePath = findCycle(remaining);
    if (cyclePath === null) return cycles.sort(compareCycles);
    for (let index = 0; index < cyclePath.length - 1; index += 1) {
      remaining.get(cyclePath[index + 1])?.delete(cyclePath[index]);
    }
    cycles.push(normalizeCycle(cyclePath));
  }
}

function componentState(): ComponentState {
  return {
    indexOf: new Map(),
    lowOf: new Map(),
    stack: [],
    onStack: new Set(),
    groups: new Map(),
    counter: 0,
  };
}

function discover(state: ComponentState, label: string): void {
  state.indexOf.set(label, state.counter);
  state.lowOf.set(label, state.counter);
  state.counter += 1;
  state.stack.push(label);
  state.onStack.add(label);
}

function nextUndiscovered(
  graph: DependencyGraph,
  satisfied: ReadonlySet<string>,
  state: ComponentState,
  frame: [string, number],
): string | null {
  const [current] = frame;
  const dependencies = graph.edges.get(current)!;
  while (frame[1] < dependencies.length) {
    const dependency = dependencies[frame[1]++];
    if (satisfied.has(dependency)) continue;
    if (!state.indexOf.has(dependency)) return dependency;
    if (state.onStack.has(dependency)) {
      state.lowOf.set(current, Math.min(state.lowOf.get(current)!, state.indexOf.get(dependency)!));
    }
  }
  return null;
}

function recordComponent(graph: DependencyGraph, state: ComponentState, current: string): void {
  const members: string[] = [];
  for (;;) {
    const member = state.stack.pop()!;
    state.onStack.delete(member);
    members.push(member);
    if (member === current) break;
  }
  if (members.length === 1 && !graph.edges.get(current)!.includes(current)) return;
  const group = new Set(members);
  for (const member of members) state.groups.set(member, group);
}

function finishFrame(graph: DependencyGraph, state: ComponentState, path: Array<[string, number]>): void {
  const current = path.pop()![0];
  if (path.length) {
    const parent = path[path.length - 1][0];
    state.lowOf.set(parent, Math.min(state.lowOf.get(parent)!, state.lowOf.get(current)!));
  }
  if (state.lowOf.get(current) === state.indexOf.get(current)) recordComponent(graph, state, current);
}

/** Iterative Tarjan SCCs after deleting satisfied labels. */
export function liveCycleGroups(graph: DependencyGraph, satisfied: ReadonlySet<string>): Map<string, Set<string>> {
  const state = componentState();
  for (const root of graph.labels) {
    if (state.indexOf.has(root) || satisfied.has(root)) continue;
    discover(state, root);
    const path: Array<[string, number]> = [[root, 0]];
    while (path.length) {
      const descend = nextUndiscovered(graph, satisfied, state, path[path.length - 1]);
      if (descend !== null) {
        discover(state, descend);
        path.push([descend, 0]);
      } else finishFrame(graph, state, path);
    }
  }
  return state.groups;
}
