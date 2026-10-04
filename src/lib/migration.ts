import type { EventTemplate, NostrEvent } from 'nostr-tools'
import { decode } from 'nostr-tools/nip19'
import { NIP05_REGEX } from 'nostr-tools/nip05'
export const SPEC_REVISION = '4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51'
export const KINDS = [5129, 15129, 35129]
const HASH = /^[0-9a-f]{64}$/
export type Draft = {
  original: NostrEvent
  description: string
  capabilities: { name: string; optional: boolean }[]
}
export const tags = (event: Pick<NostrEvent, 'tags'>, name: string) =>
  event.tags.filter((t) => t[0] === name)
export const title = (event: NostrEvent) =>
  tags(event, 'title')[0]?.[1] ||
  tags(event, 'd')[0]?.[1] ||
  (event.kind === 15129 ? 'Root napplet' : 'Untitled snapshot')
export const isLegacy = (event: NostrEvent) =>
  event.tags.some(
    (t) =>
      ['path', 'requires', 'description'].includes(t[0]) ||
      (t[0] === 'x' && t[2] === 'aggregate'),
  )
export function createDraft(original: NostrEvent): Draft {
  const required = [...tags(original, 'requires'), ...tags(original, 'R')].map(
    (t) => t[1] ?? '',
  )
  const optional = tags(original, 'O').map((t) => t[1] ?? '')
  return {
    original,
    description:
      tags(original, 'description')[0]?.[1] || original.content || '',
    capabilities: [...new Set([...required, ...optional])].map((name) => ({
      name,
      optional:
        name === 'theme' ||
        (!required.includes(name) && optional.includes(name)),
    })),
  }
}
export function descriptionError(value: string): string | undefined {
  if (!value.trim()) return 'Add a plain-text description before continuing.'
  // The proposal requires plain text, not a ban on punctuation or Markdown-looking text.
  // All input is kept literally and rendered through escaped text interpolation.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value))
    return 'Remove non-text control characters from the description.'
}
function httpUrl(value: string, originOnly = false): boolean {
  try {
    const u = new URL(value)
    return (
      ['http:', 'https:'].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      (!originOnly || (u.pathname === '/' && !u.search && !u.hash))
    )
  } catch {
    return false
  }
}
function sourceReference(value: string): boolean {
  // Preserve BUD-10 references and legacy hash-only / blossom:// spellings.
  // Discovery hints are metadata here; migration never resolves or rewrites them.
  return (
    httpUrl(value) ||
    gitRepository(value) ||
    nostrRepository(value) ||
    /^blossom:(?:\/\/)?[0-9a-f]{64}(?:\.[a-zA-Z0-9][a-zA-Z0-9._-]*)?(?:\?[^\s#]*)?$/.test(
      value,
    )
  )
}
function gitRepository(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'git:' &&
      !!url.hostname &&
      !url.username &&
      !url.password &&
      !/[\s]/.test(value)
    )
  } catch {
    return false
  }
}
function nostrRepository(value: string): boolean {
  if (!value.startsWith('nostr://') || /[\s?#]/.test(value)) return false
  const [identity, ...path] = value.slice('nostr://'.length).split('/')
  try {
    const address = decode(identity)
    if (address.type === 'naddr')
      return path.length === 0 && address.data.kind === 30617
    if (address.type !== 'npub') return false
  } catch {
    if (!NIP05_REGEX.test(identity)) return false
  }
  try {
    if (path.length < 1 || path.length > 2 || !decodeURIComponent(path.at(-1)!))
      return false
    if (path.length === 2) {
      const hint = decodeURIComponent(path[0])
      const relay = new URL(/^wss?:\/\//.test(hint) ? hint : `wss://${hint}`)
      if (
        !hint ||
        !['ws:', 'wss:'].includes(relay.protocol) ||
        !relay.hostname ||
        relay.username ||
        relay.password
      )
        return false
    }
    return true
  } catch {
    return false
  }
}
export type ValidationIssue = {
  message: string
  entries: { path: string; value: unknown }[]
}
export function migrationDiagnostics(draft: Draft): ValidationIssue[] {
  const e = draft.original,
    errors: ValidationIssue[] = []
  const entriesFor = (...names: string[]) =>
    e.tags.flatMap((tag, index) =>
      names.includes(tag[0]) ? [{ path: `tags[${index}]`, value: tag }] : [],
    )
  const report = (message: string, ...names: string[]) =>
    errors.push({
      message,
      entries: entriesFor(...names),
    })
  if (!KINDS.includes(e.kind))
    errors.push({
      message: 'This is not a napplet manifest kind.',
      entries: [{ path: 'kind', value: e.kind }],
    })
  const ds = tags(e, 'd')
  if (e.kind === 35129 ? ds.length !== 1 || ds[0].length !== 2 : ds.length > 0)
    report('The identifier tags do not match this event kind.', 'd')
  const paths = tags(e, 'path')
  if (
    paths.length &&
    (paths.length !== 1 ||
      paths[0][1] !== '/index.html' ||
      paths[0].length !== 3 ||
      !HASH.test(paths[0][2]))
  )
    report(
      'Automatic migration requires exactly one /index.html path with a valid SHA-256. Rebundle extra files into a self-contained artifact first.',
      'path',
    )
  if (
    !paths.length &&
    (tags(e, 'x').length !== 1 ||
      tags(e, 'x')[0].length !== 2 ||
      !HASH.test(tags(e, 'x')[0][1]))
  )
    report(
      'No unambiguous artifact hash was found. An aggregate hash cannot be reused as an artifact hash.',
      'x',
      'path',
    )
  for (const name of ['title', 'source', 'description', 'icon', 'a', 'A'])
    if (tags(e, name).length > 1)
      report(`Multiple ${name} tags need manual resolution.`, name)
  for (const t of tags(e, 'source'))
    if (t.length !== 2 || !sourceReference(t[1]))
      report(
        'Source must be an HTTP(S) URL, a Blossom reference, or a Git repository URL (nostr:// or git://).',
        'source',
      )
  for (const t of tags(e, 'server'))
    if (t.length !== 2 || !httpUrl(t[1], true))
      report(
        'Blossom server hints must be HTTP or HTTPS origins without paths.',
        'server',
      )
  for (const t of [...tags(e, 'a'), ...tags(e, 'A')])
    if (
      e.kind !== 5129 ||
      t.length !== 2 ||
      !/^35129:[0-9a-f]{64}:.*$/.test(t[1])
    )
      report(
        'Lineage is only supported on snapshots with valid named napplet addresses.',
        t[0],
      )
  for (const t of tags(e, 'i'))
    if (
      !t[1] ||
      /[?#\s]/.test(t[1]) ||
      t.slice(2).some((p) => !p || /[?&#=\s]/.test(p))
    )
      report(
        'Intent identities must be queryless and parameter names must be non-empty.',
        'i',
      )
  for (const t of tags(e, 'z'))
    if (t.length !== 2 || !t[1]?.trim())
      report('Archetype tags must name an archetype.', 'z')
  for (const t of tags(e, 'title'))
    if (t.length !== 2)
      report('Title tags must contain one display label.', 'title')
  if (
    draft.capabilities.some(
      (c) =>
        !c.name ||
        !/^[a-z][a-z0-9-]*$/.test(c.name) ||
        c.name.startsWith('NAP-'),
    )
  )
    report(
      'Capabilities must be bare NAP domains, such as relay or theme.',
      'requires',
      'R',
      'O',
    )
  const descError = descriptionError(draft.description)
  if (descError)
    errors.push({
      message: descError,
      entries: [{ path: 'description (prepared)', value: draft.description }],
    })
  return errors
}
export function migrationIssues(draft: Draft): string[] {
  return migrationDiagnostics(draft).map((issue) => issue.message)
}
export function validIcon(t: string[]) {
  return (
    t.length === 3 &&
    HASH.test(t[1]) &&
    ['image/png', 'image/jpeg', 'image/webp'].includes(t[2])
  )
}
export function migrationNotes(
  draft: Draft,
  publisher = draft.original.pubkey,
): string[] {
  const e = draft.original,
    notes = [
      'Description is stored as plain text in event content.',
      'Required APIs become R tags; optional APIs become O tags.',
    ]
  if (tags(e, 'path').length)
    notes.push(
      'The /index.html file hash replaces the aggregate x hash. The HTML artifact is unchanged.',
    )
  if (tags(e, 'icon').some((t) => !validIcon(t)))
    notes.push(
      'An invalid or unsupported icon is removed; clients will show generic artwork.',
    )
  if (tags(e, 'C').length)
    notes.push(
      'Obsolete C capability tags are removed. Review the API choices carefully.',
    )
  if (e.pubkey !== publisher) {
    notes.push(
      'Publishes a copy under your account. The original author’s event remains unchanged.',
    )
    if (e.kind === 35129)
      notes.push(
        'Keeps the same identifier. This replaces any napplet you already have at that identifier.',
      )
    if (e.kind === 15129)
      notes.push(
        'This becomes your root napplet, replacing your existing root manifest if you have one.',
      )
  } else if (e.kind === 5129)
    notes.push(
      'This creates a new snapshot. The original snapshot remains available.',
    )
  else
    notes.push('This replaces the current manifest at the same Nostr address.')
  return notes
}
export function buildMigration(
  draft: Draft,
  now = Math.floor(Date.now() / 1000),
): EventTemplate {
  const errors = migrationIssues(draft)
  if (errors.length) throw new Error(errors.join(' '))
  const e = draft.original,
    path = tags(e, 'path')[0]
  const keep = e.tags.filter(
    (t) =>
      !['path', 'x', 'requires', 'R', 'O', 'description', 'C'].includes(t[0]) &&
      (t[0] !== 'icon' || validIcon(t)),
  )
  return {
    kind: e.kind,
    created_at: Math.max(now, e.created_at + 1),
    content: draft.description.trim(),
    tags: [
      ...keep.map((t) => [...t]),
      ['x', path?.[2] ?? tags(e, 'x')[0][1]],
      ...draft.capabilities.map((c) => [c.optional ? 'O' : 'R', c.name]),
    ],
  }
}
export function latestManifests(events: NostrEvent[]): NostrEvent[] {
  const map = new Map<string, NostrEvent>()
  for (const e of events) {
    const key =
      e.kind === 5129
        ? e.id
        : `${e.kind}:${e.pubkey}:${e.kind === 35129 ? (tags(e, 'd')[0]?.[1] ?? '') : ''}`
    const previous = map.get(key)
    if (
      !previous ||
      e.created_at > previous.created_at ||
      (e.created_at === previous.created_at && e.id < previous.id)
    )
      map.set(key, e)
  }
  return [...map.values()]
    .filter(isLegacy)
    .sort((a, b) => b.created_at - a.created_at)
}
