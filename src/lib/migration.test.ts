import { describe, it, expect } from 'vitest'
import {
  finalizeEvent,
  generateSecretKey,
  nip19,
  verifyEvent,
} from 'nostr-tools'
import supersonic from '../../tests/fixtures/supersonic-rc-revive.json'
import {
  createDraft,
  buildMigration,
  migrationIssues,
  migrationDiagnostics,
  latestManifests,
  descriptionError,
} from './migration'
const key = generateSecretKey(),
  hash = 'a'.repeat(64)
function event(extra: string[][] = [], kind = 35129) {
  return finalizeEvent(
    {
      kind,
      created_at: 100,
      content: '',
      tags: [
        ...(kind === 35129 ? [['d', 'test']] : []),
        ['path', '/index.html', hash],
        ['x', 'b'.repeat(64), 'aggregate'],
        ['description', 'A simple app'],
        ['requires', 'relay'],
        ['requires', 'theme'],
        ...extra,
      ],
    },
    key,
  )
}
describe('standalone manifest migration', () => {
  it('moves description, replaces aggregate with artifact hash, and splits capabilities', () => {
    const old = event([['t', 'preserve']]),
      before = JSON.stringify(old),
      draft = createDraft(old),
      next = buildMigration(draft, 200)
    expect(next.content).toBe('A simple app')
    expect(next.tags).toContainEqual(['x', hash])
    expect(next.tags).toContainEqual(['O', 'theme'])
    expect(next.tags).toContainEqual(['R', 'relay'])
    expect(next.tags).toContainEqual(['t', 'preserve'])
    expect(
      next.tags.some((t) => ['description', 'path', 'requires'].includes(t[0])),
    ).toBe(false)
    expect(JSON.stringify(old)).toBe(before)
  })
  it('allows overriding theme and required API defaults', () => {
    const d = createDraft(event())
    d.capabilities.forEach((c) => (c.optional = !c.optional))
    expect(buildMigration(d).tags).toEqual(
      expect.arrayContaining([
        ['R', 'theme'],
        ['O', 'relay'],
      ]),
    )
  })
  it('requires nonempty text but treats formatting literally', () => {
    expect(descriptionError(' \n ')).toBeTruthy()
    expect(descriptionError('bad\u0000text')).toBeTruthy()
    expect(
      descriptionError('<b>literal</b> and **not rendered**'),
    ).toBeUndefined()
  })
  it('uses existing content when description is missing', () => {
    const e = event()
    e.tags = e.tags.filter((t) => t[0] !== 'description')
    e.content = 'From content'
    expect(createDraft(e).description).toBe('From content')
    e.content = ''
    expect(migrationIssues(createDraft(e))).toContain(
      'Add a plain-text description before continuing.',
    )
  })
  it('refuses extra files or duplicate paths instead of dropping artifacts', () => {
    for (const p of ['/extra.js', '/index.html', '/favicon.ico']) {
      expect(() =>
        buildMigration(createDraft(event([['path', p, hash]]))),
      ).toThrow('exactly one')
    }
  })
  it('never reuses an aggregate hash without a path', () => {
    const e = event()
    e.tags = e.tags.filter((t) => t[0] !== 'path')
    expect(() => buildMigration(createDraft(e))).toThrow('aggregate hash')
  })
  it('rejects malformed hashes, kinds, cardinality and metadata', () => {
    for (const extra of [
      [['d', 'duplicate']],
      [['source', 'javascript:alert(1)']],
      [['server', 'https://blossom.test/subpath']],
      [['requires', 'NAP-RELAY']],
      [['i', 'napplet:feed/open?foo=1']],
      [
        ['title', 'one'],
        ['title', 'two'],
      ],
    ])
      expect(migrationIssues(createDraft(event(extra))).length).toBeGreaterThan(
        0,
      )
    const e = event()
    e.tags.find((t) => t[0] === 'path')![2] = 'NOT A HASH'
    expect(() => buildMigration(createDraft(e))).toThrow()
  })
  it('preserves icons, archetypes, intents and supported source metadata', () => {
    const extra = [
      ['icon', hash, 'image/png'],
      ['z', 'feed'],
      ['i', 'napplet:feed/edit', 'relays'],
      ['source', 'https://example.com/source'],
    ]
    expect(buildMigration(createDraft(event(extra))).tags).toEqual(
      expect.arrayContaining(extra),
    )
  })
  it('drops invalid optional icons and obsolete C tags', () => {
    const next = buildMigration(
      createDraft(
        event([
          ['icon', hash, 'image/svg+xml'],
          ['C', 'theme'],
        ]),
      ),
    )
    expect(next.tags.some((t) => ['C', 'icon'].includes(t[0]))).toBe(false)
  })
  it('preserves snapshot lineage, rejects it on other kinds', () => {
    const lineage = ['a', `35129:${'c'.repeat(64)}:parent`]
    expect(
      buildMigration(createDraft(event([lineage], 5129))).tags,
    ).toContainEqual(lineage)
    expect(() => buildMigration(createDraft(event([lineage])))).toThrow(
      'Lineage',
    )
  })
  it('supports root manifests and uses a strictly newer timestamp', () => {
    expect(buildMigration(createDraft(event([], 15129)), 50).created_at).toBe(
      101,
    )
  })
  it('deduplicates before excluding migrated manifests so old versions cannot resurface', () => {
    const old = event(),
      next = finalizeEvent(buildMigration(createDraft(old), 200), key)
    expect(latestManifests([old, next, old])).toEqual([])
  })
  it('uses lowest ID for same-timestamp replaceable events', () => {
    const a = event(),
      b = { ...event(), id: '0'.repeat(64) }
    expect(latestManifests([a, b])[0].id).toBe(b.id)
  })
})

it('accepts and preserves Blossom source references and discovery hints', () => {
  for (const source of [
    `blossom:${hash}.zip`,
    `blossom:${hash}.tar.gz?xs=blossom.example&xs=https%3A%2F%2Fbackup.example&as=${'b'.repeat(64)}&sz=1024`,
    `blossom:${hash}.bin`,
    `blossom:${hash}`,
    `blossom://${hash}`,
    `blossom://${hash}.zip?xs=blossom.example`,
  ]) {
    const draft = createDraft(event([['source', source]]))
    expect(migrationIssues(draft)).toEqual([])
    expect(buildMigration(draft).tags).toContainEqual(['source', source])
  }
})
it('rejects malformed Blossom source hashes and unsupported source schemes', () => {
  for (const source of [
    'blossom:',
    'blossom:not-a-hash.zip',
    `blossom:${'A'.repeat(64)}.zip`,
    `blossom:${hash}/index.html`,
    `blossom:${hash}.zip?xs=bad host`,
    'javascript:alert(1)',
    'data:text/html,hello',
  ]) {
    expect(() =>
      buildMigration(createDraft(event([['source', source]]))),
    ).toThrow('Source must be')
  }
})

it('migrates the real Supersonic RC Revive manifest without rejecting its Nostr source', () => {
  expect(verifyEvent(supersonic)).toBe(true)
  const draft = createDraft(supersonic)
  expect(migrationDiagnostics(draft)).toEqual([])
  const migrated = buildMigration(draft)
  for (const name of ['source', 'source-archive', 'source-commit']) {
    expect(migrated.tags).toContainEqual(
      supersonic.tags.find((t) => t[0] === name),
    )
  }
})
it('accepts NIP-34 clone URLs and git transport URLs without rewriting them', () => {
  const npub = nip19.npubEncode('b'.repeat(64)),
    naddr = nip19.naddrEncode({
      kind: 30617,
      pubkey: 'b'.repeat(64),
      identifier: 'repo',
    })
  for (const value of [
    `nostr://${npub}/repo`,
    `nostr://${npub}/wss%3A%2F%2Frelay.example%2F/my%20repo`,
    `nostr://${naddr}`,
    'nostr://alice@example.com/relay.example/repo',
    'nostr://example.com/repo',
    'git://git.example/repository.git',
    'git://git.example:9418/repository.git',
  ]) {
    expect(
      buildMigration(createDraft(event([['source', value]]))).tags,
    ).toContainEqual(['source', value])
  }
})
it('rejects malformed repository URLs with the exact source tag and index', () => {
  for (const value of [
    'git://',
    'git://bad host/repo',
    'nostr://npub1invalid/repo',
    'nostr://example.com',
    'nostr://example.com/%broken',
    'nostr://example.com/one/two/three',
  ]) {
    const original = event([['source', value]])
    const diagnostics = migrationDiagnostics(createDraft(original))
    expect(diagnostics).toEqual([
      {
        message: expect.stringContaining('Source must be'),
        entries: [
          {
            path: `tags[${original.tags.length - 1}]`,
            value: ['source', value],
          },
        ],
      },
    ])
  }
})
it('attaches tag indexes and values to structural validation failures', () => {
  const original = event([
    ['server', 'https://example.com/not-an-origin'],
    ['d', 'duplicate'],
  ])
  const diagnostics = migrationDiagnostics(createDraft(original))
  expect(
    diagnostics.find((i) => i.message.startsWith('Blossom server'))?.entries,
  ).toEqual([
    {
      path: `tags[${original.tags.length - 2}]`,
      value: ['server', 'https://example.com/not-an-origin'],
    },
  ])
  expect(
    diagnostics.find((i) => i.message.startsWith('The identifier'))?.entries,
  ).toEqual([
    { path: 'tags[0]', value: ['d', 'test'] },
    { path: `tags[${original.tags.length - 1}]`, value: ['d', 'duplicate'] },
  ])
})
