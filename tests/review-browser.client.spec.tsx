// @vitest-environment jsdom
/** Session review browsing uses recorded turns, never current file contents. */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  FileReviewTab,
  reviewTargetFrom,
  type FileReviewTabProps,
} from '../src/client/FileReviewTab.tsx'
import { DEFAULT_WORD_WRAP_SOURCE } from '../src/client/ReviewContent.tsx'
import { en } from '../src/client/locales.ts'
import { clearAllReviewComments } from '../src/client/review-comments.ts'
import type { DeliverablesTurnData } from '../src/client/turn-deliverables.ts'

const DATA_KEY = 'diff-review-likecodex.deliverables'
const t: FileReviewTabProps['t'] = (key, params) =>
  en[key].replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match))

function store<T>(initial: T) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    listeners,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    publish(next: T) {
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

function recordedTurn(turn: number, paths: string[] = [], readOnly = false): TurnLocation {
  const records: DeliverablesTurnData = {
    produced: paths.map((path, index) => ({
      seq: turn * 10 + index,
      path,
      diffs: [{ path, oldText: `old recorded ${path}`, newText: `new recorded ${path}` }],
      ...(readOnly ? { readOnly: true as const, complete: false as const } : {}),
    })),
  }
  return {
    turn,
    status: 'closed',
    start: undefined,
    end: undefined,
    steps: [],
    data: { get: (key: string) => (key === DATA_KEY ? records : undefined) },
  } as unknown as TurnLocation
}

function snapshot(turns: TurnLocation[]): ChatSnapshot {
  return {
    timeline: {
      turnOrder: turns.map(({ turn }) => turn),
      turns: new Map(turns.map((item) => [item.turn, item])),
    },
  } as ChatSnapshot
}

function fixture(
  turns = [recordedTurn(1, ['old.ts']), recordedTurn(2, ['a.ts', 'b.ts']), recordedTurn(3)],
) {
  const chats = {
    'session-a': store(snapshot(turns)),
    'session-b': store(
      snapshot([recordedTurn(1, ['other-old.ts']), recordedTurn(8, ['other-latest.ts'])]),
    ),
  }
  const bindings = { 'session-a': { id: 'session-a' }, 'session-b': { id: 'session-b' } }
  const list = store({
    byId: { 'session-a': { cwd: '/workspace' }, 'session-b': { cwd: '/other' } },
  })
  const bind = vi.fn((id: keyof typeof bindings) => bindings[id])
  const target = vi.fn((binding: { id: keyof typeof chats }) => ({
    target: (kind: string) => (kind === 'chat' ? chats[binding.id] : undefined),
  }))
  const openFile = vi.fn()
  const props = {
    sessions: { list, binding: bind },
    uiConversation: { binding: target },
    sessionId: 'session-a',
    params: undefined,
    visible: true,
    wordWrap: DEFAULT_WORD_WRAP_SOURCE,
    openFile,
    t,
  } as unknown as FileReviewTabProps
  return { props, chats, list, openFile, bind, target }
}

afterEach(() => {
  cleanup()
  clearAllReviewComments()
  window.localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('session review browser', () => {
  it.each([undefined, null])(
    'opens without params (%s) at the latest recorded turn, not the latest empty turn',
    (params) => {
      const f = fixture()
      const view = render(<FileReviewTab {...f.props} params={params} />)
      expect(view.getByText('a.ts')).toBeTruthy()
      expect(view.getByText('b.ts')).toBeTruthy()
      expect(view.queryByText('old.ts')).toBeNull()
      const picker = view.getByRole('combobox', {
        name: en['review.turnPicker'],
      }) as HTMLSelectElement
      expect(picker.value).toBe('latest')
      expect(Array.from(picker.options, (option) => option.value)).toEqual(['latest', '2', '1'])
      expect(f.bind).toHaveBeenCalledWith('session-a')
      expect(f.openFile).not.toHaveBeenCalled()
    },
  )

  it('loads every recorded edit settlement from the selected turn only', () => {
    const turn = 2
    const records: DeliverablesTurnData = {
      produced: [
        {
          seq: 20,
          path: 'a.ts',
          diffs: [{ path: 'a.ts', oldText: 'first before', newText: 'first after' }],
        },
        {
          seq: 21,
          path: 'a.ts',
          diffs: [{ path: 'a.ts', oldText: 'second before', newText: 'second after' }],
        },
        {
          seq: 22,
          path: 'b.ts',
          diffs: [{ path: 'b.ts', oldText: 'other before', newText: 'other after' }],
        },
      ],
    }
    const selected = {
      ...recordedTurn(turn),
      data: { get: (key: string) => (key === DATA_KEY ? records : undefined) },
    } as unknown as TurnLocation
    const f = fixture([recordedTurn(1, ['old.ts']), selected])
    const view = render(<FileReviewTab {...f.props} />)

    for (const text of [
      'first before',
      'first after',
      'second before',
      'second after',
      'other before',
      'other after',
    ])
      expect(view.getByText(text)).toBeTruthy()
    expect(view.queryByText('old.ts')).toBeNull()
    expect(view.getByText('a.ts')).toBeTruthy()
    expect(view.getByText('b.ts')).toBeTruthy()
  })

  it('pins a manually selected older turn, then follows new recorded turns after selecting latest', () => {
    const f = fixture()
    const view = render(<FileReviewTab {...f.props} />)
    const picker = view.getByRole('combobox', { name: en['review.turnPicker'] })
    fireEvent.change(picker, { target: { value: '1' } })
    expect(view.getByText('old.ts')).toBeTruthy()
    expect(view.queryByText('a.ts')).toBeNull()
    act(() =>
      f.chats['session-a'].publish(
        snapshot([recordedTurn(1, ['old.ts']), recordedTurn(4, ['four.ts'])]),
      ),
    )
    expect(view.getByText('old.ts')).toBeTruthy()
    expect(view.queryByText('four.ts')).toBeNull()
    fireEvent.change(picker, { target: { value: 'latest' } })
    expect(view.getByText('four.ts')).toBeTruthy()
    act(() =>
      f.chats['session-a'].publish(
        snapshot([recordedTurn(1, ['old.ts']), recordedTurn(4, ['four.ts']), recordedTurn(5)]),
      ),
    )
    expect(view.getByText('four.ts')).toBeTruthy()
    act(() =>
      f.chats['session-a'].publish(
        snapshot([
          recordedTurn(1, ['old.ts']),
          recordedTurn(4, ['four.ts']),
          recordedTurn(5, ['five.ts']),
        ]),
      ),
    )
    expect(view.getByText('five.ts')).toBeTruthy()
    expect(view.queryByText('four.ts')).toBeNull()
  })

  it('honors a single-file target even when both files precede its closing sequence, then restores the turn', () => {
    const f = fixture()
    const params = { turn: 2, closingSeq: 21, focusPaths: ['/workspace/a.ts'] }
    const view = render(<FileReviewTab {...f.props} params={params} />)
    expect(view.getByText('a.ts')).toBeTruthy()
    expect(view.queryByText('b.ts')).toBeNull()
    fireEvent.click(view.getByRole('button', { name: en['review.allFiles'] }))
    expect(view.getByText('a.ts')).toBeTruthy()
    expect(view.getByText('b.ts')).toBeTruthy()
    expect(view.queryByText('old.ts')).toBeNull()
    expect(view.queryByRole('button', { name: en['review.allFiles'] })).toBeNull()
    expect(
      (view.getByRole('combobox', { name: en['review.turnPicker'] }) as HTMLSelectElement).value,
    ).toBe('2')
    expect(params).toEqual({ turn: 2, closingSeq: 21, focusPaths: ['/workspace/a.ts'] })
  })

  it('replaces local selection when a new navigation target arrives', () => {
    const f = fixture()
    const view = render(<FileReviewTab {...f.props} />)
    fireEvent.change(view.getByRole('combobox', { name: en['review.turnPicker'] }), {
      target: { value: '1' },
    })
    view.rerender(
      <FileReviewTab {...f.props} params={{ turn: 2, closingSeq: 21, focusPaths: ['b.ts'] }} />,
    )
    expect(view.getByText('b.ts')).toBeTruthy()
    expect(view.queryByText('old.ts')).toBeNull()
    expect(view.queryByText('a.ts')).toBeNull()
  })

  it('does not leak a local turn into another session with the same turn number, and cleans up subscriptions', () => {
    const f = fixture()
    const view = render(<FileReviewTab {...f.props} />)
    fireEvent.change(view.getByRole('combobox', { name: en['review.turnPicker'] }), {
      target: { value: '1' },
    })
    view.rerender(
      <FileReviewTab {...f.props} sessionId={'session-b' as FileReviewTabProps['sessionId']} />,
    )
    expect(view.getByText('other-latest.ts')).toBeTruthy()
    expect(view.queryByText('other-old.ts')).toBeNull()
    expect(view.queryByText('old.ts')).toBeNull()
    expect(
      (view.getByRole('combobox', { name: en['review.turnPicker'] }) as HTMLSelectElement).value,
    ).toBe('latest')
    expect(f.chats['session-a'].listeners.size).toBe(0)
    act(() => f.chats['session-a'].publish(snapshot([recordedTurn(99, ['stale.ts'])])))
    expect(view.queryByText('stale.ts')).toBeNull()
    view.unmount()
    expect(f.chats['session-b'].listeners.size).toBe(0)
    expect(f.list.listeners.size).toBe(0)
  })

  it.each([
    ['POSIX root', '/workspace', '/workspace/src/中文 #.ts'],
    ['Windows root', 'C:\\workspace', 'C:/workspace/src/中文 #.ts'],
  ])(
    'opens a recorded relative file as an absolute path with a %s',
    (_name, projectRoot, expected) => {
      const f = fixture([recordedTurn(1, ['src/中文 #.ts'])])
      const view = render(<FileReviewTab {...f.props} projectRoot={projectRoot} />)
      fireEvent.click(view.getByRole('button', { name: en['review.openInEditor'] }))
      expect(f.openFile).toHaveBeenCalledExactlyOnceWith(expected)
    },
  )

  it('shows a legacy read-only note and stored diff without fetching or opening the current file', () => {
    const fetch = vi.fn(() => Promise.reject(new Error('Current disk must not be read')))
    vi.stubGlobal('fetch', fetch)
    const f = fixture([recordedTurn(1, ['legacy.ts'], true)])
    const view = render(<FileReviewTab {...f.props} />)
    expect(view.getByRole('note').textContent).toBe(en['review.legacyReadOnly'])
    expect(view.getByText('old recorded legacy.ts')).toBeTruthy()
    expect(view.getByText('new recorded legacy.ts')).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
    expect(f.openFile).not.toHaveBeenCalled()
  })

  it('reports no recorded changes and a missing session without stale file contents', () => {
    const f = fixture([recordedTurn(1)])
    const view = render(<FileReviewTab {...f.props} />)
    expect(view.getByRole('status').textContent).toBe(en['review.noSessionChanges'])
    view.rerender(
      <FileReviewTab {...f.props} sessionId={'missing' as FileReviewTabProps['sessionId']} />,
    )
    expect(view.getByRole('status').textContent).toBe(en['review.sidebarSessionUnavailable'])
  })
})

const validTarget = { turn: 1, closingSeq: 10, focusPaths: ['old.ts'] }
describe('review target validation', () => {
  it.each([
    ['primitive', '1'],
    ['missing fields', {}],
    ['negative turn', { ...validTarget, turn: -1 }],
    ['fractional turn', { ...validTarget, turn: 1.5 }],
    ['unsafe turn', { ...validTarget, turn: Number.MAX_SAFE_INTEGER + 1 }],
    ['negative sequence', { ...validTarget, closingSeq: -1 }],
    ['infinite sequence', { ...validTarget, closingSeq: Infinity }],
    ['NaN sequence', { ...validTarget, closingSeq: NaN }],
    ['fractional sequence', { ...validTarget, closingSeq: 1.5 }],
    ['non-array paths', { ...validTarget, focusPaths: 'old.ts' }],
    ['non-string path', { ...validTarget, focusPaths: [1] }],
  ])('rejects %s instead of falling back silently to recent files', (_name, params) => {
    expect(reviewTargetFrom(params)).toBeUndefined()
    const f = fixture()
    const view = render(<FileReviewTab {...f.props} params={params} />)
    expect(view.getByRole('status').textContent).toBe(en['review.sidebarTargetUnavailable'])
    expect(view.queryByText('a.ts')).toBeNull()
    expect(view.queryByRole('combobox')).toBeNull()
  })

  it('accepts zero and the finite live-sequence sentinel, while a missing valid turn stays empty', () => {
    expect(
      reviewTargetFrom({ turn: 0, closingSeq: Number.MAX_SAFE_INTEGER, focusPaths: [] }),
    ).toEqual({ turn: 0, closingSeq: Number.MAX_SAFE_INTEGER, focusPaths: [] })
    const f = fixture()
    const view = render(<FileReviewTab {...f.props} params={{ ...validTarget, turn: 99 }} />)
    expect(view.getByRole('status').textContent).toBe(en['review.sidebarDataUnavailable'])
    expect(view.queryByText('a.ts')).toBeNull()
  })
})
