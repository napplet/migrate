import { it, expect, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deploy } from './deploy-bunny.mjs'
import { configure } from './setup-github.mjs'
const env = {
  BUNNY_STORAGE_ZONE: 'zone',
  BUNNY_STORAGE_HOST: 'ny.storage.bunnycdn.com',
  BUNNY_STORAGE_PASSWORD: 'storage-secret',
  BUNNY_API_KEY: 'account-secret',
  BUNNY_PULL_ZONE_ID: '123',
}
it('uploads assets before HTML then purges with the correct key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'napplet-deploy-'))
  try {
    await mkdir(join(root, 'assets'))
    await writeFile(join(root, 'index.html'), 'html')
    await writeFile(join(root, 'assets', 'app.js'), 'code')
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }))
    await deploy({ env, root, fetcher, log: () => {} })
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
      'https://ny.storage.bunnycdn.com/zone/assets/app.js',
      'https://ny.storage.bunnycdn.com/zone/index.html',
      'https://api.bunny.net/pullzone/123/purgeCache',
    ])
    expect(fetcher.mock.calls[0][1].headers.AccessKey).toBe('storage-secret')
    expect(fetcher.mock.calls[2][1].headers.AccessKey).toBe('account-secret')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
it('never purges after a failed upload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'napplet-deploy-'))
  try {
    await writeFile(join(root, 'index.html'), 'html')
    const fetcher = vi.fn(async () => new Response(null, { status: 401 }))
    await expect(deploy({ env, root, fetcher, log: () => {} })).rejects.toThrow(
      'HTTP 401',
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
it('rejects arbitrary storage hosts before sending credentials', async () => {
  await expect(
    deploy({ env: { ...env, BUNNY_STORAGE_HOST: 'evil.test' } }),
  ).rejects.toThrow('BUNNY_STORAGE_HOST')
})
it('setup is idempotent and keeps all existing variables and secrets on Enter', async () => {
  const run = vi.fn((args) =>
    args[0] === 'variable'
      ? JSON.stringify(
          Object.entries(env)
            .filter(
              ([n]) => !['BUNNY_API_KEY', 'BUNNY_STORAGE_PASSWORD'].includes(n),
            )
            .map(([name, value]) => ({ name, value })),
        )
      : args[0] === 'secret'
        ? JSON.stringify([
            { name: 'BUNNY_API_KEY' },
            { name: 'BUNNY_STORAGE_PASSWORD' },
          ])
        : '',
  )
  await configure({
    run,
    repo: 'napplet/migrate',
    ask: async () => '',
    log: () => {},
  })
  expect(run.mock.calls.some(([args]) => args[1] === 'set')).toBe(false)
})
it('setup prompts sequentially, validates and sends secrets through stdin', async () => {
  const answers = [
    'zone',
    'evil.test',
    'ny.storage.bunnycdn.com',
    'storage-secret',
    '123',
    'account-secret',
  ]
  const run = vi.fn((args) => (args[1] === 'list' ? '[]' : ''))
  const ask = vi.fn(async () => answers.shift())
  await configure({ run, repo: 'napplet/migrate', ask, log: () => {} })
  const secretCalls = run.mock.calls.filter(
    ([args]) => args[0] === 'secret' && args[1] === 'set',
  )
  expect(secretCalls).toHaveLength(2)
  expect(secretCalls[0][1]).toBe('storage-secret')
  expect(secretCalls[0][0].join(' ')).not.toContain('storage-secret')
  expect(ask).toHaveBeenCalledTimes(6)
})

it('creates a missing environment without resetting existing environment protection rules', async () => {
  const answers = ['zone', '', 'storage-secret', '123', 'account-secret']
  const run = vi.fn((args) => {
    if (args[0] === 'api' && args.length === 2)
      throw Object.assign(new Error('Not Found'), { stderr: 'HTTP 404' })
    if (args[1] === 'list') return '[]'
    return ''
  })
  await configure({
    run,
    repo: 'napplet/migrate',
    ask: async () => answers.shift(),
    log: () => {},
  })
  expect(run.mock.calls.filter(([args]) => args.includes('PUT'))).toHaveLength(
    1,
  )
})
