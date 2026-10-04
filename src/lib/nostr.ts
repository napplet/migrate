import {
  SimplePool,
  generateSecretKey,
  getPublicKey,
  nip19,
  matchFilter,
  verifyEvent,
  type NostrEvent,
  type EventTemplate,
  type Filter,
} from 'nostr-tools'
import {
  BunkerSigner,
  createNostrConnectURI,
  parseBunkerInput,
} from 'nostr-tools/nip46'
import { buildMigration, KINDS, latestManifests, type Draft } from './migration'
export const DEFAULT_CONNECTION_RELAY = 'wss://bucket.coracle.social'
// Used only to locate NIP-65 metadata, or as a fallback when none is available.
export const BOOTSTRAP_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
]
export interface Signer {
  getPublicKey(): Promise<string>
  signEvent(event: EventTemplate): Promise<NostrEvent>
}
export type Session = { pubkey: string; signer: Signer; close: () => void }
declare global {
  interface Window {
    nostr?: Signer
  }
}
export function relayUrls(input: string): string[] {
  const urls = [
    ...new Set(
      input
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((v) => {
          let u: URL
          try {
            u = new URL(v)
          } catch {
            throw new Error('Enter a valid wss:// relay URL.')
          }
          if (
            u.protocol !== 'wss:' ||
            !u.hostname ||
            u.username ||
            u.password ||
            u.hash
          )
            throw new Error(
              'Relays must use wss:// without credentials or fragments.',
            )
          return u.toString().replace(/\/$/, '')
        }),
    ),
  ]
  if (!urls.length) throw new Error('Add at least one relay.')
  return urls
}
export async function deadline<T>(promise: Promise<T>, ms = 60000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Request timed out. Please try again.')),
          ms,
        )
      }),
    ])
  } finally {
    clearTimeout(timer!)
  }
}
async function session(signer: Signer, close = () => {}): Promise<Session> {
  try {
    const pubkey = await deadline(signer.getPublicKey())
    if (!/^[0-9a-f]{64}$/.test(pubkey))
      throw new Error('Signer returned an invalid public key.')
    return { pubkey, signer, close }
  } catch (e) {
    close()
    throw e
  }
}
export async function extensionLogin(): Promise<Session> {
  if (!window.nostr)
    throw new Error(
      'No NIP-07 extension found. Install a Nostr signer or use a remote signer.',
    )
  return session(window.nostr)
}
const permissions = ['sign_event:5129', 'sign_event:15129', 'sign_event:35129']
export function remoteLogin(
  relay: string,
  bunker: string,
  onauth: (url: string) => void,
) {
  const relays = relayUrls(relay),
    key = generateSecretKey(),
    pool = new SimplePool(),
    abort = new AbortController()
  let signer: BunkerSigner | undefined,
    closed = false
  const close = () => {
    if (closed) return
    closed = true
    abort.abort()
    void signer?.close()
    // nostr-tools queues CLOSE frames in a promise continuation. Flush those before closing sockets.
    setTimeout(() => pool.destroy(), 0)
    key.fill(0)
  }
  const params = {
    pool,
    skipSwitchRelays: true,
    onauth: (url: string) => {
      try {
        if (new URL(url).protocol === 'https:') onauth(url)
      } catch {
        /* ignore invalid links */
      }
    },
  }
  const uri = createNostrConnectURI({
    clientPubkey: getPublicKey(key),
    relays,
    secret: crypto.randomUUID(),
    perms: permissions,
    name: 'Napplet Migrate',
  })
  const ready = (async () => {
    try {
      if (bunker) {
        if (!bunker.startsWith('bunker://'))
          throw new Error('Enter a bunker:// URI from your signer.')
        const pointer = await parseBunkerInput(bunker.trim())
        if (!pointer) throw new Error('Invalid bunker URI.')
        if (closed) throw new Error('Connection cancelled.')
        // The visible relay field is authoritative, including for bunker connections.
        signer = BunkerSigner.fromBunker(key, { ...pointer, relays }, params)
        await deadline(signer.connect({ name: 'Napplet Migrate' }))
      } else signer = await BunkerSigner.fromURI(key, uri, params, abort.signal)
      if (closed) {
        void signer.close()
        throw new Error('Connection cancelled.')
      }
      return await session(signer, close)
    } catch (e) {
      close()
      throw e
    }
  })()
  return { uri, ready, close }
}
export function parseAddress(value: string) {
  let decoded: ReturnType<typeof nip19.decode>
  try {
    decoded = nip19.decode(value.trim().replace(/^nostr:/, ''))
  } catch {
    throw new Error('Enter a valid naddr address.')
  }
  if (decoded.type !== 'naddr' || ![15129, 35129].includes(decoded.data.kind))
    throw new Error('Use an naddr for a named or root napplet.')
  return decoded.data
}
export class NappletRepository {
  pool = new SimplePool()
  close() {
    this.pool.destroy()
  }
  async resolveRelays(pubkey: string): Promise<{
    relays: string[]
    source: 'nip65' | 'missing' | 'unavailable'
  }> {
    let events: NostrEvent[]
    try {
      events = await this.pool.querySync(
        BOOTSTRAP_RELAYS,
        { kinds: [10002], authors: [pubkey] },
        { maxWait: 6000 },
      )
    } catch {
      return { relays: [...BOOTSTRAP_RELAYS], source: 'unavailable' }
    }
    const latest = events
      .filter(
        (e) =>
          e.kind === 10002 &&
          e.pubkey === pubkey &&
          verifyEvent(structuredClone(e)),
      )
      .sort(
        (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
      )[0]
    if (!latest) return { relays: [...BOOTSTRAP_RELAYS], source: 'missing' }
    const relays = new Set<string>()
    for (const tag of latest.tags) {
      if (
        tag[0] !== 'r' ||
        (tag.length !== 2 && !(tag.length === 3 && tag[2] === 'write'))
      )
        continue
      try {
        // Each r tag must contain a single URL, not a list of URLs.
        if (/\s|,/.test(tag[1])) continue
        for (const relay of relayUrls(tag[1])) relays.add(relay)
      } catch {
        /* Ignore malformed or insecure relay hints. */
      }
    }
    // An explicitly empty/read-only list must not resurrect an older list.
    return { relays: [...relays], source: 'nip65' }
  }
  async load(
    pubkey: string,
    relays: string[],
    address?: string,
  ): Promise<NostrEvent[]> {
    let filter: Filter = { kinds: KINDS, authors: [pubkey] },
      hints: string[] = []
    if (address) {
      const a = parseAddress(address)
      filter = {
        kinds: [a.kind],
        authors: [a.pubkey],
        ...(a.kind === 35129 ? { '#d': [a.identifier] } : {}),
      }
      hints = (a.relays ?? []).filter((r) => {
        try {
          relayUrls(r)
          return true
        } catch {
          return false
        }
      })
      if (a.pubkey !== pubkey) {
        const authorRelays = await this.resolveRelays(a.pubkey)
        hints.push(...authorRelays.relays)
      }
    }
    const events = await this.pool.querySync(
      [...new Set([...relays, ...hints])],
      filter,
      { maxWait: 10000 },
    )
    const valid = events.filter((e) => matchFilter(filter, e) && verifyEvent(e))
    return latestManifests(valid)
  }
  async publish(
    event: NostrEvent,
    relays: string[],
  ): Promise<{ accepted: string[]; failed: string[] }> {
    const results = await Promise.allSettled(
      this.pool.publish(relays, event, { maxWait: 12000 }),
    )
    const accepted = relays.filter((_, i) => results[i].status === 'fulfilled'),
      failed = relays.filter((_, i) => results[i].status === 'rejected')
    if (!accepted.length)
      throw new Error(
        'No relay accepted this event. Your signed event is kept for retry.',
      )
    return { accepted, failed }
  }
}
export async function signMigration(
  draft: Draft,
  session: Session,
): Promise<NostrEvent> {
  const template = buildMigration(draft)
  // Retain our own copy: injected signers can mutate their argument.
  const expected = JSON.stringify(template)
  // Clone removes library verification-cache symbols and signer-owned references.
  const signed = structuredClone(
    await deadline(session.signer.signEvent(structuredClone(template))),
  )
  const actual = JSON.stringify({
    kind: signed.kind,
    created_at: signed.created_at,
    content: signed.content,
    tags: signed.tags,
  })
  if (
    actual !== expected ||
    signed.pubkey !== session.pubkey ||
    !verifyEvent(signed)
  )
    throw new Error(
      'The signer returned a changed or invalid event. Nothing was published.',
    )
  return signed
}
