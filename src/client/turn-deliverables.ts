/** Turn-scoped review facts. New records are isolated; upstream history is read-only. */
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  ConversationMatch,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type {} from '@deepseek-ai/dsh-tools/types'
import type { ProducedFileDiff, ProducedFileReview } from '../change-types.ts'
import {
  markerFromContent,
  markerOriginFromContent,
  type PtcFileReviewMarker,
} from '../ptc-marker.ts'
import { canonicalReviewPath, reviewPathKey } from '../review-path.ts'

export type { ProducedFileDiff, ProducedFileReview } from '../change-types.ts'
export const REVIEW_TURN_DATA = 'diff-review-likecodex.deliverables'

interface ProducedPath {
  readonly seq: number
  readonly path: string
  readonly diffs: readonly ProducedFileDiff[]
  readonly complete?: false | undefined
  readonly readOnly?: true | undefined
}
export interface DeliverablesTurnData {
  readonly produced: readonly ProducedPath[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    'diff-review-likecodex.deliverables': DeliverablesTurnData
  }
}
interface DeliverablesState extends DeliverablesTurnData {
  readonly turn: number
  readonly calls: ReadonlyMap<string, { readonly step: number }>
  readonly subCalls: ReadonlySet<string>
}
type ConversationEvent = ConversationMatch['event']
type CapturedMarker = PtcFileReviewMarker & { readonly readOnly?: true }

function readMarker(
  content: readonly unknown[],
  expected: { rootCallId: string; subCallId: string },
): CapturedMarker | null {
  const marker = markerFromContent(content, expected)
  if (marker === null) return null
  return markerOriginFromContent(content, expected) === 'legacy'
    ? { ...marker, readOnly: true }
    : marker
}
function dispatchMarker(event: ConversationEvent): CapturedMarker | null {
  if (event.type !== 'tool/ptc-dispatch') return null
  const data = event.data as unknown as Record<string, unknown>
  if (
    data.isError !== false ||
    typeof data.rootCallId !== 'string' ||
    data.rootCallId === '' ||
    typeof data.subCallId !== 'string' ||
    data.subCallId === '' ||
    !Array.isArray(data.content)
  )
    return null
  return readMarker(data.content, { rootCallId: data.rootCallId, subCallId: data.subCallId })
}
function nativeResultMarker(event: ConversationEvent): CapturedMarker | null {
  if (event.type !== 'tool/result') return null
  const callId = event.data.message.source.callId
  const result = event.data.message.content[0]
  if (typeof callId !== 'string' || callId === '' || !Array.isArray(result?.content)) return null
  return readMarker(result.content, { rootCallId: callId, subCallId: callId })
}

/** Resolve aliases within ONE settlement. Pick its most informative representation,
 * rather than counting tool presentation and captured snapshot as separate changes.
 * Different settlements always remain in order, even when the same edit repeats. */
export function reviewsForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
  projectRoot?: string,
): readonly ProducedFileReview[] {
  if (data === undefined) return []
  const settlements = new Map<number, Map<string, ProducedPath>>()
  for (const produced of data.produced) {
    if (produced.seq > seq) continue
    let files = settlements.get(produced.seq)
    if (files === undefined) {
      files = new Map()
      settlements.set(produced.seq, files)
    }
    const key = reviewPathKey(produced.path, projectRoot)
    const previous = files.get(key)
    if (previous === undefined || representationScore(produced) > representationScore(previous))
      files.set(key, produced)
  }
  const byPath = new Map<
    string,
    { path: string; diffs: ProducedFileDiff[]; complete?: false; readOnly?: true }
  >()
  for (const [, files] of [...settlements].sort(([left], [right]) => left - right)) {
    for (const [key, produced] of files) {
      let review = byPath.get(key)
      if (review === undefined) {
        review = { path: canonicalReviewPath(produced.path, projectRoot), diffs: [] }
        byPath.set(key, review)
      }
      review.diffs.push(...produced.diffs.map((diff) => ({ ...diff, path: review.path })))
      if (produced.complete === false || produced.readOnly) review.complete = false
      if (produced.readOnly) review.readOnly = true
    }
  }
  return [...byPath.values()]
}
function representationScore(produced: ProducedPath): number {
  // Prefer lifecycle/complete snapshots, then a wider contextual representation.
  return (
    (produced.diffs.some((diff) => diff.lifecycle !== undefined) ? 1e12 : 0) +
    (produced.complete === false ? 0 : 1e9) +
    produced.diffs.reduce(
      (total, diff) => total + (diff.oldText?.length ?? 0) + diff.newText.length,
      0,
    )
  )
}
export function producedForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
  projectRoot?: string,
): readonly string[] {
  return reviewsForClosing(data, seq, projectRoot).map((review) => review.path)
}
export function selectProducedFiles(
  owner: TurnTailOwnerProps,
): readonly ProducedFileReview[] | null {
  const reviews = reviewsForClosing(owner.turn.data.get(REVIEW_TURN_DATA), owner.seq)
  return reviews.length === 0 ? null : reviews
}
function additions(marker: CapturedMarker, seq: number): ProducedPath[] {
  return marker.files.map((file) => ({
    seq,
    path: file.path,
    diffs: file.diffs,
    ...(file.diffs.length === 0 || marker.readOnly ? { complete: false as const } : {}),
    ...(marker.readOnly ? { readOnly: true as const } : {}),
  }))
}
export const deliverablesDefinition: ConversationNodeDefinition<DeliverablesState> = {
  kind: REVIEW_TURN_DATA,
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event))
      return { id: String(event.data.turn), role: 'update' }
    const marker = dispatchMarker(event)
    return marker === null ? null : { id: String(marker.turn), role: 'update' }
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('deliverables start requires turn/start')
    return { turn: match.event.data.turn, calls: new Map(), subCalls: new Set(), produced: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      if (typeof match.event.data.callId !== 'string' || match.event.data.callId === '')
        return context.state
      const calls = new Map(context.state.calls)
      calls.set(match.event.data.callId, { step: match.event.data.step })
      return { ...context.state, calls }
    }
    if (match.event.type === 'tool/result') {
      const result = match.event.data.message.content[0]
      if (result.isError === true) return context.state
      const callId = match.event.data.message.source.callId
      if (typeof callId !== 'string' || callId === '') return context.state
      const call = context.state.calls.get(callId)
      if (call === undefined) return context.state
      const captured = nativeResultMarker(match.event)
      const key = `native:${callId}`
      if (
        captured === null ||
        captured.turn !== context.state.turn ||
        captured.step !== call.step ||
        context.state.subCalls.has(key)
      )
        return context.state
      const subCalls = new Set(context.state.subCalls)
      subCalls.add(key)
      return {
        ...context.state,
        subCalls,
        produced: [...context.state.produced, ...additions(captured, match.event.seq)],
      }
    }
    const marker = dispatchMarker(match.event)
    const root = marker === null ? undefined : context.state.calls.get(marker.rootCallId)
    const key = marker === null ? '' : `ptc:${marker.rootCallId}:${marker.subCallId}`
    if (
      marker === null ||
      marker.turn !== context.state.turn ||
      root === undefined ||
      root.step !== marker.step ||
      context.state.subCalls.has(key)
    )
      return context.state
    const subCalls = new Set(context.state.subCalls)
    subCalls.add(key)
    return {
      ...context.state,
      subCalls,
      produced: [...context.state.produced, ...additions(marker, match.event.seq)],
    }
  },
  buildLocationData: (context, scope) =>
    scope !== 'turn' || context.state === undefined
      ? null
      : {
          kind: 'turn',
          turn: context.state.turn,
          key: REVIEW_TURN_DATA,
          value: { produced: context.state.produced },
        },
}

export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}
/** Inline mentions use exact paths or an unambiguous basename, never a guess. */
export function producedFileMentions(
  paths: readonly string[],
  openFile: (path: string) => void,
  label: (path: string) => string,
): MarkdownFileMentions {
  return {
    resolve(value) {
      const matches = paths.filter((path) => basename(path) === value)
      const path = paths.includes(value) ? value : matches.length === 1 ? matches[0] : undefined
      return path === undefined
        ? undefined
        : { open: () => openFile(path), label: label(path), title: path }
    },
  }
}
