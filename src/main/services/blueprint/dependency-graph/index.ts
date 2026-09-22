/**
 * Dependency graph, ordering, and readiness frontier for one blueprint.
 *
 * External `uses` references do not block readiness because the graph cannot
 * distinguish a typo from a valid external theorem. Build-time cycles are a
 * diagnostic snapshot; readiness queries derive cycles from the live graph.
 */

import { constructDependencyGraph } from './construction';
import { liveCycleGroups } from './cycles';
import { heapOrder } from './order';

export interface DeclarationLike {
  label: string;
  /** Labels this declaration depends on, in authored order (`null` = none). */
  uses?: readonly string[] | null;
}

export interface DependencyGraph {
  /** Every declaration label, in document order (first copy of a repeat wins). */
  labels: string[];
  /** In-graph dependencies in authored order; every label is a key. */
  edges: Map<string, string[]>;
  /** `uses` entries naming no known label, in authored order; sparse. */
  externalReferences: Map<string, string[]>;
  /** Normalized build-time cycles in stable order. */
  cycles: string[][];
}

interface Walk {
  covered: ReadonlySet<string>;
  satisfied: ReadonlySet<string>;
  deadlocked: ReadonlyMap<string, ReadonlySet<string>>;
  flags: Map<string, boolean>;
}

interface Memo {
  transitive: Map<string, Set<string>>;
  cycleMembers: Set<string> | null;
  order: string[] | null;
  liveOrder: [string, string[]] | null;
  deadlocked: [string, Map<string, Set<string>>] | null;
  walk: [string, Walk] | null;
}

interface BlockInspection {
  blocked: boolean;
  descend: string | null;
  nextIndex: number;
}

const memos = new WeakMap<DependencyGraph, Memo>();

function memoOf(graph: DependencyGraph): Memo {
  let memo = memos.get(graph);
  if (!memo) {
    memo = { transitive: new Map(), cycleMembers: null, order: null, liveOrder: null, deadlocked: null, walk: null };
    memos.set(graph, memo);
  }
  return memo;
}

/** Callers pass live sets, so cache by sorted contents rather than identity. */
function setKey(labels: ReadonlySet<string>): string {
  return [...labels].sort().join('\u0000');
}

/** Resolve authored dependencies while preserving first-label and uses order. */
export function buildDependencyGraph(declarations: Iterable<DeclarationLike>): DependencyGraph {
  return constructDependencyGraph(declarations);
}

/** Return every in-graph dependency reachable from `label`. */
export function transitiveDependencies(graph: DependencyGraph, label: string): Set<string> {
  const cache = memoOf(graph).transitive;
  const cached = cache.get(label);
  if (cached) return cached;
  if (!graph.edges.has(label)) return new Set();
  const reached = new Set<string>();
  const pending = [...graph.edges.get(label)!];
  while (pending.length) {
    const current = pending.pop()!;
    if (reached.has(current)) continue;
    reached.add(current);
    const knownClosure = cache.get(current);
    if (knownClosure) {
      for (const member of knownClosure) reached.add(member);
    } else pending.push(...graph.edges.get(current)!);
  }
  cache.set(label, reached);
  return reached;
}

function cycleMembersOf(graph: DependencyGraph): Set<string> {
  const memo = memoOf(graph);
  if (!memo.cycleMembers) memo.cycleMembers = new Set(graph.cycles.flat());
  return memo.cycleMembers;
}

/** Dependency-first build-time order, with cycle members trailing in document order. */
export function topologicalOrder(graph: DependencyGraph): string[] {
  const memo = memoOf(graph);
  if (memo.order) return memo.order;
  const cycleMembers = cycleMembersOf(graph);
  const acyclic = new Map<string, string[]>();
  for (const label of graph.labels) {
    if (cycleMembers.has(label)) continue;
    acyclic.set(label, graph.edges.get(label)!.filter((dependency) => !cycleMembers.has(dependency)));
  }
  const ordered = heapOrder(graph, acyclic);
  ordered.push(...graph.labels.filter((label) => cycleMembers.has(label)));
  memo.order = ordered;
  return ordered;
}

function deadlockedGroups(graph: DependencyGraph, satisfied: ReadonlySet<string>): Map<string, Set<string>> {
  const memo = memoOf(graph);
  const key = setKey(satisfied);
  if (memo.deadlocked && memo.deadlocked[0] === key) return memo.deadlocked[1];
  const groups = liveCycleGroups(graph, satisfied);
  memo.deadlocked = [key, groups];
  return groups;
}

function liveOrder(graph: DependencyGraph, satisfied: ReadonlySet<string>): string[] {
  const memo = memoOf(graph);
  const key = setKey(satisfied);
  if (memo.liveOrder && memo.liveOrder[0] === key) return memo.liveOrder[1];
  const deadlocked = deadlockedGroups(graph, satisfied);
  const orderable = new Map<string, string[]>();
  for (const label of graph.labels) {
    if (satisfied.has(label) || deadlocked.has(label)) continue;
    orderable.set(
      label,
      graph.edges.get(label)!.filter((dependency) => !satisfied.has(dependency) && !deadlocked.has(dependency)),
    );
  }
  const ordered = heapOrder(graph, orderable);
  ordered.push(...graph.labels.filter((label) => deadlocked.has(label)));
  memo.liveOrder = [key, ordered];
  return ordered;
}

/** Live strongly connected components in document order. */
export function liveCycles(graph: DependencyGraph, satisfied: ReadonlySet<string>): string[][] {
  const groups = deadlockedGroups(graph, satisfied);
  const seen = new Set<ReadonlySet<string>>();
  const cycles: string[][] = [];
  for (const label of graph.labels) {
    const group = groups.get(label);
    if (!group || seen.has(group)) continue;
    seen.add(group);
    cycles.push(graph.labels.filter((member) => group.has(member)));
  }
  return cycles;
}

function walkState(graph: DependencyGraph, approved: ReadonlySet<string>, satisfied: ReadonlySet<string>): Walk {
  const memo = memoOf(graph);
  const key = setKey(approved) + '\u0001' + setKey(satisfied);
  if (memo.walk && memo.walk[0] === key) return memo.walk[1];
  const satisfiedLabels = new Set(satisfied);
  const walk: Walk = {
    covered: new Set([...approved, ...satisfied]),
    satisfied: satisfiedLabels,
    deadlocked: deadlockedGroups(graph, satisfiedLabels),
    flags: new Map(),
  };
  memo.walk = [key, walk];
  return walk;
}

function inspectBlockers(
  graph: DependencyGraph,
  current: string,
  start: number,
  walk: Walk,
): BlockInspection {
  const dependencies = graph.edges.get(current)!;
  let index = start;
  while (index < dependencies.length) {
    const dependency = dependencies[index];
    if (walk.satisfied.has(dependency)) {
      index += 1;
      continue;
    }
    if (!walk.covered.has(dependency) || walk.deadlocked.has(dependency)) {
      return { blocked: true, descend: null, nextIndex: index };
    }
    const resolved = walk.flags.get(dependency);
    if (resolved === undefined) return { blocked: false, descend: dependency, nextIndex: index };
    if (resolved) return { blocked: true, descend: null, nextIndex: index };
    index += 1;
  }
  return { blocked: false, descend: null, nextIndex: index };
}

/** Iteratively settle whether a label reaches uncovered or cyclic work. */
function isBlocked(graph: DependencyGraph, label: string, walk: Walk): boolean {
  if (walk.satisfied.has(label)) return false;
  if (walk.deadlocked.has(label)) return true;
  const known = walk.flags.get(label);
  if (known !== undefined) return known;
  const path: Array<[string, number]> = [[label, 0]];
  while (path.length) {
    const frame = path[path.length - 1];
    const result = inspectBlockers(graph, frame[0], frame[1], walk);
    if (result.descend !== null) {
      frame[1] = result.nextIndex;
      path.push([result.descend, 0]);
    } else {
      path.pop();
      walk.flags.set(frame[0], result.blocked);
    }
  }
  return walk.flags.get(label)!;
}

function unmetDependencies(graph: DependencyGraph, label: string, walk: Walk): Set<string> {
  const unmet = new Set<string>();
  const visited = new Set<string>();
  const pending = [...graph.edges.get(label)!];
  while (pending.length) {
    const current = pending.pop()!;
    if (visited.has(current) || walk.satisfied.has(current)) continue;
    visited.add(current);
    if (walk.deadlocked.has(current)) {
      unmet.add(current);
      continue;
    }
    if (!walk.covered.has(current)) unmet.add(current);
    pending.push(...graph.edges.get(current)!);
  }
  return unmet;
}

/** Approved, unsatisfied labels whose transitive work is covered. */
export function readyFrontier(
  graph: DependencyGraph,
  approved: ReadonlySet<string>,
  satisfied: ReadonlySet<string>,
): string[] {
  const walk = walkState(graph, approved, satisfied);
  return liveOrder(graph, walk.satisfied).filter(
    (label) => approved.has(label) && !isBlocked(graph, label, walk),
  );
}

/** Deepest unmet dependencies, or the live cycle deadlocking `label`. */
export function blockingDependencies(
  graph: DependencyGraph,
  label: string,
  approved: ReadonlySet<string>,
  satisfied: ReadonlySet<string>,
): string[] {
  if (!graph.edges.has(label) || satisfied.has(label)) return [];
  const walk = walkState(graph, approved, satisfied);
  const deadlock = walk.deadlocked.get(label);
  if (deadlock) return graph.labels.filter((member) => deadlock.has(member));
  const unmet = unmetDependencies(graph, label, walk);
  return liveOrder(graph, walk.satisfied).filter(
    (candidate) => unmet.has(candidate) && (walk.deadlocked.has(candidate) || !isBlocked(graph, candidate, walk)),
  );
}
