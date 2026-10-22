import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// Compile application TypeScript for Node's built-in test runner; no test framework dependency.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'hls.js') return nextResolve(new URL('./fixtures/Hls.mjs', import.meta.url).href, context)
    if (specifier.startsWith('.') && context.parentURL) {
      const url = new URL(specifier, context.parentURL)
      if (!/\.[cm]?[jt]sx?$/.test(url.pathname)) {
        for (const extension of ['.ts', '.tsx']) {
          const candidate = new URL(url)
          candidate.pathname += extension
          if (existsSync(candidate)) return nextResolve(candidate.href, context)
        }
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (/\.tsx?$/.test(new URL(url).pathname) && url.startsWith('file:')) {
      const filename = fileURLToPath(url)
      const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
        fileName: filename,
      }).outputText
      return { format: 'module', source, shortCircuit: true }
    }
    return nextLoad(url, context)
  },
})
