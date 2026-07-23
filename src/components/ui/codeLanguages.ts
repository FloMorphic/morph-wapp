import { LanguageSupport, StreamLanguage } from '@codemirror/language'
import { completeFromList } from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import { json } from '@codemirror/lang-json'
import { javascript } from '@codemirror/lang-javascript'

/**
 * Language registry for CodeEditor. JSON and JavaScript come from the official
 * packages (both ship their own completion sources — lang-javascript adds
 * scope-aware locals + snippets). OPA/Rego has no official CodeMirror 6 mode,
 * so we define a small StreamLanguage tokenizer plus keyword/builtin
 * completions, enough for policy-sized documents.
 */
export type EditorLanguage = 'json' | 'js' | 'opa'

const REGO_KEYWORDS = [
  'package', 'import', 'default', 'not', 'some', 'every', 'in', 'if', 'else',
  'with', 'as', 'contains',
]
const REGO_ATOMS = ['true', 'false', 'null', 'input', 'data']
// Common builtins, enough for completion to be useful without the full stdlib.
const REGO_BUILTINS = [
  'count', 'sum', 'product', 'max', 'min', 'sort', 'all', 'any', 'abs', 'round',
  'ceil', 'floor', 'concat', 'contains', 'startswith', 'endswith', 'format_int',
  'indexof', 'lower', 'upper', 'replace', 'split', 'sprintf', 'substring',
  'trim', 'trim_left', 'trim_right', 'trim_space', 'to_number', 'is_string',
  'is_number', 'is_boolean', 'is_array', 'is_object', 'is_null', 'array.concat',
  'array.slice', 'object.get', 'object.keys', 'object.union', 'json.marshal',
  'json.unmarshal', 'base64.encode', 'base64.decode', 'time.now_ns',
  'regex.match', 'walk', 'print',
]

const regoWord = /[\w.]/

const regoStream = StreamLanguage.define({
  name: 'rego',
  languageData: {
    commentTokens: { line: '#' },
    closeBrackets: { brackets: ['(', '[', '{', '"', '`'] },
  },
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.match('#')) {
      stream.skipToEnd()
      return 'comment'
    }
    // Strings: interpreted ("…" with escapes) and raw (`…`).
    if (stream.match('"')) {
      let escaped = false
      let ch: string | void
      while ((ch = stream.next())) {
        if (ch === '"' && !escaped) break
        escaped = !escaped && ch === '\\'
      }
      return 'string'
    }
    if (stream.match('`')) {
      let ch: string | void
      while ((ch = stream.next())) if (ch === '`') break
      return 'string'
    }
    if (stream.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)) return 'number'
    if (stream.match(/^:=|^==|^!=|^<=|^>=|^[+\-*/%<>=|&]/)) return 'operator'
    if (stream.match(/^[a-zA-Z_][\w.]*/)) {
      const word = stream.current()
      if (REGO_KEYWORDS.includes(word)) return 'keyword'
      if (REGO_ATOMS.includes(word)) return 'atom'
      if (REGO_BUILTINS.includes(word)) return 'builtin'
      return 'variableName'
    }
    stream.next()
    return null
  },
})

const regoCompletions = regoStream.data.of({
  autocomplete: completeFromList([
    ...REGO_KEYWORDS.map((label) => ({ label, type: 'keyword' })),
    ...REGO_ATOMS.map((label) => ({ label, type: 'constant' })),
    ...REGO_BUILTINS.map((label) => ({ label, type: 'function' })),
  ]),
})

export function languageFor(lang: EditorLanguage): Extension {
  switch (lang) {
    case 'js':
      return javascript()
    case 'opa':
      return new LanguageSupport(regoStream, regoCompletions)
    default:
      return json()
  }
}
