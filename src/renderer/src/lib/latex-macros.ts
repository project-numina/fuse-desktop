/**
 * Shared types and helpers for blueprint-defined LaTeX macros.
 *
 * Imported leanblueprints define custom commands like ``\rhobar``,
 * ``\calO``, ``\GL`` in their ``blueprint/src/macros/common.tex``
 * file. The backend parses those definitions and ships them on the
 * blueprint payload as a ``{name: body}`` dict (without the leading
 * backslash on names). This module centralises the type and the
 * KaTeX-format conversion so the renderer and any consumer can use a
 * single representation.
 */

/**
 * Macro dictionary as shipped by the backend.
 *
 * Keys are command names without a leading backslash (so ``rhobar``
 * not ``\rhobar``); values are the macro body in raw LaTeX
 * (``\bar\rho``).
 */
export type MacroDict = Record<string, string>;

/**
 * Empty dict used as the default when a blueprint payload doesn't
 * include macros (legacy single-file blueprints, GitHub fallback
 * reads). A shared frozen instance keeps reference equality stable
 * across renders.
 */
export const EMPTY_MACROS: MacroDict = Object.freeze({}) as MacroDict;

/**
 * Convert a ``{name: body}`` dict into KaTeX's expected
 * ``{\\name: body}`` shape. KaTeX requires command names to include
 * the leading backslash; the backend trims it for compactness on the
 * wire.
 */
export function toKatexMacros(macros: MacroDict): MacroDict {
  const result: MacroDict = {};
  for (const [name, body] of Object.entries(macros)) {
    result[`\\${name}`] = body;
  }
  return result;
}
