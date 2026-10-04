import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import {
  createDraft,
  buildMigration,
  migrationIssues,
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
