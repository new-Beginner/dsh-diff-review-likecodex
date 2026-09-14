// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  deliverablesDefinition,
  reviewsForClosing,
  REVIEW_TURN_DATA,
  type DeliverablesTurnData,
} from '../src/client/turn-deliverables.ts'
import { markerBlock, type PtcFileReviewMarker } from '../src/ptc-marker.ts'
import { ProducedFiles } from '../src/client/ProducedFiles.tsx'
import { summarizeDiffs } from '../src/client/UnifiedDiff.tsx'
import { isReversibleChange } from '../src/file-review-change.ts'
import { absoluteReviewPath } from '../src/review-path.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const path = 'src/app.ts'
const narrow = { path, oldText: 'old\n', newText: 'new\n', oldStart: 4, newStart: 4 }
const context = {
  path,
  oldText: 'a\nb\nc\nold\ne\nf\ng\n',
  newText: 'a\nb\nc\nnew\ne\nf\ng\n',
  oldStart: 1,
  newStart: 1,
}
const aliasData: DeliverablesTurnData = {
  produced: [
    {
      seq: 3,
      path: 'C:\\Work\\Project\\src\\app.ts',
      diffs: [{ ...narrow, path: 'C:\\Work\\Project\\src\\app.ts' }],
    },
    { seq: 3, path: './src/app.ts', diffs: [{ ...context, path: './src/app.ts' }] },
  ],
}
const t = (key: keyof typeof en, params?: Record<string, unknown>) =>
  en[key].replace(/\{(\w+)\}/g, (match, key: string) =>
    params && key in params ? String(params[key]) : match,
  )

function marker(): PtcFileReviewMarker {
  return {
    schema: 2,
    turn: 1,
    step: 1,
    rootCallId: 'edit-1',
    subCallId: 'edit-1',
    truncated: false,
    files: [{ path, diffs: [context], source: 'result' }],
  }
}
function fold(content: readonly unknown[], duplicate = false): DeliverablesTurnData {
  const start = { event: { seq: 1, type: 'turn/start', data: { turn: 1 } }, role: 'start' }
  const base = {
    key: 'review:1',
    kind: REVIEW_TURN_DATA,
    id: '1',
    matches: [start],
    start,
    current: new Map(),
    state: undefined,
  }
  let state = deliverablesDefinition.start(base as never, start as never, {
    previous: () => undefined,
  })
  const call = {
    event: { seq: 2, type: 'tool/call', data: { turn: 1, step: 1, callId: 'edit-1' } },
    role: 'update',
  }
  state = deliverablesDefinition.update({ ...base, state } as never, call as never)
  const result = {
    event: {
      seq: 3,
      type: 'tool/result',
      surfaceOp: 'append',
      data: {
        turn: 1,
        step: 1,
        message: { source: { callId: 'edit-1' }, content: [{ isError: false, content }] },
      },
    },
    role: 'update',
  }
  state = deliverablesDefinition.update({ ...base, state } as never, result as never)
  if (duplicate)
    state = deliverablesDefinition.update(
      { ...base, state } as never,
      { ...result, event: { ...result.event, seq: 4 } } as never,
    )
  return state
}

describe('canonical review aggregation and legacy isolation', () => {
  it('keeps POSIX literal backslash files distinct from nested paths', () => {
    const paths = [String.raw`src\name.txt`, 'src/name.txt']
    const data = { produced: paths.map((path) => ({ seq: 3, path, diffs: [{ ...narrow, path }] })) }
    const reviews = reviewsForClosing(data, 3, '/work')
    expect(reviews.map((review) => review.path)).toEqual(paths)
    expect(reviews).toHaveLength(2)
  })
  it('merges absolute/relative aliases within one settlement and prefers real contextual hunks', () => {
    const reviews = reviewsForClosing(aliasData, 10, 'c:/work/project')
    expect(reviews).toEqual([{ path, diffs: [context] }])
    expect(summarizeDiffs(reviews[0]!.diffs)).toEqual({ added: 1, removed: 1 })
    expect(aliasData.produced[0]?.path).toBe('C:\\Work\\Project\\src\\app.ts')
  })
  it('keeps repeated edits from distinct settlements and respects closing sequence', () => {
    const data = { produced: [...aliasData.produced, { seq: 5, path, diffs: [context] }] }
    expect(reviewsForClosing(data, 4, 'C:/Work/Project')[0]?.diffs).toHaveLength(1)
    expect(reviewsForClosing(data, 5, 'C:/Work/Project')[0]?.diffs).toHaveLength(2)
  })
  it('does not merge distinct same-name files or POSIX case-distinct paths', () => {
    const produced = ['a/app.ts', 'b/app.ts', 'A/app.ts'].map((path) => ({
      seq: 3,
      path,
      diffs: [{ ...narrow, path }],
    }))
    expect(reviewsForClosing({ produced }, 3, '/project')).toHaveLength(3)
    expect(reviewsForClosing(aliasData)).toHaveLength(2)
  })
  it('reads old markers as immutable, non-reversible records without fabricating context', () => {
    const old = { ...marker(), files: [{ path, diffs: [narrow], source: 'result' as const }] }
    const block = { type: 'text', text: '', dshFileReview: old }
    const before = JSON.stringify(block)
    const reviews = reviewsForClosing(fold([block]))
    expect(reviews).toEqual([{ path, diffs: [narrow], readOnly: true, complete: false }])
    expect(isReversibleChange(reviews[0]!)).toBe(false)
    expect(JSON.stringify(block)).toBe(before)
  })
  it('prefers this fork marker and deduplicates replayed native settlements', () => {
    const old = { type: 'text', text: '', dshFileReview: marker() }
    const reviews = reviewsForClosing(fold([markerBlock(marker()), old], true))
    expect(reviews).toEqual([{ path, diffs: [context] }])
    expect(isReversibleChange(reviews[0]!)).toBe(true)
    expect(deliverablesDefinition.kind).toBe('diff-review-likecodex.deliverables')
  })
  it('renders one row and one total for the reported Windows alias bug', () => {
    const openReview = vi.fn()
    const turn = {
      turn: 1,
      data: { get: (key: string) => (key === REVIEW_TURN_DATA ? aliasData : undefined) },
    } as unknown as TurnLocation
    const view = render(
      <ProducedFiles
        matched={reviewsForClosing(aliasData)}
        turn={turn}
        seq={10}
        projectRoot="C:/Work/Project"
        openFile={vi.fn()}
        openReview={openReview}
        t={t}
      />,
    )
    const region = view.getByRole('region', { name: 'Edited files' })
    expect(within(region).getByText('Edited 1 file')).toBeTruthy()
    expect(within(region).getAllByRole('button', { name: 'Review src/app.ts' })).toHaveLength(1)
    expect(within(region).getAllByLabelText('1 lines added, 1 lines removed')).toHaveLength(2)
    fireEvent.click(within(region).getByRole('button', { name: 'Review src/app.ts' }))
    expect(openReview).toHaveBeenCalledWith({ turn: 1, closingSeq: 10, focusPaths: [path] })
  })
  it('disambiguates same basenames and disables Undo for legacy-only cards', () => {
    const matched = ['a/index.ts', 'b/index.ts'].map((path) => ({
      path,
      diffs: [{ ...narrow, path }],
      readOnly: true as const,
      complete: false as const,
    }))
    const view = render(
      <ProducedFiles matched={matched} openFile={vi.fn()} openReview={vi.fn()} t={t} />,
    )
    expect(view.getByText('a/index.ts')).toBeTruthy()
    expect(view.getByText('b/index.ts')).toBeTruthy()
    expect(view.getByRole('note').textContent).toContain('read-only')
    expect((view.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('resolves editor actions to absolute paths without confusing roots', () => {
    expect(absoluteReviewPath('docs/guide.md', '/workspace')).toBe('/workspace/docs/guide.md')
    expect(absoluteReviewPath('src\\app.ts', 'C:\\Work')).toBe('C:/Work/src/app.ts')
    expect(absoluteReviewPath('file.txt', '/')).toBe('/file.txt')
    expect(absoluteReviewPath('/elsewhere/a.ts', '/work')).toBe('/elsewhere/a.ts')
    expect(absoluteReviewPath('relative.ts')).toBe('relative.ts')
  })
})
