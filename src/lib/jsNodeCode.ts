/**
 * Small source-level fix-ups for the code a `js` node runs.
 *
 * A `js` node has no function wrapper: the runtime evaluates the code and takes
 * the value of its LAST EXPRESSION as the node output (see the designer prompt
 * in aiGraph.ts and the completion-value contract in the engine). The one
 * mistake a person editing by hand reliably makes is ending the code with a
 * `return` — there is nothing to return from, and `return { … }` either fails
 * (a leading `{` parses as a block) or emits nothing. The generator is already
 * told not to; this rescues the hand-written case.
 */

/**
 * Rewrite a trailing top-level `return <expr>` into `;(<expr>)`.
 *
 * `;( <expr> )` is an expression statement, so its value becomes the node
 * output — and wrapping in parens forces a leading `{` to parse as an object
 * rather than a block. The leading `;` stops the previous line from swallowing
 * the `(` via automatic semicolon insertion (`foo()\n(x)` would be one call).
 *
 * Only the LAST statement is touched, and only when it is a bare `return` on its
 * own line — a `return` inside a callback is legitimate and left alone, as is a
 * multi-line returned literal (its last line is not the `return`). A bare
 * `return` with no value becomes `undefined`. Anything with no trailing return
 * (including OPA/Rego) is returned unchanged.
 */
export function normalizeJsReturn(code: string): string {
  const lines = code.split('\n')

  // The last line that actually runs — skip trailing blanks and line comments.
  let i = lines.length - 1
  while (i >= 0) {
    const t = lines[i].trim()
    if (t === '' || t.startsWith('//')) i--
    else break
  }
  if (i < 0) return code

  const m = lines[i].match(/^(\s*)return\b[ \t]*(.*?)\s*;?\s*$/)
  if (!m) return code

  const [, indent, expr] = m
  lines[i] = expr ? `${indent};(${expr})` : `${indent}undefined`
  return lines.join('\n')
}
