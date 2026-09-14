/** Lexical review identity; Host filesystem access must still be validated separately. */
interface ReviewPath {
  readonly root: string
  readonly segments: readonly string[]
  readonly windows: boolean
  readonly driveRelative: boolean
}
function parsePath(path: string, windowsContext?: boolean): ReviewPath {
  // A POSIX cwd wins over Windows-looking literal filenames. Without a cwd,
  // only explicit drive/UNC syntax establishes Windows separator semantics.
  const explicitWindows =
    /^[a-z]:/i.test(path) || path.startsWith('\\\\') || /^\/\/[^/]+\/[^/]+/.test(path)
  const windowsSyntax = windowsContext !== false && (windowsContext === true || explicitWindows)
  const slash = windowsSyntax ? path.replace(/\\/g, '/') : path
  const drive = windowsContext === false ? null : /^([a-z]:)(\/|$)/i.exec(slash)
  const unc = windowsContext === false ? null : /^\/\/([^/]+)\/+([^/]+)(?:\/|$)/.exec(slash)
  const driveRelative =
    windowsContext !== false && (/^[a-z]:[^/]/i.test(slash) || /^[a-z]:$/i.test(slash))
  if (driveRelative) return { root: '', segments: [slash], windows: true, driveRelative: true }
  let root = '',
    rest = slash
  let windows: boolean = false
  if (drive !== null) {
    root = `${drive[1]}/`
    rest = slash.slice(drive[0].length)
    windows = true
  } else if (unc !== null) {
    root = `//${unc[1]}/${unc[2]}/`
    rest = slash.slice(unc[0].length)
    windows = true
  } else if (slash.startsWith('/')) {
    root = '/'
    rest = slash.replace(/^\/+/, '')
  }
  const segments: string[] = []
  for (const segment of rest.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (segments.length > 0 && segments.at(-1) !== '..') segments.pop()
      else if (root === '') segments.push(segment)
    } else segments.push(segment)
  }
  return { root, segments, windows, driveRelative }
}
function formatPath(path: ReviewPath): string {
  return `${path.root}${path.segments.join('/')}` || '.'
}
function rootContext(root: ReviewPath | undefined): boolean | undefined {
  return root !== undefined && root.root !== '' && !root.driveRelative ? root.windows : undefined
}
function resolveReviewPath(path: string, projectRoot?: string): ReviewPath {
  const root = projectRoot ? parsePath(projectRoot) : undefined
  const parsed = parsePath(path, rootContext(root))
  if (root === undefined || root.root === '' || root.driveRelative || parsed.driveRelative)
    return parsed
  const absolute =
    parsed.root === ''
      ? parsePath(`${formatPath(root).replace(/\/$/, '')}/${path}`, root.windows)
      : parsed
  const key = (value: string): string => (root.windows ? value.toLowerCase() : value)
  if (
    absolute.windows === root.windows &&
    key(absolute.root) === key(root.root) &&
    root.segments.every((segment, index) => key(segment) === key(absolute.segments[index] ?? ''))
  ) {
    return { ...absolute, root: '', segments: absolute.segments.slice(root.segments.length) }
  }
  return absolute
}
/** Use workspace-relative paths only when an absolute root proves containment. */
export function canonicalReviewPath(path: string, projectRoot?: string): string {
  return formatPath(resolveReviewPath(path, projectRoot))
}
/** Resolve an editor action without changing filename characters on POSIX. */
export function absoluteReviewPath(path: string, projectRoot?: string): string {
  const root = projectRoot ? parsePath(projectRoot) : undefined
  const parsed = parsePath(path, rootContext(root))
  if (
    parsed.root !== '' ||
    parsed.driveRelative ||
    root === undefined ||
    root.root === '' ||
    root.driveRelative
  )
    return formatPath(parsed)
  return formatPath(parsePath(`${formatPath(root).replace(/\/$/, '')}/${path}`, root.windows))
}
/** Case-fold Windows identities, preserving POSIX case and literal backslashes. */
export function reviewPathKey(path: string, projectRoot?: string): string {
  const resolved = resolveReviewPath(path, projectRoot)
  const canonical = formatPath(resolved)
  return resolved.windows ? canonical.toLowerCase() : canonical
}
