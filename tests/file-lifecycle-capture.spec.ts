import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, inject } from '../src/index.ts'
import { markerFromContent } from '../src/ptc-marker.ts'
import { transformFile } from '../src/file-review-service.ts'

/** Exercise capture through actual tool dispatch without permission-dependent assertions. */
async function captureMutation(
  root: string,
  callPaths: readonly string[],
  resultPaths: readonly string[],
  mutate: () => Promise<void>,
) {
  const callId = 'capture-regression'
  ctx = new Context()
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(Tools, {})
  await ctx.plugin({ apply, inject }).await()
  ctx.tools.register(
    defineTool({
      name: 'fixture_capture_regression',
      description: 'capture a fixture mutation',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      presentCall: () => ({
        card: 'diff',
        title: 'Capture regression',
        locations: callPaths.map((path) => ({ path })),
        diffs: callPaths.map((path) => ({ path, oldText: 'placeholder', newText: 'presentation' })),
      }),
      presentResult: () => ({
        card: 'diff',
        diffs: resultPaths.map((path) => ({
          path,
          oldText: 'placeholder',
          newText: 'presentation',
        })),
      }),
      async execute() {
        await mutate()
        return 'done'
      },
    }),
  )
  const result = await ctx.tools.execute({
    callId,
    name: 'fixture_capture_regression',
    arguments: {},
    agent: agent(root, callId),
    signal: new AbortController().signal,
  })
  expect(result.isError).toBe(false)
  const marker = markerFromContent(result.content, { rootCallId: callId, subCallId: callId })
  expect(marker).not.toBeNull()
  return marker!.files
}

let ctx: Context | undefined
const roots: string[] = []

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-review-capture-'))
  roots.push(root)
  return root
}

function agent(cwd: string, callId: string, step = 1): Agent {
  return {
    session: {
      header: { cwd },
      events: [
        {
          seq: 0,
          time: 0,
          type: 'tool/call',
          data: { turn: 4, step, callId, name: 'fixture_write', arguments: '{}' },
        },
      ],
    },
  } as unknown as Agent
}

describe('tool lifecycle capture', () => {
  it('deduplicates duplicate root aliases between absolute capture and relative presentResult paths', async () => {
    const root = await workspace()
    await mkdir(join(root, 'src'))
    const filename = join(root, 'src', 'index.ts')
    await writeFile(filename, 'before\n')
    const files = await captureMutation(
      root,
      [filename, './src/index.ts', 'src/../src/index.ts'],
      ['src/index.ts', filename, './src/./index.ts'],
      () => writeFile(filename, 'after\n'),
    )
    expect(files).toEqual([
      {
        path: 'src/index.ts',
        source: 'result',
        diffs: [
          {
            path: 'src/index.ts',
            oldText: 'before\n',
            newText: 'after\n',
            oldStart: 1,
            newStart: 1,
          },
        ],
      },
    ])
    expect(transformFile('after\n', files[0]!, 'undo')).toBe('before\n')
  })

  it('keeps identical basenames in separate directories and canonicalizes uncaptured presentation aliases', async () => {
    const root = await workspace()
    await Promise.all(['a', 'b'].map((directory) => mkdir(join(root, directory))))
    await Promise.all(
      ['a', 'b'].map((directory) =>
        writeFile(join(root, directory, 'index.ts'), `${directory}-old`),
      ),
    )
    const files = await captureMutation(
      root,
      [join(root, 'a/index.ts'), './a/index.ts', 'b/index.ts'],
      [
        'a/index.ts',
        join(root, 'b/index.ts'),
        './missing.ts',
        './missing.ts',
        join(root, 'missing.ts'),
      ],
      async () => {
        await writeFile(join(root, 'a/index.ts'), 'a-new')
        await writeFile(join(root, 'b/index.ts'), 'b-new')
      },
    )
    expect(files.map((file) => file.path)).toEqual(['a/index.ts', 'b/index.ts', 'missing.ts'])
    expect(files[0]?.diffs[0]?.oldText).toBe('a-old')
    expect(files[1]?.diffs[0]?.oldText).toBe('b-old')
    // Preserve intentional duplicates within one presentation; only aliases are redundant.
    expect(files[2]?.diffs).toEqual([
      { path: 'missing.ts', oldText: 'placeholder', newText: 'presentation' },
      { path: 'missing.ts', oldText: 'placeholder', newText: 'presentation' },
    ])
  })

  it('does not capture outside-root files when normalizing aliases', async () => {
    const root = await workspace()
    const outside = join(await workspace(), 'outside.ts')
    await writeFile(join(root, 'inside.ts'), 'inside-old')
    await writeFile(outside, 'outside-old')
    const files = await captureMutation(
      root,
      ['inside.ts', outside],
      ['inside.ts', outside],
      async () => {
        await writeFile(join(root, 'inside.ts'), 'inside-new')
        await writeFile(outside, 'outside-new')
      },
    )
    expect(files[0]?.diffs[0]?.oldText).toBe('inside-old')
    // Retain the tool presentation, but never replace it with a filesystem snapshot outside cwd.
    expect(files[1]?.diffs[0]?.oldText).toBe('placeholder')
    expect(files[1]?.diffs[0]?.oldStart).toBeUndefined()
  })

  it('captures exactly three real context lines above and below an isolated edit with CRLF', async () => {
    const root = await workspace()
    const filename = join(root, 'context.txt')
    const lines = Array.from({ length: 13 }, (_, index) => `line-${index + 1}`)
    const before = lines.join('\r\n') + '\r\n'
    const changed = [...lines]
    changed[6] = 'changed'
    const after = changed.join('\r\n') + '\r\n'
    await writeFile(filename, before)
    const files = await captureMutation(root, [filename], ['context.txt'], () =>
      writeFile(filename, after),
    )
    expect(files).toEqual([
      {
        path: 'context.txt',
        source: 'result',
        diffs: [
          {
            path: 'context.txt',
            oldText: lines.slice(3, 10).join('\r\n') + '\r\n',
            newText: changed.slice(3, 10).join('\r\n') + '\r\n',
            oldStart: 4,
            newStart: 4,
          },
        ],
      },
    ])
    expect(transformFile(after, files[0]!, 'undo')).toBe(before)
    expect(transformFile(before, files[0]!, 'redo')).toBe(after)
  })

  it.each([3, 5, 6, 7])(
    'avoids duplicate or overlapping three-line context with %i unchanged lines between edits',
    async (gap) => {
      const root = await workspace()
      const filename = join(root, 'overlap.txt')
      const lines = Array.from({ length: 24 }, (_, index) => `line-${index + 1}`)
      const before = lines.join('\n') + '\n'
      const changed = [...lines]
      changed[4] = 'first-change'
      changed[5 + gap] = 'second-change'
      const after = changed.join('\n') + '\n'
      await writeFile(filename, before)
      const files = await captureMutation(root, ['overlap.txt'], [filename], () =>
        writeFile(filename, after),
      )
      const file = files[0]!
      expect(file.diffs).toHaveLength(gap <= 6 ? 1 : 2)
      for (const diff of file.diffs) {
        const oldCount = diff.oldText!.split('\n').length - 1
        const newCount = diff.newText.split('\n').length - 1
        expect(diff.oldText).toBe(
          lines.slice(diff.oldStart! - 1, diff.oldStart! - 1 + oldCount).join('\n') + '\n',
        )
        expect(diff.newText).toBe(
          changed.slice(diff.newStart! - 1, diff.newStart! - 1 + newCount).join('\n') + '\n',
        )
      }
      expect(transformFile(after, file, 'undo')).toBe(before)
      expect(transformFile(before, file, 'redo')).toBe(after)
    },
  )

  it.each([
    ['head insert', 'a\nb\nc\nd\ne\n', 'head\na\nb\nc\nd\ne\n'],
    ['head delete', 'head\na\nb\nc\nd\ne\n', 'a\nb\nc\nd\ne\n'],
    ['tail insert', 'a\nb\nc\nd\ne\n', 'a\nb\nc\nd\ne\ntail\n'],
    ['tail delete', 'a\nb\nc\nd\ne\ntail\n', 'a\nb\nc\nd\ne\n'],
    ['empty insert', '', 'first\r\n'],
    ['empty delete', 'last\r\n', ''],
    ['unterminated CRLF tail', 'a\r\nb\r\nc', 'a\r\nb\r\nc\r\ntail'],
    ['remove final newline', 'a\r\nb\r\nc\r\n', 'a\r\nb\r\nc'],
  ])('preserves exact coordinates and undo content for %s', async (_name, before, after) => {
    const root = await workspace()
    const filename = join(root, 'edge.txt')
    await writeFile(filename, before)
    const files = await captureMutation(root, [filename], ['edge.txt'], () =>
      writeFile(filename, after),
    )
    const file = files[0]!
    expect(file.diffs).toHaveLength(1)
    const diff = file.diffs[0]!
    expect(diff.oldStart).toBeGreaterThanOrEqual(1)
    expect(diff.newStart).toBeGreaterThanOrEqual(1)
    expect(transformFile(after, file, 'undo')).toBe(before)
    expect(transformFile(before, file, 'redo')).toBe(after)
  })

  // 验证根据工具执行前后的磁盘状态，记录新建文件的内容、权限和明确的创建标记。
  it('persists an explicit create diff from the execution before/after state', async () => {
    const root = await workspace()
    const filename = join(root, 'created.txt')
    const callId = 'create-call'
    ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(Tools, {})
    const mounted = ctx.plugin({ apply, inject })
    await mounted.await()
    ctx.tools.register(
      defineTool({
        name: 'fixture_write',
        description: 'write a fixture file',
        parameters: {
          path: { type: 'string', required: true },
          content: { type: 'string', required: true },
        },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        presentCall: (args) => ({
          card: 'diff',
          title: `Write ${args.path}`,
          locations: [{ path: args.path }],
          diffs: [{ path: args.path, oldText: null, newText: args.content }],
        }),
        async execute(args) {
          await writeFile(join(root, args.path), args.content, { mode: 0o640 })
          return args.path
        },
      }),
    )

    const result = await ctx.tools.execute({
      callId,
      name: 'fixture_write',
      arguments: { path: 'created.txt', content: 'created' },
      agent: agent(root, callId),
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(false)
    expect(
      markerFromContent(result.content, { rootCallId: callId, subCallId: callId })?.files,
    ).toEqual([
      {
        path: 'created.txt',
        source: 'result',
        diffs: [
          {
            path: 'created.txt',
            oldText: null,
            newText: 'created',
            oldStart: 1,
            newStart: 1,
            lifecycle: { kind: 'create', mode: 0o640 },
          },
        ],
      },
    ])
    expect(await readFile(filename, 'utf8')).toBe('created')
  })

  // 验证通用删除工具执行后仍能记录删除前的文件内容和权限，供后续恢复使用。
  it('persists the deleted file contents and permissions for a generic delete tool', async () => {
    const root = await workspace()
    const filename = join(root, 'deleted.txt')
    await writeFile(filename, 'deleted', { mode: 0o600 })
    const callId = 'delete-call'
    ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(Tools, {})
    const mounted = ctx.plugin({ apply, inject })
    await mounted.await()
    ctx.tools.register(
      defineTool({
        name: 'fixture_delete',
        description: 'delete a fixture file',
        parameters: { path: { type: 'string', required: true } },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        presentCall: (args) => ({
          card: 'generic',
          title: `Delete ${args.path}`,
          kind: 'delete',
          locations: [{ path: args.path }],
        }),
        async execute(args) {
          await rm(join(root, args.path))
          return args.path
        },
      }),
    )

    const result = await ctx.tools.execute({
      callId,
      name: 'fixture_delete',
      arguments: { path: 'deleted.txt' },
      agent: agent(root, callId),
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(false)
    expect(
      markerFromContent(result.content, { rootCallId: callId, subCallId: callId })?.files,
    ).toEqual([
      {
        path: 'deleted.txt',
        source: 'result',
        diffs: [
          {
            path: 'deleted.txt',
            oldText: 'deleted',
            newText: '',
            oldStart: 1,
            newStart: 1,
            lifecycle: { kind: 'delete', mode: 0o600 },
          },
        ],
      },
    ])
  })

  // 验证三行上下文保留插入删除坐标，并由补丁库合并相邻上下文，避免重叠重复。
  it('captures insert/delete coordinates with three real context lines and merged neighboring hunks', async () => {
    const root = await workspace()
    const filename = join(root, 'edited.txt')
    const before =
      [
        'repeat',
        'lead-1',
        'lead-2',
        'lead-3',
        'lead-4',
        'lead-5',
        'lead-6',
        'repeat',
        'five-1',
        'five-2',
        'five-3',
        'five-4',
        'five-5',
        'second-old',
        'six-1',
        'six-2',
        'six-3',
        'six-4',
        'six-5',
        'six-6',
        'distant-old',
        'tail',
      ].join('\n') + '\n'
    const after =
      [
        'inserted',
        'repeat',
        'lead-1',
        'lead-2',
        'lead-3',
        'lead-4',
        'lead-5',
        'lead-6',
        'changed',
        'five-1',
        'five-2',
        'five-3',
        'five-4',
        'five-5',
        'second-new',
        'six-1',
        'six-2',
        'six-3',
        'six-4',
        'six-5',
        'six-6',
        'tail',
      ].join('\n') + '\n'
    await writeFile(filename, before)
    const callId = 'edit-call'
    ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(Tools, {})
    const mounted = ctx.plugin({ apply, inject })
    await mounted.await()
    ctx.tools.register(
      defineTool({
        name: 'fixture_edit',
        description: 'edit a fixture file',
        parameters: { path: { type: 'string', required: true } },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        presentCall: (args) => ({
          card: 'diff',
          title: `Edit ${args.path}`,
          locations: [{ path: args.path }],
          diffs: [{ path: args.path, oldText: 'repeat', newText: 'changed' }],
        }),
        presentResult: (args) => ({
          card: 'diff',
          diffs: [{ path: args.path, oldText: 'repeat', newText: 'changed' }],
        }),
        async execute(args) {
          await writeFile(join(root, args.path), after)
          return args.path
        },
      }),
    )

    const result = await ctx.tools.execute({
      callId,
      name: 'fixture_edit',
      arguments: { path: 'edited.txt' },
      agent: agent(root, callId),
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(false)
    expect(
      markerFromContent(result.content, { rootCallId: callId, subCallId: callId })?.files,
    ).toEqual([
      {
        path: 'edited.txt',
        source: 'result',
        diffs: [
          {
            path: 'edited.txt',
            oldText: 'repeat\nlead-1\nlead-2\n',
            newText: 'inserted\nrepeat\nlead-1\nlead-2\n',
            oldStart: 1,
            newStart: 1,
          },
          {
            path: 'edited.txt',
            oldText: before.split('\n').slice(4).join('\n'),
            newText: after.split('\n').slice(5).join('\n'),
            oldStart: 5,
            newStart: 6,
          },
        ],
      },
    ])
    const file = markerFromContent(result.content, { rootCallId: callId, subCallId: callId })!
      .files[0]!
    expect(transformFile(after, file, 'undo')).toBe(before)
  })

  // 验证一次工具调用同时编辑和新建或删除文件时，普通编辑差异与生命周期快照都被保留。
  it('keeps ordinary edit diffs beside captured lifecycle diffs from the same call', async () => {
    const root = await workspace()
    await writeFile(join(root, 'edited.txt'), 'old')
    const callId = 'mixed-call'
    ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(Tools, {})
    const mounted = ctx.plugin({ apply, inject })
    await mounted.await()
    ctx.tools.register(
      defineTool({
        name: 'fixture_mixed',
        description: 'create one file and edit another',
        parameters: {},
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        presentCall: () => ({
          card: 'diff',
          title: 'Mixed write',
          locations: [{ path: 'created.txt' }, { path: 'edited.txt' }],
          diffs: [
            { path: 'created.txt', oldText: null, newText: 'created' },
            { path: 'edited.txt', oldText: 'old', newText: 'new' },
          ],
        }),
        presentResult: () => ({
          card: 'diff',
          diffs: [
            { path: 'created.txt', oldText: null, newText: 'created' },
            { path: 'edited.txt', oldText: 'old', newText: 'new' },
          ],
        }),
        async execute() {
          await writeFile(join(root, 'created.txt'), 'created', { mode: 0o640 })
          await writeFile(join(root, 'edited.txt'), 'new')
          return 'done'
        },
      }),
    )

    const result = await ctx.tools.execute({
      callId,
      name: 'fixture_mixed',
      arguments: {},
      agent: agent(root, callId),
      signal: new AbortController().signal,
    })
    const files = markerFromContent(result.content, {
      rootCallId: callId,
      subCallId: callId,
    })?.files

    expect(files).toEqual([
      {
        path: 'created.txt',
        source: 'result',
        diffs: [
          {
            path: 'created.txt',
            oldText: null,
            newText: 'created',
            oldStart: 1,
            newStart: 1,
            lifecycle: { kind: 'create', mode: 0o640 },
          },
        ],
      },
      {
        path: 'edited.txt',
        source: 'result',
        diffs: [
          {
            path: 'edited.txt',
            oldText: 'old',
            newText: 'new',
            oldStart: 1,
            newStart: 1,
          },
        ],
      },
    ])
  })
})
