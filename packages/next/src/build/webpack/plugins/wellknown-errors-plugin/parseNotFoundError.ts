import Chalk from 'next/dist/compiled/chalk'
import { SimpleWebpackError } from './simpleWebpackError'
import { createOriginalStackFrame } from 'next/dist/compiled/@next/react-dev-overlay/dist/middleware'
import type { webpack } from 'next/dist/compiled/webpack/webpack'

const chalk = new Chalk.constructor({ enabled: true })

// Based on https://github.com/webpack/webpack/blob/fcdd04a833943394bbb0a9eeb54a962a24cc7e41/lib/stats/DefaultStatsFactoryPlugin.js#L422-L431
/*
Copyright JS Foundation and other contributors

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/
function getModuleTrace(input: any, compilation: any) {
  const visitedModules = new Set()
  const moduleTrace = []
  let current = input.module
  while (current) {
    if (visitedModules.has(current)) break // circular (technically impossible, but who knows)
    visitedModules.add(current)
    const origin = compilation.moduleGraph.getIssuer(current)
    if (!origin) break
    moduleTrace.push({ origin, module: current })
    current = origin
  }

  return moduleTrace
}

export async function getNotFoundError(
  compilation: webpack.Compilation,
  input: any,
  fileName: string
) {
  if (input.name !== 'ModuleNotFoundError') {
    return false
  }

  const loc = input.loc
    ? input.loc
    : input.dependencies.map((d: any) => d.loc).filter(Boolean)[0]
  const originalSource = input.module.originalSource()

  try {
    const result = await createOriginalStackFrame({
      line: loc.start.line,
      column: loc.start.column,
      source: originalSource,
      rootDirectory: compilation.options.context!,
      modulePath: fileName,
      frame: {},
    })

    // If we could not result the original location we still need to show the existing error
    if (!result) {
      return input
    }

    const errorMessage = input.error.message
      .replace(/ in '.*?'/, '')
      .replace(/Can't resolve '(.*)'/, `Can't resolve '${chalk.green('$1')}'`)

    const importTrace = () => {
      const moduleTrace = getModuleTrace(input, compilation)
        .map(({ origin }) =>
          origin.readableIdentifier(compilation.requestShortener)
        )
        .filter(
          (name) =>
            name &&
            !/next-(app|middleware|client-pages|flight-(client|server|client-entry))-loader\.js/.test(
              name
            )
        )
      if (moduleTrace.length === 0) return ''

      return `\nImport trace for requested module:\n${moduleTrace.join(
        '\n'
      )}\n\n`
    }

    const frame = result.originalCodeFrame ?? ''

    let message =
      chalk.red.bold('Module not found') +
      `: ${errorMessage}` +
      '\n' +
      frame +
      (frame !== '' ? '\n' : '') +
      importTrace() +
      '\nhttps://nextjs.org/docs/messages/module-not-found'

    return new SimpleWebpackError(
      `${chalk.cyan(fileName)}:${chalk.yellow(
        result.originalStackFrame.lineNumber?.toString() ?? ''
      )}:${chalk.yellow(result.originalStackFrame.column?.toString() ?? '')}`,
      message
    )
  } catch (err) {
    // Don't fail on failure to resolve sourcemaps
    return input
  }
}

export async function getImageError(
  compilation: any,
  input: any,
  err: Error
): Promise<SimpleWebpackError | false> {
  if (err.name !== 'InvalidImageFormatError') {
    return false
  }

  const moduleTrace = getModuleTrace(input, compilation)
  const { origin, module } = moduleTrace[0] || {}
  if (!origin || !module) {
    return false
  }
  const page = origin.rawRequest.replace(/^private-next-pages/, './pages')
  const importedFile = module.rawRequest
  const source = origin.originalSource().buffer().toString('utf8') as string
  let lineNumber = -1
  source.split('\n').some((line) => {
    lineNumber++
    return line.includes(importedFile)
  })
  return new SimpleWebpackError(
    `${chalk.cyan(page)}:${chalk.yellow(lineNumber.toString())}`,
    chalk.red
      .bold('Error')
      .concat(
        `: Image import "${importedFile}" is not a valid image file. The image may be corrupted or an unsupported format.`
      )
  )
}
