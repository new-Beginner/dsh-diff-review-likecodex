import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

async function main() {
  const credsRaw = execSync('git credential fill', {
    input: 'protocol=https\nhost=github.com\n',
    encoding: 'utf8',
  })
  const tokenMatch = credsRaw.match(/password=(.+)/)
  if (!tokenMatch) throw new Error('Cannot find GitHub token')
  const token = tokenMatch[1].trim()

  const repo = 'new-Beginner/dsh-diff-review-likecodex'
  const tag = 'v1.0.0'

  const body = {
    tag_name: tag,
    target_commitish: 'main',
    name: 'v1.0.0 - DSH Diff Review Likecodex',
    body: `## DSH Diff Review Likecodex v1.0.0

Review DeepSeek Harness file changes with Codex-like UX in native sidebar tabs, compact running dock, and turn-scoped deliverable diffs.

### ✨ Features & Enhancements
1. **Codex-like Review Entry**: Removed intrusive header button; enhanced native right sidebar tab, message-tail shortcut, and dynamic running dock above composer.
2. **Turn-scoped Changes**: Turn picker allows loading recorded file changes for any selected turn.
3. **Independent Namespaces**: Distinct \`diffReviewLikecodex\` service namespace without conflict with built-in or upstream plugins.
4. **Word Wrap**: Configurable automatic wrapping for long diff lines.

### 📦 Quick Install
Download the attached release asset \`dsh-diff-review-likecodex-1.0.0.tgz\` and install via:
\`\`\`sh
dsh plugin --profile web add ./dsh-diff-review-likecodex-1.0.0.tgz
\`\`\`
`,
    draft: false,
    prerelease: false,
  }

  console.log('Creating GitHub Release for', tag, '...')
  const res = await fetch(`https://api.github.com/repos/${repo}/releases`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dsh-release-bot',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Failed to create release: ${res.status} ${err}`)
  }

  const release = await res.json()
  console.log(`Release created successfully: ${release.html_url}`)

  const assetPath = resolve(root, 'dsh-diff-review-likecodex-1.0.0.tgz')
  const assetData = readFileSync(assetPath)
  const assetName = 'dsh-diff-review-likecodex-1.0.0.tgz'

  const uploadUrl = release.upload_url.replace(
    /\{\?name,label\}/,
    `?name=${encodeURIComponent(assetName)}`,
  )
  console.log('Uploading release asset:', assetName, `(${assetData.byteLength} bytes)...`)

  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dsh-release-bot',
      'Content-Type': 'application/gzip',
      'Content-Length': String(assetData.byteLength),
    },
    body: assetData,
  })

  if (!uploadRes.ok) {
    const err = await uploadRes.text()
    throw new Error(`Failed to upload asset: ${uploadRes.status} ${err}`)
  }

  const asset = await uploadRes.json()
  console.log(`Asset uploaded successfully: ${asset.browser_download_url}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
