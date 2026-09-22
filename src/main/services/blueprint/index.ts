/**
 * Blueprint model and assembly: entrypoint discovery, parsing the `.tex`
 * into the per-workspace model, Lean file discovery, the detail payload,
 * chapter read/write and `.tex` tag synchronization. The pure LaTeX core
 * lives in `./latex/*` and `./dependency-graph`; import those directly.
 */

export * from './paths';
export * from './model';
export * from './metadata';
export * from './lean-files';
export * from './lean-locations';
export * from './lean-source';
export * from './read';
export * from './edit';
export * from './tex-sync';
