/** Session-local, live review summary pinned above the resident composer. */
import { useMemo } from 'react'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReviewTarget } from './FileReviewTab.tsx'
import { ReviewStats } from './ReviewContent.tsx'
import { reviewsForClosing, REVIEW_TURN_DATA } from './turn-deliverables.ts'
import { summarizeDiffs } from './UnifiedDiff.tsx'
import type { NS } from './locales.ts'
import css from './ProducedFiles.module.css'

export type LiveReviewDockProps = Pick<
  PropsRuntime<'conversation.input.dock'>,
  'sessionId' | 'useChat' | 'useSession'
> &
  PropsLocale<typeof NS> & {
    readonly openReview: (target: ReviewTarget) => void
    readonly projectRoot?: string | undefined
  }

/** Never fall back to an older open turn after a new turn has started. */
export function latestOpenReviewTurn(snapshot: ChatSnapshot) {
  const number = snapshot.timeline.turnOrder.at(-1)
  if (number === undefined) return undefined
  const turn = snapshot.timeline.turns.get(number)
  return turn?.status === 'open' ? turn : undefined
}

export function LiveReviewDock({
  sessionId,
  useChat,
  useSession,
  openReview,
  projectRoot,
  t,
}: LiveReviewDockProps) {
  const running = useSession((session) => session.running)
  const turn = useChat(latestOpenReviewTurn)
  // Location data readers are live and stable. Select their leaf value inside
  // the hook so new tool results update the summary even if Turn identity stays.
  const data = useChat((snapshot) => latestOpenReviewTurn(snapshot)?.data.get(REVIEW_TURN_DATA))
  const reviews = useMemo(
    () => reviewsForClosing(data, Number.MAX_SAFE_INTEGER, projectRoot),
    [data, projectRoot],
  )
  const stats = useMemo(() => summarizeDiffs(reviews.flatMap((review) => review.diffs)), [reviews])

  if (!running || turn === undefined || reviews.length === 0) return null

  return (
    <div className={css.liveDock} data-file-review-live="" data-session-id={sessionId}>
      <button
        type="button"
        className={css.liveReviewButton}
        aria-label={t('produced.reviewLive')}
        onClick={() =>
          openReview({
            turn: turn.turn,
            // A finite, JSON-safe upper bound keeps this turn live in the sidebar.
            // Empty focusPaths includes files captured after the click as well.
            closingSeq: Number.MAX_SAFE_INTEGER,
            focusPaths: [],
          })
        }
      >
        <svg viewBox="0 0 20 20" className={css.icon} aria-hidden="true">
          <path d="M5.25 2.75h6l3.5 3.5v10a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1Z" />
          <path d="M11.25 2.75v3.5h3.5M7 10h5M9.5 7.5v5M7 15h5" />
        </svg>
        <span className={css.liveTitle}>
          {reviews.length === 1
            ? t('produced.editedOne')
            : t('produced.edited', { count: String(reviews.length) })}
        </span>
        <ReviewStats
          stats={stats}
          label={t('review.stats', { added: String(stats.added), removed: String(stats.removed) })}
        />
        <span className={css.liveReviewAction}>{t('review.title')}</span>
        <svg viewBox="0 0 20 20" className={css.buttonIcon} aria-hidden="true">
          <path d="m7.5 5 5 5-5 5" />
        </svg>
      </button>
    </div>
  )
}
