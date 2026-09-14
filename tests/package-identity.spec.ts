import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TYPERT_REMOTE } from '../src/remote.ts'
import { TYPERT } from '../src/typert.host.ts'
import { FILE_REVIEW_INVOCATIONS } from '../src/typert-descriptors.ts'
import { FILE_REVIEW_SETTINGS_NAMESPACE } from '../src/settings-contract.ts'
import { NS } from '../src/client/locales.ts'
import { REVIEW_COMMENT_SOURCE } from '../src/client/review-reference.ts'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string
  files: string[]
}

describe('package identity', () => {
  it('isolates the fork identity without redirecting feedback to upstream', () => {
    expect(manifest.name).toBe('dsh-diff-review-likecodex')
    for (const field of ['homepage', 'bugs', 'repository']) {
      expect(manifest).not.toHaveProperty(field)
    }
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(patch).toContain('id: dsh-diff-review-likecodex:plugin')
    expect(patch).not.toContain('ui-deliverables')
    expect(patch).not.toContain('disabled: true')
    expect(TYPERT.model.services.map(({ key }) => key)).toEqual(['diffReviewLikecodex'])
    for (const descriptor of FILE_REVIEW_INVOCATIONS) {
      expect(descriptor.service).toBe('diffReviewLikecodex')
      expect(descriptor.namespace).toBe('diffReviewLikecodex')
    }
  })

  it('owns separate settings, locale and comment namespaces', () => {
    expect(FILE_REVIEW_SETTINGS_NAMESPACE).toBe('diff-review-likecodex')
    expect(NS).toBe('diff-review-likecodex')
    expect(REVIEW_COMMENT_SOURCE).toBe('dsh-diff-review-likecodex:comments')
  })

  it('keeps the upstream MIT notice and makes better-sidebar optional', () => {
    const license = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8')
    expect(license).toContain('MIT License')
    expect(license).toContain('Copyright (c) 2026 new-Beginner')
    expect(manifest).toMatchObject({
      license: 'MIT',
      devDependencies: { 'dsh-better-sidebar': '0.19.1' },
      peerDependencies: { 'dsh-better-sidebar': '>=0.19.1 <0.20' },
      peerDependenciesMeta: { 'dsh-better-sidebar': { optional: true } },
    })
    expect(manifest).not.toHaveProperty(
      'dsh.client.inject',
      expect.arrayContaining(['dsh-better-sidebar']),
    )
  })

  // 验证 Cordis 加载配置使用 package.json 中的实际包名，不引用旧的作用域包名。
  it('uses the manifest package name in the Cordis loader entry', () => {
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

    expect(patch).toContain(`name: '${manifest.name}'`)
    expect(patch).not.toContain('@deepseek-ai/dsh-file-review')
  })

  // 验证服务端和客户端的远程接口使用统一包名，且状态查询与修改接口标识一致。
  it('uses the manifest package name throughout both Typert contributions', () => {
    expect(TYPERT.package).toBe(manifest.name)
    expect(TYPERT_REMOTE.package).toBe(manifest.name)
    expect(FILE_REVIEW_INVOCATIONS.map(({ id }) => id)).toEqual([
      `${manifest.name}#diffReviewLikecodex/status`,
      `${manifest.name}#diffReviewLikecodex/apply`,
    ])
    expect(JSON.stringify(FILE_REVIEW_INVOCATIONS)).not.toContain('@deepseek-ai/dsh-file-review')
  })

  // 验证发布清单包含 README 预览图，并使用正确拼写的 assets 目录。
  it('publishes the README preview image from the correctly named assets directory', () => {
    expect(manifest.files).toContain('assets/preview.png')
    expect(manifest.files.some((file) => file.startsWith('assests/'))).toBe(false)
  })
})
