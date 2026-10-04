import { describe, it, expect, vi } from 'vitest'
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
} from 'nostr-tools'
import {
  relayUrls,
  parseAddress,
  signMigration,
  deadline,
  NappletRepository,
} from './nostr'
import { createDraft } from './migration'
import { MigrationBatch } from './batch'
const key = generateSecretKey(),
  pubkey = getPublicKey(key)
const original = finalizeEvent(
  {
    kind: 35129,
    created_at: 10,
    content: '',
    tags: [
      ['d', 'test'],
      ['path', '/index.html', 'a'.repeat(64)],
      ['description', 'Test app'],
    ],
  },
  key,
)
const session = {
  pubkey,
  signer: {
    getPublicKey: async () => pubkey,
    signEvent: vi.fn(async (e) => finalizeEvent(e, key)),
  },
  close: () => {},
}
describe('Nostr boundaries', () => {
  it('validates relay URLs and deduplicates', () => {
    expect(relayUrls('wss://relay.test/\nwss://relay.test')).toEqual([
      'wss://relay.test',
    ])
    for (const value of [
      '',
      'https://relay.test',
      'wss://user:pass@relay.test',
      'wss://relay.test/#x',
    ])
      expect(() => relayUrls(value)).toThrow()
  })
  it('accepts naddrs independently of the connected account and rejects invalid addresses', () => {
    const a = nip19.naddrEncode({ kind: 35129, pubkey, identifier: 'test' })
    expect(parseAddress(a).identifier).toBe('test')
    expect(
      parseAddress(
        nip19.naddrEncode({
          kind: 35129,
          pubkey: 'b'.repeat(64),
          identifier: 'someone-elses',
        }),
      ).pubkey,
    ).toBe('b'.repeat(64))
    expect(() => parseAddress('npub1bad')).toThrow()
  })
  it('checks signer author, signature and exact template', async () => {
    await expect(
      signMigration(createDraft(original), session),
    ).resolves.toMatchObject({ pubkey, kind: 35129 })
    await expect(
      signMigration(createDraft(original), {
        ...session,
        pubkey: 'c'.repeat(64),
      }),
    ).rejects.toThrow('changed or invalid')
    await expect(
      signMigration(createDraft(original), {
        ...session,
        signer: {
          ...session.signer,
          signEvent: async (e) =>
            finalizeEvent({ ...e, content: 'changed' }, key),
        },
      }),
    ).rejects.toThrow('changed or invalid')
  })
  it('does not trust a mutated signer argument', async () => {
    await expect(
      signMigration(createDraft(original), {
        ...session,
        signer: {
          ...session.signer,
          signEvent: async (e) => {
            e.tags.push(['evil', 'yes'])
            return finalizeEvent(e, key)
          },
        },
      }),
    ).rejects.toThrow('changed or invalid')
  })
  it('times out unavailable signers', async () => {
    await expect(deadline(new Promise(() => {}), 5)).rejects.toThrow(
      'timed out',
    )
  })
  it('requires a positive relay acknowledgement and reports partial failures', async () => {
    const repo = new NappletRepository()
    vi.spyOn(repo.pool, 'publish').mockReturnValue([
      Promise.resolve('ok'),
      Promise.reject('no'),
    ])
    await expect(
      repo.publish(original, ['wss://one', 'wss://two']),
    ).resolves.toEqual({ accepted: ['wss://one'], failed: ['wss://two'] })
    vi.spyOn(repo.pool, 'publish').mockReturnValue([Promise.reject('no')])
    await expect(repo.publish(original, ['wss://one'])).rejects.toThrow(
      'No relay accepted',
    )
    repo.close()
  })
  it('retries publication with the same signed event and skips successes', async () => {
    session.signer.signEvent.mockClear()
    const batch = new MigrationBatch([createDraft(original)]),
      publish = vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue({ accepted: ['wss://one'], failed: [] })
    await batch.run(session, { publish }, ['wss://one'], () => {})
    const signed = batch.outcomes[0].event
    await batch.run(session, { publish }, ['wss://one'], () => {})
    expect(session.signer.signEvent).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[1][0]).toEqual(signed)
    await batch.run(session, { publish }, ['wss://one'], () => {})
    expect(publish).toHaveBeenCalledTimes(2)
  })
  it('does not publish when cancelled during signing', async () => {
    const batch = new MigrationBatch([createDraft(original)]),
      publish = vi.fn()
    const signer = {
      ...session.signer,
      signEvent: async (e: any) => {
        batch.cancel()
        return finalizeEvent(e, key)
      },
    }
    await batch.run(
      { ...session, signer },
      { publish },
      ['wss://one'],
      () => {},
    )
    expect(publish).not.toHaveBeenCalled()
  })
})

it('rechecks cryptographic signatures even when a signer returns a cached verification symbol', async () => {
  const signer = {
    ...session.signer,
    signEvent: async (event: any) => {
      const signed = finalizeEvent(event, key)
      signed.sig = '0'.repeat(128)
      return signed
    },
  }
  await expect(
    signMigration(createDraft(original), { ...session, signer }),
  ).rejects.toThrow('changed or invalid')
})

describe('NIP-65 relay selection', () => {
  const list = (tags: string[][], created_at = 100, author = key) =>
    finalizeEvent({ kind: 10002, created_at, content: '', tags }, author)
  it('uses the latest verified author list and includes only write and unmarked relays', async () => {
    const repo = new NappletRepository()
    const invalid = {
      ...list([['r', 'wss://invalid.test']], 400),
      sig: '0'.repeat(128),
    }
    const query = vi.spyOn(repo.pool, 'querySync').mockResolvedValue([
      list([['r', 'wss://old.test']], 50),
      list(
        [
          ['r', 'wss://both.test/'],
          ['r', 'wss://both.test'],
          ['r', 'wss://write.test', 'write'],
          ['r', 'wss://read.test', 'read'],
          ['r', 'https://bad.test'],
          ['r', 'wss://one.test wss://two.test'],
          ['r', 'wss://unknown.test', 'unknown'],
        ],
        100,
      ),
      list([['r', 'wss://stranger.test']], 300, generateSecretKey()),
      invalid,
    ])
    await expect(repo.resolveRelays(pubkey)).resolves.toEqual({
      source: 'nip65',
      relays: ['wss://both.test', 'wss://write.test'],
    })
    expect(query).toHaveBeenCalledWith(
      expect.any(Array),
      { kinds: [10002], authors: [pubkey] },
      { maxWait: 6000 },
    )
    repo.close()
  })
  it('falls back for missing or unavailable metadata', async () => {
    const repo = new NappletRepository(),
      query = vi.spyOn(repo.pool, 'querySync').mockResolvedValue([])
    expect(await repo.resolveRelays(pubkey)).toMatchObject({
      source: 'missing',
      relays: expect.arrayContaining(['wss://nos.lol']),
    })
    query.mockRejectedValueOnce(new Error('offline'))
    expect(await repo.resolveRelays(pubkey)).toMatchObject({
      source: 'unavailable',
    })
    repo.close()
  })
  it('honors an empty latest list instead of using stale write relays', async () => {
    const repo = new NappletRepository()
    vi.spyOn(repo.pool, 'querySync').mockResolvedValue([
      list([['r', 'wss://old.test']], 50),
      list([['r', 'wss://read.test', 'read']], 100),
    ])
    await expect(repo.resolveRelays(pubkey)).resolves.toEqual({
      source: 'nip65',
      relays: [],
    })
    repo.close()
  })
  it('resolves equal timestamps by the lowest event ID', async () => {
    const repo = new NappletRepository(),
      lists = [
        list([['r', 'wss://a.test']]),
        list([['r', 'wss://b.test']]),
      ].sort((a, b) => a.id.localeCompare(b.id))
    vi.spyOn(repo.pool, 'querySync').mockResolvedValue([...lists].reverse())
    expect((await repo.resolveRelays(pubkey)).relays).toEqual([
      lists[0].tags[0][1],
    ])
    repo.close()
  })
})

it('signs a migrated copy with the connected account rather than the source author', async () => {
  const targetKey = generateSecretKey(),
    targetPubkey = getPublicKey(targetKey)
  const targetSession = {
    pubkey: targetPubkey,
    signer: {
      getPublicKey: async () => targetPubkey,
      signEvent: async (event: any) => finalizeEvent(event, targetKey),
    },
    close: () => {},
  }
  const migrated = await signMigration(createDraft(original), targetSession)
  expect(migrated.pubkey).toBe(targetPubkey)
  expect(migrated.pubkey).not.toBe(original.pubkey)
  expect(migrated.tags).toContainEqual(['d', 'test'])
})
