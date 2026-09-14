// ProducedFiles: compact turn-tail summary with native review-tab navigation.

import { useMemo } from 'react'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { FileReviewRequest, FileReviewResult } from '../change-types.ts'
import type { NS } from './locales.ts'
import { ReviewStats } from './ReviewContent.tsx'
import { ReviewResultToast, unavailableChanges, useReviewActions } from './review-actions.tsx'
import type { ReviewTarget } from './FileReviewTab.tsx'
import {
  basename,
  reviewsForClosing,
  REVIEW_TURN_DATA,
  type ProducedFileReview,
} from './turn-deliverables.ts'
import { summarizeDiffs, type UnifiedDiffStats } from './UnifiedDiff.tsx'
import css from './ProducedFiles.module.css'

/** Matched file reviews plus the opener and locale supplied by the turn-tail slot. */
export type ProducedFilesProps = Pick<TurnTailOwnerProps, 'openFile'> & {
  matched: readonly ProducedFileReview[]
  projectRoot?: string | undefined
  openReview: (target: ReviewTarget) => void
  inspectChanges?: (request: FileReviewRequest) => Promise<FileReviewResult>
  applyChanges?: (request: FileReviewRequest) => Promise<FileReviewResult>
  /** Turn-tail identity used to keep repeated file/line coordinates distinct. */
  turn?: TurnTailOwnerProps['turn'] | undefined
  seq?: number | undefined
} & PropsLocale<typeof NS>

function FileIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.icon}>
      <path d="M5.25 2.75h6l3.5 3.5v10a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1Z" />
      <path d="M11.25 2.75v3.5h3.5M7 10h5M7 13h5" />
    </svg>
  )
}

function ReviewIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.buttonIcon}>
      <path d="M4.5 3.5h8a1 1 0 0 1 1 1v3M6.5 6.5h4M6.5 9.5h2.25" />
      <path d="m10.5 13 1.5 1.5 3.5-4" />
    </svg>
  )
}

function addStats(left: UnifiedDiffStats, right: UnifiedDiffStats): UnifiedDiffStats {
  return { added: left.added + right.added, removed: left.removed + right.removed }
}

/** Render one turn's produced files and open their native review tab. */
export function ProducedFiles({
  matched,
  projectRoot,
  openFile,
  openReview,
  inspectChanges = unavailableChanges,
  applyChanges = unavailableChanges,
  turn,
  seq = 0,
  t,
}: ProducedFilesProps) {
  const turnNumber = turn?.turn ?? 0
  const data = turn?.data?.get(REVIEW_TURN_DATA)
  const reviews = useMemo(
    () =>
      reviewsForClosing(
        data ?? { produced: matched.map((review) => ({ ...review, seq: 0 })) },
        seq,
        projectRoot,
      ),
    [data, matched, seq, projectRoot],
  )
  const repeatedNames = useMemo(() => {
    const seen = new Set<string>()
    const repeated = new Set<string>()
    for (const review of reviews) {
      const name = basename(review.path)
      if (seen.has(name)) repeated.add(name)
      seen.add(name)
    }
    return repeated
  }, [reviews])

  const reviewsWithStats = useMemo(
    () =>
      reviews.map((review) => ({
        review,
        stats: summarizeDiffs(review.diffs),
      })),
    [reviews],
  )
  const totalStats = useMemo(
    () =>
      reviewsWithStats.reduce<UnifiedDiffStats>((total, item) => addStats(total, item.stats), {
        added: 0,
        removed: 0,
      }),
    [reviewsWithStats],
  )
  const actions = useReviewActions({ reviews, inspectChanges, applyChanges, t })

  return (
    <>
      <section className={css.card} aria-label={t('produced.summary')}>
        <header className={css.cardHeader}>
          <span className={css.fileIconWrap}>
            <FileIcon />
          </span>
          <div className={css.cardTitleBlock}>
            <span className={css.cardTitle}>
              {reviews.length === 1
                ? t('produced.editedOne')
                : t('produced.edited', { count: String(reviews.length) })}
            </span>
            <ReviewStats
              stats={totalStats}
              label={t('review.stats', {
                added: String(totalStats.added),
                removed: String(totalStats.removed),
              })}
            />
          </div>
          <button
            type="button"
            className={css.toggleButton}
            disabled={actions.statusPending || actions.togglePending || !actions.hasReversibleFiles}
            title={!actions.hasReversibleFiles ? t('produced.toggleUnavailable') : undefined}
            aria-label={actions.action === 'undo' ? t('produced.undo') : t('produced.redo')}
            onClick={actions.run}
          >
            {actions.togglePending
              ? actions.action === 'undo'
                ? t('produced.undoing')
                : t('produced.redoing')
              : actions.action === 'undo'
                ? t('produced.undo')
                : t('produced.redo')}
          </button>
          <button
            type="button"
            className={css.reviewButton}
            aria-label={t('produced.reviewAll')}
            onClick={() =>
              openReview({
                turn: turnNumber,
                closingSeq: seq,
                focusPaths: reviews.map((review) => review.path),
              })
            }
          >
            <ReviewIcon />
            {t('review.title')}
          </button>
        </header>
        {reviews.some((review) => review.readOnly) && (
          <div className={css.reviewReadOnly} role="note">
            {t('review.legacyReadOnly')}
          </div>
        )}
        <div className={css.fileList}>
          {reviewsWithStats.map(({ review, stats }) => (
            <button
              key={review.path}
              type="button"
              className={css.fileRow}
              title={review.path}
              aria-label={t('produced.review', { name: review.path })}
              onClick={() =>
                openReview({ turn: turnNumber, closingSeq: seq, focusPaths: [review.path] })
              }
            >
              <FileIcon />
              <span className={css.fileName}>
                {repeatedNames.has(basename(review.path)) ? review.path : basename(review.path)}
              </span>
              <ReviewStats
                stats={stats}
                label={t('review.stats', {
                  added: String(stats.added),
                  removed: String(stats.removed),
                })}
              />
            </button>
          ))}
        </div>
      </section>

      {actions.notice !== null && (
        <ReviewResultToast
          key={actions.notice.seq}
          notice={actions.notice}
          t={t}
          openFile={openFile}
          onDone={actions.dismissNotice}
        />
      )}
    </>
  )
}
