/** Browser Typert contribution for the Host file-review service. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { FileReviewRequest, FileReviewResult } from './change-types.ts'
import { FILE_REVIEW_INVOCATIONS, PACKAGE_NAME } from './typert-descriptors.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    diffReviewLikecodex: {
      status: (
        agentId: SessionId,
        request: FileReviewRequest,
      ) => Promise<RemoteResult<FileReviewResult>>
      apply: (
        agentId: SessionId,
        request: FileReviewRequest,
      ) => Promise<RemoteResult<FileReviewResult>>
    }
  }
  interface TypertRemoteMap {
    'diffReviewLikecodex/status': (
      agentId: SessionId,
      request: FileReviewRequest,
    ) => Promise<RemoteResult<FileReviewResult>>
    'diffReviewLikecodex/apply': (
      agentId: SessionId,
      request: FileReviewRequest,
    ) => Promise<RemoteResult<FileReviewResult>>
  }
  interface TypertRemoteScopeMap {
    'agent:diffReviewLikecodex/status': (
      request: FileReviewRequest,
    ) => Promise<RemoteResult<FileReviewResult>>
    'agent:diffReviewLikecodex/apply': (
      request: FileReviewRequest,
    ) => Promise<RemoteResult<FileReviewResult>>
  }
}

export const TYPERT_REMOTE: TypertRemoteContribution = {
  package: PACKAGE_NAME,
  descriptors: FILE_REVIEW_INVOCATIONS,
}

export default TYPERT_REMOTE
