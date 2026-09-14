// @vitest-environment jsdom
/** Optional service injection is a disposable child scope, not a one-time lookup. */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BETTER_REVIEW_TAB_ID, installReviewNavigation } from '../src/client/review-navigation.tsx'
import type { FileReviewTabProps } from '../src/client/FileReviewTab.tsx'
import { DEFAULT_WORD_WRAP_SOURCE } from '../src/client/ReviewContent.tsx'
import { en } from '../src/client/locales.ts'

vi.mock('../src/client/FileReviewTab.tsx', () => ({
  FileReviewTab: ({ sessionId, projectRoot, params, visible, openFile }: FileReviewTabProps) => (
    <div data-session={sessionId} data-root={projectRoot} data-visible={String(visible)}>
      <output>{JSON.stringify(params ?? null)}</output>
      <button onClick={() => openFile('/workspace/中文 #.md')}>Open recorded file</button>
    </div>
  ),
}))

const NATIVE_ID = 'dsh-diff-review-likecodex:review'
const HEADER = 'conversation.session.header.utilities'
const t = ((key: keyof typeof en) => en[key]) as FileReviewTabProps['t']
type Dispose = () => void
type TabDefinition = {
  id: string
  single: boolean
  component: ComponentType<any>
  title: () => string
  description: () => string
}

/** Idempotent disposers match Cordis effects, including a disposer owned by two scopes. */
function lifetime() {
  const effects: Dispose[] = []
  return {
    effect(setup: () => Dispose) {
      const cleanupEffect = setup()
      let active = true
      const dispose = () => {
        if (active) {
          active = false
          cleanupEffect()
        }
      }
      effects.push(dispose)
      return dispose
    },
    dispose() {
      for (const off of effects.splice(0).reverse()) off()
    },
  }
}

function betterService() {
  const definitions = new Map<string, TabDefinition>()
  const unregister = vi.fn()
  return {
    definitions,
    unregister,
    registerTab: vi.fn((definition: TabDefinition) => {
      if (definitions.has(definition.id)) throw new Error(`Duplicate tab: ${definition.id}`)
      definitions.set(definition.id, definition)
      return () => {
        definitions.delete(definition.id)
        unregister(definition.id)
      }
    }),
    openTab: vi.fn(),
    openFile: vi.fn(),
  }
}

/** Execute inject callbacks only when available; dispose their own effects on withdrawal. */
function fixture(initial?: ReturnType<typeof betterService>) {
  const root = lifetime()
  let child: ReturnType<typeof lifetime> | undefined
  let service: ReturnType<typeof betterService> | undefined
  let activate: ((scoped: unknown) => void) | undefined
  const slots = new Map<
    string,
    { definition: Record<string, unknown>; component: ComponentType<any> }
  >()
  const nativeDefinitions = new Map<string, { id: string }>()
  const nativeUnregister = vi.fn()
  const openTabIn = vi.fn()
  const ctx = {
    effect: root.effect,
    sidebarRight: { openTabIn },
    sidebarRightTabs: {
      register: vi.fn((definition: { id: string }) => {
        if (nativeDefinitions.has(definition.id)) throw new Error('Duplicate native registration')
        nativeDefinitions.set(definition.id, definition)
        return () => {
          nativeDefinitions.delete(definition.id)
          nativeUnregister(definition.id)
        }
      }),
    },
    slots: {
      inject: vi.fn((_name: string, setup: () => Dispose) => root.effect(setup)),
      register: vi.fn(
        (definition: { name: string; [key: string]: unknown }, component: ComponentType<any>) => {
          if (slots.has(definition.name)) throw new Error(`Duplicate slot: ${definition.name}`)
          slots.set(definition.name, { definition, component })
          return () => {
            slots.delete(definition.name)
          }
        },
      ),
    },
    inject: vi.fn((dependencies: string[], callback: (scoped: unknown) => void) => {
      expect(dependencies).toEqual(['betterSidebar'])
      activate = callback
      return root.effect(() => () => {
        child?.dispose()
        activate = undefined
      })
    }),
  }
  const sessionsSnapshot = {
    byId: {
      'session-a': { cwd: '/workspace' },
      'session-b': { cwd: 'D:/other' },
      'session-no-root': {},
    },
  }
  const runtimeFor = vi.fn(() => ({
    inspectChanges: vi.fn(),
    applyChanges: vi.fn(),
    syncComments: vi.fn(),
  }))
  const options = {
    sessions: { list: { getSnapshot: () => sessionsSnapshot } },
    uiConversation: {},
    wordWrap: DEFAULT_WORD_WRAP_SOURCE,
    t,
    runtimeFor,
  } as unknown as Parameters<typeof installReviewNavigation>[1]
  const open = installReviewNavigation(ctx as never, options)
  const provide = (next?: ReturnType<typeof betterService>) => {
    if (service === next) return
    child?.dispose()
    child = undefined
    service = next
    if (next !== undefined && activate !== undefined) {
      child = lifetime()
      activate({ betterSidebar: next, effect: child.effect })
    }
  }
  if (initial !== undefined) provide(initial)
  return {
    ctx,
    slots,
    nativeDefinitions,
    nativeUnregister,
    openTabIn,
    open,
    provide,
    runtimeFor,
    dispose: root.dispose,
  }
}

const fixtures: ReturnType<typeof fixture>[] = []
function setup(service?: ReturnType<typeof betterService>) {
  const result = fixture(service)
  fixtures.push(result)
  return result
}

afterEach(() => {
  cleanup()
  for (const f of fixtures.splice(0)) f.dispose()
  vi.restoreAllMocks()
})

describe('review navigation optional Better Sidebar service', () => {
  it('updates a reused tab even when Better Sidebar 0.19.1 retains stale meta', () => {
    const service = betterService()
    const f = setup(service)
    const Body = service.definitions.get(BETTER_REVIEW_TAB_ID)!.component
    const first = { turn: 1, closingSeq: 10, focusPaths: ['a.md'] }
    const second = { turn: 2, closingSeq: 20, focusPaths: ['b.md'] }
    const tab = { meta: first } // Deliberately never updated by openTab.
    const view = render(
      <Body scope={{ sessionId: 'session-a', cwd: '/workspace' }} tab={tab} visible />,
    )
    expect(JSON.parse(view.getByRole('status').textContent!)).toEqual(first)
    act(() => f.open('session-a' as never, second))
    expect(JSON.parse(view.getByRole('status').textContent!)).toEqual(second)
    expect(tab.meta).toBe(first)
    act(() => f.open('session-b' as never, first))
    expect(JSON.parse(view.getByRole('status').textContent!)).toEqual(second)
    act(() => f.open('session-a' as never))
    expect(view.getByRole('status').textContent).toBe('null')
  })
  it('keeps native sidebar navigation without registering a session-header action', () => {
    const f = setup()
    expect(f.ctx.inject).toHaveBeenCalledOnce()
    expect(f.nativeDefinitions.size).toBe(1)
    expect(f.slots.has(HEADER)).toBe(false)
    f.open('session-a' as never)
    f.open('session-b' as never)
    expect(f.openTabIn.mock.calls).toEqual([
      ['session-a', NATIVE_ID, { params: null }],
      ['session-b', NATIVE_ID, { params: null }],
    ])
    const Body = f.slots.get('sidebar.right.pane.tab')!.component
    const view = render(
      <Body
        sessionId="session-b"
        t={t}
        useSessions={(select: (snapshot: unknown) => unknown) =>
          select({ byId: { 'session-b': { cwd: 'D:/other' } } })
        }
        useTabInfo={() => ({
          tab: { visible: true, navigation: { params: null }, actions: { openResource: vi.fn() } },
        })}
      />,
    )
    expect(view.getByRole('status').textContent).toBe('null')
    expect(view.container.firstElementChild?.getAttribute('data-session')).toBe('session-b')
    f.dispose()
    expect(f.slots.size).toBe(0)
    expect(f.nativeDefinitions.size).toBe(0)
    expect(f.nativeUnregister).toHaveBeenCalledExactlyOnceWith(NATIVE_ID)
  })

  it('registers Better Sidebar once and routes targets through meta and explicit scope, never seed.path', () => {
    const service = betterService()
    const f = setup(service)
    const first = { turn: 1, closingSeq: 10, focusPaths: ['a.md'] }
    const second = { turn: 2, closingSeq: 20, focusPaths: ['b.md'] }
    f.open('session-a' as never, first)
    f.open('session-a' as never, second)
    f.open('session-b' as never)
    f.open('session-no-root' as never)
    expect(service.registerTab).toHaveBeenCalledOnce()
    expect(service.openTab.mock.calls).toEqual([
      [
        { type: BETTER_REVIEW_TAB_ID, meta: first },
        { sessionId: 'session-a', cwd: '/workspace' },
      ],
      [
        { type: BETTER_REVIEW_TAB_ID, meta: second },
        { sessionId: 'session-a', cwd: '/workspace' },
      ],
      [
        { type: BETTER_REVIEW_TAB_ID, meta: null },
        { sessionId: 'session-b', cwd: 'D:/other' },
      ],
      [{ type: BETTER_REVIEW_TAB_ID, meta: null }, { sessionId: 'session-no-root' }],
    ])
    expect(f.openTabIn).not.toHaveBeenCalled()
    expect(BETTER_REVIEW_TAB_ID).not.toBe(NATIVE_ID)
    expect(f.nativeDefinitions.has(NATIVE_ID)).toBe(true)
    const definition = service.definitions.get(BETTER_REVIEW_TAB_ID)!
    expect(definition.single).toBe(true)
    expect(definition.title()).toBe(en['review.title'])
    expect(definition.description()).toBe(en['review.openSession'])
    expect(service.definitions.has(NATIVE_ID)).toBe(false)
  })

  it('uses tab.meta and the tab session scope in the Better Sidebar body, not a seed path or active session', () => {
    const service = betterService()
    const f = setup(service)
    const Body = service.definitions.get(BETTER_REVIEW_TAB_ID)!.component
    const scope = { sessionId: 'session-a', cwd: '/workspace' }
    const meta = { turn: 2, closingSeq: 20, focusPaths: ['a.md'] }
    const view = render(<Body scope={scope} tab={{ meta, path: 'not-a-review-target' }} visible />)
    expect(JSON.parse(view.getByRole('status').textContent!)).toEqual(meta)
    expect(view.container.firstElementChild?.getAttribute('data-root')).toBe('/workspace')
    fireEvent.click(view.getByRole('button', { name: 'Open recorded file' }))
    expect(service.openFile).toHaveBeenCalledExactlyOnceWith(scope, '/workspace/中文 #.md')
    view.rerender(
      <Body
        scope={{ sessionId: 'session-b', cwd: 'D:/other' }}
        tab={{ meta: null, path: 'still-not-params' }}
        visible={false}
      />,
    )
    expect(view.getByRole('status').textContent).toBe('null')
    expect(view.container.firstElementChild?.getAttribute('data-session')).toBe('session-b')
    expect(view.container.firstElementChild?.getAttribute('data-visible')).toBe('false')
    expect(f.runtimeFor).toHaveBeenLastCalledWith('session-b')
  })

  it('routes the service-backed sidebar opener to the requested session', () => {
    const service = betterService()
    const f = setup(service)
    expect(f.slots.has(HEADER)).toBe(false)
    f.open('session-a' as never)
    f.open('session-b' as never)
    expect(service.openTab.mock.calls).toEqual([
      [
        { type: BETTER_REVIEW_TAB_ID, meta: null },
        { sessionId: 'session-a', cwd: '/workspace' },
      ],
      [
        { type: BETTER_REVIEW_TAB_ID, meta: null },
        { sessionId: 'session-b', cwd: 'D:/other' },
      ],
    ])
    expect(service.registerTab).toHaveBeenCalledOnce()
  })

  it('activates on late service mount, restores native routing on withdrawal, and cleans each child effect', () => {
    const f = setup()
    const open = () => f.open('session-a' as never)
    expect(f.slots.has(HEADER)).toBe(false)
    open()
    expect(f.openTabIn).toHaveBeenCalledTimes(1)
    const first = betterService()
    f.provide(first)
    open()
    expect(first.registerTab).toHaveBeenCalledOnce()
    expect(first.openTab).toHaveBeenCalledOnce()
    expect(f.openTabIn).toHaveBeenCalledTimes(1)
    f.provide(undefined)
    expect(first.unregister).toHaveBeenCalledExactlyOnceWith(BETTER_REVIEW_TAB_ID)
    expect(first.definitions.size).toBe(0)
    open()
    expect(f.openTabIn).toHaveBeenCalledTimes(2)
    expect(first.openTab).toHaveBeenCalledOnce()
    expect(f.slots.has(HEADER)).toBe(false)
    const second = betterService()
    f.provide(second)
    open()
    expect(second.registerTab).toHaveBeenCalledOnce()
    expect(second.openTab).toHaveBeenCalledOnce()
    expect(f.nativeDefinitions.size).toBe(1)
    f.dispose()
    expect(second.unregister).toHaveBeenCalledExactlyOnceWith(BETTER_REVIEW_TAB_ID)
    expect(first.unregister).toHaveBeenCalledOnce()
    expect(second.definitions.size).toBe(0)
    expect(f.nativeDefinitions.size).toBe(0)
    expect(f.slots.size).toBe(0)
  })
})
