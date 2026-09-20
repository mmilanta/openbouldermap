// Viewer-side indirection for in-memory route edits.
//
// The viewer's sidebar renders route lists without importing the editor. In
// view mode there are no local edits, so the default resolver returns the
// properties untouched. When the editor loads (only in edit mode) it installs
// a resolver backed by its EditGraph.
type Resolver = (props: Record<string, any>) => Record<string, any>

let resolve: Resolver = props => props

export function setLocalRouteEdits(fn: Resolver): void {
  resolve = fn
}

export function withLocalRouteEdits(props: Record<string, any>): Record<string, any> {
  return resolve(props)
}
