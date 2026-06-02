import JSON5 from 'json5'
import type { ScriptMeta } from '../types.js'

/**
 * Extract and parse `export const meta = { ... }` from a script source.
 *
 * Uses a brace-depth counter that is aware of string literals and comments
 * to correctly handle nested objects, then parses with JSON5 (no arbitrary
 * code execution).
 *
 * Returns `{ meta, body }` where `meta` is the parsed object (or null on
 * failure) and `body` is the source with the meta export removed.
 */
export function extractMeta(source: string): { meta: ScriptMeta | null; body: string } {
  // Locate `export const meta =`
  const declarationMatch = source.match(/export\s+const\s+meta\s*=\s*/)
  if (declarationMatch?.index === undefined) {
    return { meta: null, body: source }
  }

  const declStart = declarationMatch.index
  const afterEquals = declStart + declarationMatch[0].length

  // Find the first `{` after `=`
  let objStart = afterEquals
  while (objStart < source.length && source[objStart] !== '{') {
    // Skip whitespace and comments between `=` and `{`
    if (source[objStart] === '/' && source[objStart + 1] === '/') {
      // Line comment — skip to end of line
      objStart = source.indexOf('\n', objStart)
      if (objStart === -1) return { meta: null, body: source }
      continue
    }
    if (source[objStart] === '/' && source[objStart + 1] === '*') {
      // Block comment — skip to `*/`
      objStart = source.indexOf('*/', objStart + 2)
      if (objStart === -1) return { meta: null, body: source }
      objStart += 2
      continue
    }
    const char = source[objStart]
    if (char !== undefined && !/\s/.test(char)) {
      // Non-whitespace, non-brace — not a valid meta export
      return { meta: null, body: source }
    }
    objStart++
  }

  if (objStart >= source.length) {
    return { meta: null, body: source }
  }

  // Walk with brace-depth counter, skipping strings and comments
  let depth = 0
  let i = objStart
  while (i < source.length) {
    const ch = source[i]
    if (ch === undefined) break

    // Single-line comment
    if (ch === '/' && source[i + 1] === '/') {
      i = source.indexOf('\n', i)
      if (i === -1) break
      i++
      continue
    }

    // Block comment
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      if (end === -1) break
      i = end + 2
      continue
    }

    // Double-quoted string
    if (ch === '"') {
      i++
      while (i < source.length && source[i] !== '"') {
        if (source[i] === '\\') i++
        i++
      }
      i++ // skip closing quote
      continue
    }

    // Single-quoted string
    if (ch === "'") {
      i++
      while (i < source.length && source[i] !== "'") {
        if (source[i] === '\\') i++
        i++
      }
      i++ // skip closing quote
      continue
    }

    // Template literal
    if (ch === '`') {
      i++
      while (i < source.length && source[i] !== '`') {
        if (source[i] === '\\') {
          i++
        } else if (source[i] === '$' && source[i + 1] === '{') {
          // Skip template expression — simple approach: count braces
          i += 2
          let tplDepth = 1
          while (i < source.length && tplDepth > 0) {
            if (source[i] === '{') tplDepth++
            else if (source[i] === '}') tplDepth--
            i++
          }
          continue
        }
        i++
      }
      i++ // skip closing backtick
      continue
    }

    // Braces
    if (ch === '{') {
      depth++
      i++
      continue
    }
    if (ch === '}') {
      depth--
      if (depth === 0) {
        // Found the matching closing brace
        const objEnd = i + 1

        // Extract object text and parse with JSON5
        const metaText = source.slice(objStart, objEnd)
        let meta: ScriptMeta | null = null
        try {
          meta = JSON5.parse(metaText) as ScriptMeta
        } catch {
          meta = null
        }

        // Determine full match range for body stripping:
        // from `export` to after `}` + optional `;` + whitespace/newline
        let fullEnd = objEnd
        // Skip trailing whitespace
        while (fullEnd < source.length) {
          const c = source[fullEnd]
          if (c === undefined || !/[ \t]/.test(c)) break
          fullEnd++
        }
        // Skip optional semicolon
        if (fullEnd < source.length && source[fullEnd] === ';') fullEnd++
        // Skip trailing whitespace
        while (fullEnd < source.length) {
          const c = source[fullEnd]
          if (c === undefined || !/[ \t]/.test(c)) break
          fullEnd++
        }
        // Skip one newline
        if (fullEnd < source.length && source[fullEnd] === '\n') fullEnd++
        else if (
          fullEnd < source.length &&
          source[fullEnd] === '\r' &&
          source[fullEnd + 1] === '\n'
        )
          fullEnd += 2

        const body = source.slice(0, declStart) + source.slice(fullEnd)
        return { meta, body }
      }
      i++
      continue
    }

    i++
  }

  // Never found matching closing brace
  return { meta: null, body: source }
}
