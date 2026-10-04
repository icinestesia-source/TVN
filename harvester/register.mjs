// Lets Node run Harvester and the TVN modules it shares straight from TypeScript: those modules import JSON
// the way Vite does, without an import attribute, so one is added here.
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context)
    return resolved.url.endsWith('.json') ? { ...resolved, importAttributes: { ...context.importAttributes, type: 'json' } } : resolved
  },
})
