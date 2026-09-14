/** Optional Better Sidebar adapter with a native right-sidebar fallback. */
import { useCallback, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { BetterSidebarService, TabComponentProps } from 'dsh-better-sidebar/client/api'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { FileReviewTab, type ReviewTarget } from './FileReviewTab.tsx'
import { installNativeSidebarIntegration } from './native-sidebar-adapter.tsx'

export const BETTER_REVIEW_TAB_ID = 'dsh-diff-review-likecodex:review-browser'
type Options = Parameters<typeof installNativeSidebarIntegration>[1]

export function installReviewNavigation(ctx: Context, options: Options) {
  const nativeOpen = installNativeSidebarIntegration(ctx, options)
  let better: BetterSidebarService | undefined
  let revision = 0
  const requests = new Map<string, { revision: number; target: ReviewTarget | null }>()
  const listeners = new Map<string, Set<() => void>>()
  ctx.effect(() => () => {
    requests.clear()
    listeners.clear()
  })
  // Only this optional child fiber waits for Better Sidebar. Native review and
  // capture remain available when it is absent, disabled, or loaded later.
  ctx.inject(['betterSidebar'], (scoped) => {
    const service = scoped.betterSidebar
    scoped.effect(
      () =>
        service.registerTab({
          id: BETTER_REVIEW_TAB_ID,
          title: () => options.t('review.title'),
          description: () => options.t('review.openSession'),
          order: 35,
          single: true,
          component: function BetterReview({ scope, tab, visible }: TabComponentProps) {
            const sessionId = scope.sessionId as SessionId
            const getRequest = useCallback(() => requests.get(sessionId), [sessionId])
            const subscribeRequest = useCallback(
              (listener: () => void) => {
                let sessionListeners = listeners.get(sessionId)
                if (sessionListeners === undefined) {
                  sessionListeners = new Set()
                  listeners.set(sessionId, sessionListeners)
                }
                sessionListeners.add(listener)
                return () => {
                  sessionListeners.delete(listener)
                }
              },
              [sessionId],
            )
            const request = useSyncExternalStore(subscribeRequest, getRequest, getRequest)
            return (
              <FileReviewTab
                key={`${sessionId}:${request?.revision ?? 0}`}
                sessions={options.sessions}
                uiConversation={options.uiConversation}
                sessionId={sessionId}
                projectRoot={scope.cwd}
                params={request === undefined ? tab.meta : request.target}
                visible={visible}
                wordWrap={options.wordWrap}
                settings={options.settings}
                t={options.t}
                syncComments={options.runtimeFor(sessionId).syncComments}
                openFile={(path) => service.openFile(scope, path)}
              />
            )
          },
        }),
      'dsh-diff-review-likecodex: better-sidebar tab',
    )
    scoped.effect(() => {
      better = service
      return () => {
        if (better === service) better = undefined
      }
    })
  })
  const openReview = (sessionId: SessionId, target?: ReviewTarget) => {
    if (better !== undefined) {
      requests.set(sessionId, {
        revision: ++revision,
        target: target === undefined ? null : { ...target, focusPaths: [...target.focusPaths] },
      })
      for (const listener of listeners.get(sessionId) ?? []) listener()
      const cwd = options.sessions.list.getSnapshot().byId[sessionId]?.cwd
      better.openTab(
        { type: BETTER_REVIEW_TAB_ID, meta: target ?? null },
        { sessionId, ...(cwd === undefined ? {} : { cwd }) },
      )
    } else nativeOpen(sessionId, target)
  }
  return openReview
}
