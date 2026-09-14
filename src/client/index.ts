/** Browser registration for the isolated Diff Review Likecodex plugin. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { FileReviewRequest, FileReviewResult } from '../change-types.ts'
import { TYPERT_REMOTE } from '../remote.ts'
import {
  DEFAULT_WORD_WRAP,
  FILE_REVIEW_SETTINGS_NAMESPACE,
  type Config,
  type DiffLayout,
} from '../settings-contract.ts'
import { ProducedFiles } from './ProducedFiles.tsx'
import { LiveReviewDock } from './LiveReviewDock.tsx'
import { installReviewNavigation } from './review-navigation.tsx'
import type { FileReviewTabRuntime } from './FileReviewTab.tsx'
import { FileReviewSettingsCard } from './FileReviewSettingsCard.tsx'
import { ReviewCommentsDock } from './ReviewCommentsDock.tsx'
import { ReviewUserMessage } from './ReviewUserMessage.tsx'
import { en, NS, zh, type DeliverablesKey } from './locales.ts'
import { deliverablesDefinition, selectProducedFiles } from './turn-deliverables.ts'
import { bindReviewReference, reviewCommentSource } from './review-reference.ts'
import { clearAllReviewComments } from './review-comments.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'diff-review-likecodex': DeliverablesKey
  }
}
export const inject = [
  'slots',
  'locale',
  'uiConversation',
  'remote',
  'connection',
  'settingsScope',
  'sessions',
  'conversation',
  'inputTriggers',
  'sidebarRight',
  'sidebarRightTabs',
]

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const disposeReviewSource = ctx.inputTriggers.registerSource(reviewCommentSource())
  const settings = ctx.settingsScope.bind<Config>({ namespace: FILE_REVIEW_SETTINGS_NAMESPACE })
  const wordWrap = {
    getSnapshot: () => settings.getSnapshot().value?.wordWrap ?? DEFAULT_WORD_WRAP,
    subscribe: (listener: () => void) => settings.subscribe(listener),
  }
  const t = ctx.locale.bind(NS)
  const reviewBindings = new Map<string, ReturnType<typeof bindReviewReference>>()
  const reviewRemotes = new Map<string, FileReviewTabRuntime>()
  // Host and browser share a service key but have different Session interfaces.
  const sessions = (ctx as unknown as { readonly sessions: ISessions }).sessions
  const reviewBindingFor = (sessionId: SessionId) => {
    let binding = reviewBindings.get(sessionId)
    if (binding !== undefined) return binding
    const session = sessions.binding(sessionId)
    if (session === undefined) return undefined
    binding = bindReviewReference(
      session.ctx,
      sessionId,
      ctx.conversation.input.for(session.ctx),
      ctx.locale.bind(NS),
      session.eventSource,
    )
    reviewBindings.set(sessionId, binding)
    return binding
  }
  const reviewRemoteFor = (sessionId: SessionId): FileReviewTabRuntime => {
    let remote = reviewRemotes.get(sessionId)
    if (remote !== undefined) return remote
    const invoke = async (
      method: 'status' | 'apply',
      request: FileReviewRequest,
    ): Promise<FileReviewResult> => {
      const scope = sessions.scope(sessionId)
      if (scope === undefined) throw new Error('Session is unavailable')
      const fileReview = scope.get('remote.diffReviewLikecodex')
      if (fileReview === undefined) throw new Error('Diff Review Likecodex remote is unavailable')
      const result = await fileReview[method](request)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
    remote = {
      inspectChanges: (request) => invoke('status', request),
      applyChanges: (request) => invoke('apply', request),
      syncComments: () => {
        reviewBindingFor(sessionId)?.sync()
      },
    }
    reviewRemotes.set(sessionId, remote)
    return remote
  }
  const openReview = installReviewNavigation(ctx, {
    sessions,
    uiConversation: ctx.uiConversation,
    wordWrap,
    settings,
    t,
    runtimeFor: reviewRemoteFor,
  })
  ctx.uiConversation.events.register(deliverablesDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-diff-review-likecodex: dictionaries')
  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register(
      {
        name: 'settings.plugin.item',
        key: FILE_REVIEW_SETTINGS_NAMESPACE,
        priority: -100,
        locale: NS,
        inject: () => ({
          hooks: { fileReviewSettings: settings },
          setWordWrap: (value: boolean) => settings.set('wordWrap', value),
          setDiffLayout: (value: DiffLayout) => settings.set('diffLayout', value),
        }),
      },
      FileReviewSettingsCard,
    ),
  )
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.dock',
        id: 'dsh-diff-review-likecodex:comments',
        order: -10,
        locale: NS,
        inject: (sessionId) => ({ projectRoot: sessions.list.getSnapshot().byId[sessionId]?.cwd }),
      },
      ReviewCommentsDock,
    ),
  )
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.dock',
        id: 'dsh-diff-review-likecodex:live',
        order: -20,
        locale: NS,
        inject: (sessionId) => ({
          projectRoot: sessions.list.getSnapshot().byId[sessionId]?.cwd,
          openReview: (target: Parameters<typeof openReview>[1]) => openReview(sessionId, target),
        }),
      },
      LiveReviewDock,
    ),
  )
  for (const key of ['user', 'steering'] as const) {
    ctx.slots.inject('conversation.chat.node', () =>
      ctx.slots.register(
        {
          name: 'conversation.chat.node',
          key,
          priority: -20,
          locale: 'chat',
          inject: () => ({ reviewT: ctx.locale.bind(NS) }),
        },
        ReviewUserMessage,
      ),
    )
  }
  ctx.slots.inject('conversation.chat.turnTail', () =>
    ctx.slots.register(
      {
        name: 'conversation.chat.turnTail',
        select: selectProducedFiles,
        priority: -3,
        registrant: 'dsh-diff-review-likecodex',
        locale: NS,
        inject: (sessionId) => {
          const remote = reviewRemoteFor(sessionId)
          return {
            projectRoot: sessions.list.getSnapshot().byId[sessionId]?.cwd,
            openReview: (target: Parameters<typeof openReview>[1]) => openReview(sessionId, target),
            inspectChanges: remote.inspectChanges,
            applyChanges: remote.applyChanges,
          }
        },
      },
      ProducedFiles,
    ),
  )
  // Do not publish the shared chatFileMentions face: upstream owns it and
  // may load before OR after this fork. Review navigation uses our own slots.
  return async () => {
    for (const binding of reviewBindings.values()) binding.dispose()
    reviewBindings.clear()
    reviewRemotes.clear()
    disposeReviewSource()
    clearAllReviewComments()
    await disposeRemote()
  }
}
