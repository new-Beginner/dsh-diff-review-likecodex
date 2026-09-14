// @vitest-environment jsdom
/** Live composer review summary and the native tab's turn-scoped live target. */
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  ConversationLocationDataSource,
  ConversationLocationDataStore,
  ConversationTurnDataMap,
  TurnLocation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { FileReviewTab, type ReviewTarget } from '../src/client/FileReviewTab.tsx'
import { LiveReviewDock, type LiveReviewDockProps } from '../src/client/LiveReviewDock.tsx'
import { en, zh } from '../src/client/locales.ts'
import { clearAllReviewComments } from '../src/client/review-comments.ts'
import type { DeliverablesTurnData, ProducedFileDiff } from '../src/client/turn-deliverables.ts'
import css from '../src/client/ProducedFiles.module.css'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  clearAllReviewComments()
  vi.restoreAllMocks()
})

/** Select inside getSnapshot, as standard hooks do: unchanged leaves do not force renders. */
function externalStore<Snapshot>(initial: Snapshot) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const getSnapshot = () => snapshot
  const unsubscribe = vi.fn()
  const subscribe = vi.fn((listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      unsubscribe()
    }
  })
  return {
    getSnapshot,
    subscribe,
    unsubscribe,
    listeners,
    publish(next: Snapshot) {
      snapshot = next
      for (const listener of listeners) listener()
    },
    useSelector<Value>(select: (value: Snapshot) => Value): Value {
      const getSelected = () => select(getSnapshot())
      return useSyncExternalStore(subscribe, getSelected, getSelected)
    },
  }
}

/** Match the real stable reader/source contract without replacing TurnLocation on updates. */
class TestTurnDataStore implements ConversationLocationDataStore<ConversationTurnDataMap> {
  private readonly stores = new Map<string, ReturnType<typeof externalStore<unknown>>>()

  source<Key extends keyof ConversationTurnDataMap & string>(
    key: Key,
  ): ConversationLocationDataSource<Readonly<ConversationTurnDataMap[Key]> | undefined> {
    let store = this.stores.get(key)
    if (store === undefined) {
      store = externalStore<unknown>(undefined)
      this.stores.set(key, store)
    }
    return store as ConversationLocationDataSource<
      Readonly<ConversationTurnDataMap[Key]> | undefined
    >
  }

  get<Key extends keyof ConversationTurnDataMap & string>(key: Key) {
    return this.source(key).getSnapshot()
  }

  set<Key extends keyof ConversationTurnDataMap & string>(
    key: Key,
    value: ConversationTurnDataMap[Key],
  ) {
    this.source(key)
    this.stores.get(key)!.publish(value)
  }
}

function turnLocation(
  turn: number,
  deliverables?: DeliverablesTurnData,
  status: TurnLocation['status'] = 'open',
): TurnLocation & { data: TestTurnDataStore } {
  const data = new TestTurnDataStore()
  if (deliverables !== undefined) data.set('diff-review-likecodex.deliverables', deliverables)
  return { turn, start: undefined, end: undefined, status, steps: [], data }
}

const produced = (
  ...values: ReadonlyArray<
    readonly [seq: number, path: string, diffs?: readonly ProducedFileDiff[]]
  >
): DeliverablesTurnData => ({
  produced: values.map(([seq, path, diffs = []]) => ({ seq, path, diffs })),
})

const firstDiff: ProducedFileDiff = {
  path: 'src/a.ts',
  oldText: 'before\nkeep',
  newText: 'after\nkeep',
  oldStart: 1,
  newStart: 1,
}
const secondDiff: ProducedFileDiff = {
  path: 'src/b.ts',
  oldText: null,
  newText: 'one\ntwo',
  oldStart: 1,
  newStart: 1,
}
const firstFiles = () => produced([3, firstDiff.path, [firstDiff]])
const moreFiles = () =>
  produced([3, firstDiff.path, [firstDiff]], [8, secondDiff.path, [secondDiff]])

/** Only timeline is consumed here, matching the native review tab fixture in produced-files. */
function chatSnapshot(
  turns: readonly TurnLocation[] = [],
  turnOrder = turns.map((turn) => turn.turn),
): ChatSnapshot {
  return {
    timeline: { turnOrder, turns: new Map(turns.map((turn) => [turn.turn, turn])) },
  } as ChatSnapshot
}

function makeTranslate(dict: Record<string, string>): LiveReviewDockProps['t'] {
  return (key, params) => {
    const template = dict[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    )
  }
}

function dockFixture(turns: readonly TurnLocation[] = [], running = true, sessionId = 'session-1') {
  const chat = externalStore(chatSnapshot(turns))
  const session = externalStore({ running } as SessionSnapshot)
  const openReview = vi.fn<(target: ReviewTarget) => void>()
  const props: LiveReviewDockProps = {
    sessionId: sessionId as SessionId,
    useChat: chat.useSelector,
    useSession: session.useSelector,
    openReview,
    t: makeTranslate(en),
  }
  return { chat, session, props, openReview }
}

function expectStats(container: HTMLElement, added: number, removed: number) {
  const stats = within(container).getByLabelText(`${added} lines added, ${removed} lines removed`)
  expect(within(stats).getByText(`+${added}`).classList.contains(css.added)).toBe(true)
  expect(within(stats).getByText(`-${removed}`).classList.contains(css.removed)).toBe(true)
}

describe('LiveReviewDock', () => {
  // 无轮次、无数据或空产出时均不生成运行中审查入口。
  it.each([
    ['no turns', []],
    ['no deliverables', [turnLocation(1)]],
    ['empty deliverables', [turnLocation(1, produced())]],
  ] as const)('hides with %s', (_name, turns) => {
    const f = dockFixture(turns)
    const view = render(<LiveReviewDock {...f.props} />)
    expect(view.container.childElementCount).toBe(0)
    expect(f.openReview).not.toHaveBeenCalled()
  })

  // 运行状态来自真实订阅；停止后即使轮次仍 open，也不能保留入口。
  it('hides an open turn while not running and reacts to session lifecycle updates', () => {
    const turn = turnLocation(1, firstFiles())
    const f = dockFixture([turn], false)
    const view = render(<LiveReviewDock {...f.props} />)
    expect(view.container.childElementCount).toBe(0)

    act(() => f.session.publish({ ...f.session.getSnapshot(), running: true }))
    expect(view.getByText('Edited 1 file')).toBeTruthy()
    act(() => f.session.publish({ ...f.session.getSnapshot(), running: false }))
    expect(view.container.childElementCount).toBe(0)
    expect(f.chat.getSnapshot().timeline.turns.get(1)).toBe(turn)
    expect(turn.status).toBe('open')
  })

  // 即使旧轮仍 open、有产出且会话 running，最新轮关闭或未知也必须隐藏。
  it.each(['closed', 'unknown'] as const)(
    'hides when the latest turn is %s rather than falling back to an older open turn',
    (status) => {
      const f = dockFixture([turnLocation(1, firstFiles())])
      const view = render(<LiveReviewDock {...f.props} />)
      expect(view.getByText('Edited 1 file')).toBeTruthy()
      act(() => {
        f.chat.publish(
          chatSnapshot([turnLocation(1, firstFiles()), turnLocation(2, moreFiles(), status)]),
        )
      })
      expect(view.container.childElementCount).toBe(0)
    },
  )

  // 最新轮尚未解析或新 open 轮尚无产出时，不能回退查找旧轮的文件。
  it('does not reuse the older open turn when a new turn is missing or has no files', () => {
    const older = turnLocation(1, firstFiles())
    const f = dockFixture([older])
    const view = render(<LiveReviewDock {...f.props} />)
    expect(view.getByText('Edited 1 file')).toBeTruthy()
    act(() => f.chat.publish(chatSnapshot([older], [1, 2])))
    expect(view.container.childElementCount).toBe(0)

    const latest = turnLocation(2)
    act(() => f.chat.publish(chatSnapshot([older, latest])))
    expect(view.container.childElementCount).toBe(0)
    act(() => {
      latest.data.set(
        'diff-review-likecodex.deliverables',
        produced([12, secondDiff.path, [secondDiff]]),
      )
      f.chat.publish(chatSnapshot([older, latest]))
    })
    const button = view.getByRole('button', { name: 'Review changes in this turn' })
    expect(within(button).getByText('Edited 1 file')).toBeTruthy()
    expectStats(button, 2, 0)
    fireEvent.click(button)
    expect(f.openReview).toHaveBeenCalledExactlyOnceWith({
      turn: 2,
      closingSeq: Number.MAX_SAFE_INTEGER,
      focusPaths: [],
    })
  })

  // 成功产出按文件去重，红绿统计保留真实差异，点击不冻结文件范围。
  it('shows current-session successful file totals and opens a finite all-files live target', () => {
    const files = produced(
      [3, firstDiff.path, [firstDiff]],
      [8, secondDiff.path, [secondDiff]],
      [9, firstDiff.path],
    )
    const f = dockFixture([turnLocation(7, files)])
    const view = render(<LiveReviewDock {...f.props} />)
    const dock = view.container.querySelector('[data-file-review-live]')!
    expect(dock.getAttribute('data-session-id')).toBe('session-1')
    const button = view.getByRole('button', { name: 'Review changes in this turn' })
    expect(within(button).getByText('Edited 2 files')).toBeTruthy()
    expect(within(button).getByText('Review')).toBeTruthy()
    expectStats(button, 3, 1)
    fireEvent.click(button)
    expect(f.openReview).toHaveBeenCalledExactlyOnceWith({
      turn: 7,
      closingSeq: Number.MAX_SAFE_INTEGER,
      focusPaths: [],
    })
    expect(Number.isFinite(f.openReview.mock.calls[0]![0].closingSeq)).toBe(true)
  })

  // 不 rerender、不替换 Turn/data reader，仅通过 store 通知验证叶值订阅。
  it('updates files and stats when the same stable TurnLocation data reader publishes new values', () => {
    const turn = turnLocation(1)
    const reader = turn.data
    const source = reader.source('diff-review-likecodex.deliverables')
    const f = dockFixture([turn])
    const view = render(<LiveReviewDock {...f.props} />)
    expect(view.container.childElementCount).toBe(0)

    const publish = (data: DeliverablesTurnData) =>
      act(() => {
        reader.set('diff-review-likecodex.deliverables', data)
        f.chat.publish({ ...f.chat.getSnapshot() })
      })
    publish(firstFiles())
    expect(view.getByText('Edited 1 file')).toBeTruthy()
    expectStats(view.container, 1, 1)
    publish(moreFiles())
    expect(view.queryByText('Edited 1 file')).toBeNull()
    expect(view.getByText('Edited 2 files')).toBeTruthy()
    expectStats(view.container, 3, 1)

    // 同一个文件追加差异时文件数不变，但统计仍需刷新。
    publish(
      produced(...moreFiles().produced.map(({ seq, path, diffs }) => [seq, path, diffs] as const), [
        10,
        firstDiff.path,
        [{ ...firstDiff, oldText: 'old', newText: 'new' }],
      ]),
    )
    expect(view.getByText('Edited 2 files')).toBeTruthy()
    expectStats(view.container, 4, 2)
    expect(f.chat.getSnapshot().timeline.turns.get(1)).toBe(turn)
    expect(turn.data).toBe(reader)
    expect(reader.source('diff-review-likecodex.deliverables')).toBe(source)
  })

  // 切换会话解绑旧 store；旧会话继续更新不能污染新会话，卸载全部退订。
  it('switches session subscriptions without showing stale totals and unsubscribes on unmount', () => {
    const first = dockFixture([turnLocation(1, moreFiles())], true, 'session-a')
    const secondTurn = turnLocation(9)
    const second = dockFixture([secondTurn], true, 'session-b')
    const view = render(<LiveReviewDock {...first.props} />)
    expect(view.getByText('Edited 2 files')).toBeTruthy()
    expect(first.chat.listeners.size).toBeGreaterThan(0)
    expect(first.session.listeners.size).toBeGreaterThan(0)

    view.rerender(<LiveReviewDock {...second.props} />)
    expect(view.container.childElementCount).toBe(0)
    expect(first.chat.listeners.size).toBe(0)
    expect(first.session.listeners.size).toBe(0)
    expect(first.chat.unsubscribe).toHaveBeenCalledTimes(first.chat.subscribe.mock.calls.length)
    expect(first.session.unsubscribe).toHaveBeenCalledTimes(
      first.session.subscribe.mock.calls.length,
    )
    act(() => {
      first.chat.publish(chatSnapshot([turnLocation(2, moreFiles())]))
      first.session.publish({ ...first.session.getSnapshot(), running: false })
    })
    expect(view.container.childElementCount).toBe(0)

    act(() => {
      secondTurn.data.set('diff-review-likecodex.deliverables', firstFiles())
      second.chat.publish({ ...second.chat.getSnapshot() })
    })
    expect(view.getByText('Edited 1 file')).toBeTruthy()
    expect(
      view.container.querySelector('[data-file-review-live]')?.getAttribute('data-session-id'),
    ).toBe('session-b')
    expectStats(view.container, 1, 1)
    fireEvent.click(view.getByRole('button', { name: 'Review changes in this turn' }))
    expect(second.openReview).toHaveBeenCalledExactlyOnceWith({
      turn: 9,
      closingSeq: Number.MAX_SAFE_INTEGER,
      focusPaths: [],
    })
    expect(first.openReview).not.toHaveBeenCalled()

    view.unmount()
    expect(second.chat.listeners.size).toBe(0)
    expect(second.session.listeners.size).toBe(0)
    expect(second.chat.unsubscribe).toHaveBeenCalledTimes(second.chat.subscribe.mock.calls.length)
    expect(second.session.unsubscribe).toHaveBeenCalledTimes(
      second.session.subscribe.mock.calls.length,
    )
  })

  // 在相同翻译函数身份下切换界面语言，按钮、文件数与无障碍统计同步更新。
  it('renders the active Web language after a locale change', () => {
    let active = en
    const t: LiveReviewDockProps['t'] = (key, params) => makeTranslate(active)(key, params)
    const f = dockFixture([turnLocation(1, moreFiles())])
    const view = render(<LiveReviewDock {...f.props} t={t} />)
    expect(view.getByRole('button', { name: 'Review changes in this turn' })).toBeTruthy()
    expect(view.getByText('Edited 2 files')).toBeTruthy()
    expectStats(view.container, 3, 1)

    active = zh
    view.rerender(<LiveReviewDock {...f.props} t={t} />)
    const button = view.getByRole('button', { name: '审查本轮改动' })
    expect(within(button).getByText('已编辑 2 个文件')).toBeTruthy()
    expect(within(button).getByText('审查')).toBeTruthy()
    expect(within(button).getByLabelText('新增 3 行，删除 1 行')).toBeTruthy()
    expect(view.queryByRole('button', { name: 'Review changes in this turn' })).toBeNull()

    act(() => f.chat.publish(chatSnapshot([turnLocation(2, firstFiles())])))
    expect(view.getByText('已编辑 1 个文件')).toBeTruthy()
  })
})

describe('native review tab live target', () => {
  // 复用 produced-files 的 sessions.binding → conversation.target('chat') 原生 fixture。
  it('keeps an already-open live target current without including a later turn', () => {
    const turn = turnLocation(4, firstFiles())
    const f = dockFixture([turn])
    const dock = render(<LiveReviewDock {...f.props} />)
    fireEvent.click(dock.getByRole('button', { name: 'Review changes in this turn' }))
    const params = f.openReview.mock.calls[0]![0]
    const sessionBinding = {}
    const target = vi.fn(() => f.chat)
    const bindConversation = vi.fn(() => ({ target }))
    const sessionsSnapshot = { byId: { 'session-1': { cwd: '/workspace' } } }
    const sessionList = externalStore(sessionsSnapshot)
    const props = {
      sessions: { binding: vi.fn(() => sessionBinding), list: sessionList },
      uiConversation: { binding: bindConversation },
      sessionId: 'session-1',
      projectRoot: '/workspace',
      params,
      visible: true,
      wordWrap: { getSnapshot: () => false, subscribe: () => () => {} },
      openFile: vi.fn(),
      t: makeTranslate(en),
    } as unknown as Parameters<typeof FileReviewTab>[0]
    const view = render(<FileReviewTab {...props} />)
    const tab = within(view.container)
    expect(tab.getByText('src/a.ts')).toBeTruthy()
    expect(tab.queryByText('src/b.ts')).toBeNull()
    expect(tab.getByText('1 file')).toBeTruthy()
    expect(bindConversation).toHaveBeenCalledWith(sessionBinding)
    expect(target).toHaveBeenCalledWith('chat')

    // 同一个 params 对象、同一个已挂载 Tab：点击之后捕获的新文件必须自动出现。
    act(() => {
      turn.data.set('diff-review-likecodex.deliverables', moreFiles())
      f.chat.publish({ ...f.chat.getSnapshot() })
    })
    expect(tab.getByText('src/a.ts')).toBeTruthy()
    expect(tab.getByText('src/b.ts')).toBeTruthy()
    expect(tab.getByText('2 files')).toBeTruthy()
    expectStats(view.container.querySelector('[data-review-content] > header') as HTMLElement, 3, 1)
    expect(props.params).toBe(params)
    expect(f.openReview).toHaveBeenCalledOnce()

    act(() => {
      const next = turnLocation(
        5,
        produced([
          20,
          'next-turn-only.ts',
          [{ path: 'next-turn-only.ts', oldText: null, newText: 'must stay out' }],
        ]),
      )
      f.chat.publish(chatSnapshot([{ ...turn, status: 'closed' }, next]))
    })
    expect(tab.getByText('src/a.ts')).toBeTruthy()
    expect(tab.getByText('src/b.ts')).toBeTruthy()
    expect(tab.getByText('2 files')).toBeTruthy()
    expect(tab.queryByText('next-turn-only.ts')).toBeNull()
    expect(tab.queryByText('must stay out')).toBeNull()
    expectStats(view.container.querySelector('[data-review-content] > header') as HTMLElement, 3, 1)
    expect(props.params).toBe(params)
    expect(params).toEqual({ turn: 4, closingSeq: Number.MAX_SAFE_INTEGER, focusPaths: [] })

    dock.unmount()
    expect(f.chat.listeners.size).toBe(1)
    view.rerender(<FileReviewTab {...props} visible={false} />)
    expect(f.chat.listeners.size).toBe(0)
    view.unmount()
    expect(sessionList.listeners.size).toBe(0)
    expect(f.chat.unsubscribe).toHaveBeenCalledTimes(f.chat.subscribe.mock.calls.length)
  })
})
