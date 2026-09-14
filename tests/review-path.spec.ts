import { describe, expect, it } from 'vitest'
import { absoluteReviewPath, canonicalReviewPath, reviewPathKey } from '../src/review-path.ts'

describe('review path identity', () => {
  it('preserves POSIX literal backslashes and drive-looking filenames', () => {
    const literal = String.raw`src\name.txt`
    expect(canonicalReviewPath(literal, '/work')).toBe(literal)
    expect(reviewPathKey(literal, '/work')).not.toBe(reviewPathKey('src/name.txt', '/work'))
    expect(absoluteReviewPath(literal, '/work')).toBe(`/work/${literal}`)
    expect(canonicalReviewPath(`/work/${literal}`, '/work')).toBe(literal)
    expect(canonicalReviewPath(String.raw`C:\literal.txt`, '/work')).toBe(
      String.raw`C:\literal.txt`,
    )
    expect(canonicalReviewPath(literal, 'C:/work')).toBe('src/name.txt')
  })
  it.each([
    ['src/./feature/../index.ts', '/work/app', 'src/index.ts'],
    ['/work/app/src/index.ts', '/work/app/', 'src/index.ts'],
    ['/work/app/../app/src/index.ts', '/work/app', 'src/index.ts'],
    ['C:\\Work\\App\\src\\Index.ts', 'c:/work/app', 'src/Index.ts'],
    ['.\\src\\feature\\..\\Index.ts', 'C:\\Work\\App\\', 'src/Index.ts'],
    ['\\\\Server\\Share\\App\\src\\Index.ts', '//server/share/app', 'src/Index.ts'],
    ['src/Index.ts', '//server/share/app', 'src/Index.ts'],
    ['/work/app', '/work/app', '.'],
    ['C:/', 'c:/', '.'],
    ['//server/share', '//SERVER/SHARE/', '.'],
    ['C:/../../src/index.ts', 'C:/', 'src/index.ts'],
    ['//server/share/../../src/index.ts', '//server/share', 'src/index.ts'],
    ['/../../src/index.ts', '/', 'src/index.ts'],
    ['../other/index.ts', '/work/app', '/work/other/index.ts'],
    ['/work/application/index.ts', '/work/app', '/work/application/index.ts'],
    ['/work/App/index.ts', '/work/app', '/work/App/index.ts'],
    ['D:/work/app/index.ts', 'C:/work/app', 'D:/work/app/index.ts'],
    ['//server/share-other/index.ts', '//server/share', '//server/share-other/index.ts'],
    ['/src/Index.ts', 'C:/work/app', '/src/Index.ts'],
    ['C:src/index.ts', 'C:/work/app', 'C:src/index.ts'],
    ['src/../index.ts', undefined, 'index.ts'],
    ['../src/index.ts', undefined, '../src/index.ts'],
    ['/work/app/index.ts', undefined, '/work/app/index.ts'],
    ['src/index.ts', 'relative/root', 'src/index.ts'],
  ])('canonicalizes %s under %s as %s', (path, root, expected) => {
    expect(canonicalReviewPath(path, root)).toBe(expected)
    expect(canonicalReviewPath(expected, root)).toBe(expected)
  })

  it('unifies duplicate root aliases and Windows case without changing display case', () => {
    const root = 'C:\\Work\\App'
    const aliases = ['C:\\WORK\\APP\\src\\Index.ts', './src/index.ts', 'src\\INDEX.ts']
    expect(new Set(aliases.map((path) => reviewPathKey(path, root)))).toEqual(
      new Set(['src/index.ts']),
    )
    expect(canonicalReviewPath(aliases[0]!, root)).toBe('src/Index.ts')
    expect(reviewPathKey('\\\\Server\\Share\\App\\INDEX.ts', '//server/share/app')).toBe('index.ts')
    expect(reviewPathKey('C:\\WORK\\Index.ts')).toBe('c:/work/index.ts')
    expect(reviewPathKey('//SERVER/Share/INDEX.ts')).toBe('//server/share/index.ts')
  })

  it('never merges basenames, POSIX case, root-prefix siblings, or unresolved absolute/relative paths', () => {
    expect(reviewPathKey('/work/app/a/index.ts', '/work/app')).not.toBe(
      reviewPathKey('b/index.ts', '/work/app'),
    )
    expect(reviewPathKey('src/Index.ts', '/work/app')).not.toBe(
      reviewPathKey('src/index.ts', '/work/app'),
    )
    expect(reviewPathKey('/work/application/index.ts', '/work/app')).not.toBe(
      reviewPathKey('index.ts', '/work/app'),
    )
    expect(reviewPathKey('/work/app/index.ts')).not.toBe(reviewPathKey('index.ts'))
    expect(reviewPathKey('C:/work/app/index.ts')).not.toBe(reviewPathKey('index.ts'))
    expect(reviewPathKey('//server/share/index.ts')).not.toBe(reviewPathKey('index.ts'))
    expect(reviewPathKey('/src/Index.ts', 'C:/work/app')).toBe('/src/Index.ts')
    expect(reviewPathKey('C:index.ts', 'C:/work/app')).not.toBe(
      reviewPathKey('index.ts', 'C:/work/app'),
    )
  })
})
