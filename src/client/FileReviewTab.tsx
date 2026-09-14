/** Session-scoped review browser: direct targets and an always-available turn picker. */
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Config } from '../settings-contract.ts'
import type { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { FileReviewRequest, FileReviewResult } from '../change-types.ts'
import { absoluteReviewPath, reviewPathKey } from '../review-path.ts'
import { ReviewContent } from './ReviewContent.tsx'
import { reviewsForClosing, REVIEW_TURN_DATA } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import css from './ProducedFiles.module.css'

const EMPTY_SNAPSHOT = Symbol('empty diff-review-likecodex snapshot')
export interface ReviewTarget {
  readonly turn: number
  readonly closingSeq: number
  readonly focusPaths: readonly string[]
}
export interface FileReviewTabRuntime {
  readonly inspectChanges: (request: FileReviewRequest) => Promise<FileReviewResult>
  readonly applyChanges: (request: FileReviewRequest) => Promise<FileReviewResult>
  readonly syncComments?: (() => void) | undefined
}
export interface FileReviewTabProps extends PropsLocale<typeof NS> {
  readonly sessions: ISessions
  readonly uiConversation: UiConversation
  readonly sessionId: SessionId
  readonly projectRoot?: string | undefined
  readonly params: unknown
  readonly visible: boolean
  readonly syncComments?: (() => void) | undefined
  readonly wordWrap: ObservableSnapshot<boolean>
  readonly settings?: SettingsScope<Config> | undefined
  readonly openFile: (path: string) => void
}
export function reviewTargetFrom(value: unknown): ReviewTarget | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Partial<Record<keyof ReviewTarget, unknown>>
  if (
    !Number.isSafeInteger(candidate.turn) ||
    (candidate.turn as number) < 0 ||
    !Number.isSafeInteger(candidate.closingSeq) ||
    (candidate.closingSeq as number) < 0 ||
    !Array.isArray(candidate.focusPaths) ||
    !candidate.focusPaths.every((path): path is string => typeof path === 'string')
  )
    return undefined
  return {
    turn: candidate.turn as number,
    closingSeq: candidate.closingSeq as number,
    focusPaths: candidate.focusPaths,
  }
}
export function FileReviewTab({
  sessions,
  uiConversation,
  sessionId,
  projectRoot,
  params,
  visible,
  syncComments,
  wordWrap,
  settings,
  openFile,
  t,
}: FileReviewTabProps) {
  const getSessionsSnapshot = useCallback(() => sessions.list.getSnapshot(), [sessions])
  const subscribeSessions = useCallback(
    (listener: () => void) => sessions.list.subscribe(listener),
    [sessions],
  )
  const sessionList = useSyncExternalStore(
    subscribeSessions,
    getSessionsSnapshot,
    getSessionsSnapshot,
  )
  const root = projectRoot ?? sessionList.byId[sessionId]?.cwd
  const binding = sessions.binding(sessionId)
  const chat = binding === undefined ? undefined : uiConversation.binding(binding).target('chat')
  const getChatSnapshot = useCallback(() => chat?.getSnapshot() ?? EMPTY_SNAPSHOT, [chat])
  const subscribeChat = useCallback(
    (listener: () => void) => (visible ? (chat?.subscribe(listener) ?? (() => {})) : () => {}),
    [chat, visible],
  )
  const snapshot = useSyncExternalStore(subscribeChat, getChatSnapshot, getChatSnapshot)
  const requested = useMemo(() => reviewTargetFrom(params), [params])
  // Scope local selection to both session and navigation object. Switching either
  // must not briefly show the previous session's chosen turn/file.
  const [selection, setSelection] = useState<{
    sessionId: SessionId
    params: unknown
    turn: number | null
  } | null>(null)
  const local = selection?.sessionId === sessionId && selection.params === params ? selection : null
  const turns = useMemo(() => {
    if (snapshot === EMPTY_SNAPSHOT) return []
    const order = snapshot.timeline.turnOrder ?? [...snapshot.timeline.turns.keys()]
    return [...order].reverse().flatMap((number) => {
      const turn = snapshot.timeline.turns.get(number)
      const count = reviewsForClosing(
        turn?.data.get(REVIEW_TURN_DATA),
        Number.MAX_SAFE_INTEGER,
        root,
      ).length
      return count === 0 ? [] : [{ turn: number, count }]
    })
  }, [snapshot, root])
  const target =
    local !== null
      ? { turn: local.turn ?? turns[0]?.turn, closingSeq: Number.MAX_SAFE_INTEGER, focusPaths: [] }
      : (requested ?? { turn: turns[0]?.turn, closingSeq: Number.MAX_SAFE_INTEGER, focusPaths: [] })
  const reviews = useMemo(() => {
    if (target.turn === undefined || snapshot === EMPTY_SNAPSHOT) return []
    const turn = snapshot.timeline.turns.get(target.turn)
    const available = reviewsForClosing(turn?.data.get(REVIEW_TURN_DATA), target.closingSeq, root)
    if (target.focusPaths.length === 0) return available
    const focused = new Set(target.focusPaths.map((path) => reviewPathKey(path, root)))
    return available.filter((review) => focused.has(reviewPathKey(review.path, root)))
  }, [snapshot, target.turn, target.closingSeq, target.focusPaths, root])
  if (snapshot === EMPTY_SNAPSHOT)
    return (
      <div className={css.sidebarTabEmpty} role="status">
        {t('review.sidebarSessionUnavailable')}
      </div>
    )
  if (params !== null && params !== undefined && requested === undefined && local === null)
    return (
      <div className={css.sidebarTabEmpty} role="status">
        {t('review.sidebarTargetUnavailable')}
      </div>
    )
  const selectionValue = local !== null ? (local.turn ?? 'latest') : (requested?.turn ?? 'latest')
  return (
    <div
      className={css.sidebarTab}
      data-file-review-sidebar-tab=""
      data-review-owner="dsh-diff-review-likecodex"
    >
      <div className={css.reviewNavigation}>
        <label>
          <span>{t('review.turnPicker')}</span>
          <select
            aria-label={t('review.turnPicker')}
            value={selectionValue}
            onChange={(event) =>
              setSelection({
                sessionId,
                params,
                turn: event.target.value === 'latest' ? null : Number(event.target.value),
              })
            }
          >
            <option value="latest">{t('review.latestTurn')}</option>
            {turns.map((item) => (
              <option key={item.turn} value={item.turn}>
                {t('review.turnOption', { turn: String(item.turn), count: String(item.count) })}
              </option>
            ))}
          </select>
        </label>
        {target.focusPaths.length > 0 && (
          <button
            type="button"
            className={css.toolbarButton}
            onClick={() => setSelection({ sessionId, params, turn: target.turn ?? null })}
          >
            {t('review.allFiles')}
          </button>
        )}
      </div>
      {reviews.some((review) => review.readOnly) && (
        <div className={css.reviewReadOnly} role="note">
          {t('review.legacyReadOnly')}
        </div>
      )}
      {reviews.length === 0 || target.turn === undefined ? (
        <div className={css.sidebarTabEmpty} role="status">
          {t(turns.length === 0 ? 'review.noSessionChanges' : 'review.sidebarDataUnavailable')}
        </div>
      ) : (
        <ReviewContent
          reviews={reviews}
          projectRoot={root}
          sessionId={sessionId}
          turn={target.turn}
          closingSeq={target.closingSeq}
          openFile={(path) => openFile(absoluteReviewPath(path, root))}
          syncComments={syncComments}
          wordWrap={wordWrap}
          settings={settings}
          visible={visible}
          t={t}
        />
      )}
    </div>
  )
}
