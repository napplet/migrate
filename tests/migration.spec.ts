import { test, expect, type Page } from '@playwright/test'
import supersonic from './fixtures/supersonic-rc-revive.json' with { type: 'json' }
import type { NostrEvent } from 'nostr-tools'
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
} from 'nostr-tools'
const key = generateSecretKey(),
  pubkey = getPublicKey(key)
const fixtures = ['Tiny feed', 'Theme studio'].map((name, i) =>
  finalizeEvent(
    {
      kind: 35129,
      created_at: 100 + i,
      content: '',
      tags: [
        ['d', `app-${i}`],
        ['title', name],
        ['path', '/index.html', 'a'.repeat(64)],
        ['x', 'b'.repeat(64), 'aggregate'],
        ['requires', 'relay'],
        ['requires', 'theme'],
        ...(i === 0 ? [['description', 'A small feed reader']] : []),
      ],
    },
    key,
  ),
)
const foreignKey = generateSecretKey(),
  foreignPubkey = getPublicKey(foreignKey)
const foreignManifest = finalizeEvent(
  {
    ...fixtures[0],
    created_at: 100,
    tags: [
      ...fixtures[0].tags,
      ['source', `blossom:${'c'.repeat(64)}.zip?xs=source.example`],
    ],
  },
  foreignKey,
)
const foreignRelayList = finalizeEvent(
  {
    kind: 10002,
    created_at: 200,
    content: '',
    tags: [['r', 'wss://source-author.example', 'write']],
  },
  foreignKey,
)
const relayList = finalizeEvent(
  {
    kind: 10002,
    created_at: 200,
    content: '',
    tags: [
      ['r', 'wss://outbox.example', 'write'],
      ['r', 'wss://both.example'],
      ['r', 'wss://inbox.example', 'read'],
    ],
  },
  key,
)
async function setup(
  page: Page,
  accept = () => true,
  metadata: typeof relayList | null = relayList,
  traffic: { reads: string[]; writes: string[] } = { reads: [], writes: [] },
  extraEvents: NostrEvent[] = [],
) {
  const published: any[] = []
  await page.exposeFunction('testSign', async (event: any) =>
    finalizeEvent(event, key),
  )
  await page.addInitScript(
    ({ pubkey }) => {
      ;(window as any).nostr = {
        getPublicKey: async () => pubkey,
        signEvent: (e: any) => (window as any).testSign(e),
      }
    },
    { pubkey },
  )
  await page.routeWebSocket(/wss:\/\//, (ws) => {
    ws.onMessage((message) => {
      const [type, id, filter] = JSON.parse(String(message))
      if (type === 'REQ') {
        if (filter.kinds.includes(10002)) {
          const list = filter.authors.includes(foreignPubkey)
            ? foreignRelayList
            : metadata
          if (list) ws.send(JSON.stringify(['EVENT', id, list]))
          ws.send(JSON.stringify(['EOSE', id]))
          return
        }
        traffic.reads.push(ws.url())
        for (const e of [...fixtures, foreignManifest, ...extraEvents].filter(
          (e) =>
            filter.authors.includes(e.pubkey) &&
            (!filter['#d'] ||
              filter['#d'].includes(e.tags.find((t) => t[0] === 'd')?.[1])) &&
            (e.pubkey !== foreignPubkey ||
              ws.url() === 'wss://source-author.example/'),
        ))
          ws.send(JSON.stringify(['EVENT', id, e]))
        ws.send(JSON.stringify(['EOSE', id]))
      }
      if (type === 'EVENT') {
        published.push(id)
        traffic.writes.push(ws.url())
        ws.send(JSON.stringify(['OK', id.id, accept(), 'relay response']))
      }
    })
  })
  await page.goto('/')
  return published
}
test('extension → batch preparation → review → publish → logout', async ({
  page,
}, testInfo) => {
  const traffic = { reads: [] as string[], writes: [] as string[] }
  const published = await setup(page, () => true, relayList, traffic)
  await page.screenshot({
    path: testInfo.outputPath('auth.png'),
    fullPage: true,
  })
  await expect(
    page.getByRole('heading', { name: 'A little move. A fresh start.' }),
  ).toBeVisible()
  await expect(page.getByText('My napplets', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Connect extension' }).click()
  await page.getByRole('button', { name: 'Load my napplets' }).click()
  await expect(page.getByText('2 napplets found')).toBeVisible()
  await page.getByRole('button', { name: 'Begin Migration' }).click()
  await expect(page.getByText('NAPPLET 1 OF 2')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Next napplet' }),
  ).toBeDisabled()
  await page.getByLabel('Description REQUIRED').fill('A little theme studio')
  const theme = page
    .locator('.capability')
    .filter({ has: page.getByText('theme', { exact: true }) })
  await expect(theme.getByRole('button', { name: 'Optional' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await theme.getByRole('button', { name: 'Required', exact: true }).click()
  await page.getByRole('button', { name: 'Next napplet' }).click()
  await expect(page.getByLabel('Description REQUIRED')).toHaveValue(
    'A small feed reader',
  )
  await page.screenshot({
    path: testInfo.outputPath('prepare.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Review changes' }).click()
  await expect(
    page.getByRole('heading', { name: 'Ready for the move.' }),
  ).toBeVisible()
  await page.getByText('Theme studio', { exact: true }).click()
  await expect(page.getByText('theme · required')).toBeVisible()
  await page.getByRole('button', { name: 'Migrate 2 napplets' }).click()
  await expect(
    page.getByRole('heading', { name: 'All moved in.' }),
  ).toBeVisible()
  expect(new Set(published.map((e) => e.id)).size).toBe(2)
  expect([...new Set(traffic.reads)].sort()).toEqual([
    'wss://both.example/',
    'wss://outbox.example/',
  ])
  expect([...new Set(traffic.writes)].sort()).toEqual([
    'wss://both.example/',
    'wss://outbox.example/',
  ])
  expect(
    published.every((e) =>
      e.tags.some(
        (t: string[]) =>
          t[0] === 'x' && t[1] === 'a'.repeat(64) && t.length === 2,
      ),
    ),
  ).toBe(true)
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(
    page.getByRole('button', { name: 'Connect extension' }),
  ).toBeVisible()
})
test('loads one owned naddr', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: 'Connect extension' }).click()
  await page.getByRole('button', { name: 'Specific napplet' }).click()
  await page
    .getByLabel('Napplet address')
    .fill(nip19.naddrEncode({ pubkey, kind: 35129, identifier: 'app-0' }))
  await page.getByRole('button', { name: 'Load napplet' }).click()
  await expect(page.getByText('1 napplet found')).toBeVisible()
})
test('migrates another author’s napplet to the connected account and its relays', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const traffic = { reads: [] as string[], writes: [] as string[] }
  const published = await setup(page, () => true, relayList, traffic)
  await page.getByRole('button', { name: 'Connect extension' }).click()
  await page.getByRole('button', { name: 'Specific napplet' }).click()
  await page.getByLabel('Napplet address').fill(
    nip19.naddrEncode({
      pubkey: foreignPubkey,
      kind: 35129,
      identifier: 'app-0',
    }),
  )
  await page.getByRole('button', { name: 'Load napplet' }).click()
  await expect(page.getByText('1 napplet found')).toBeVisible()
  const sourceAddress = nip19.naddrEncode({
    pubkey: foreignPubkey,
    kind: 35129,
    identifier: 'app-0',
  })
  const chip = page.getByRole('button', { name: 'Copy naddr for Tiny feed' })
  await expect(chip).toContainText('naddr1')
  await expect(chip).toContainText('…')
  await chip.click()
  await expect(chip).toContainText('Copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    sourceAddress,
  )
  await expect(page.getByRole('checkbox')).toBeChecked()
  await page.getByRole('button', { name: 'Begin Migration' }).click()
  await page.getByRole('button', { name: 'Copy naddr for Tiny feed' }).focus()
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    sourceAddress,
  )

  await page.getByRole('button', { name: 'Review changes' }).click()
  await expect(
    page.getByText('Publishes a copy under your account.', { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByText(
      'This replaces the current manifest at the same Nostr address.',
    ),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Migrate napplet' }).click()
  await expect(
    page.getByRole('heading', { name: 'All moved in.' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Copy naddr for Tiny feed' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    nip19.naddrEncode({ pubkey, kind: 35129, identifier: 'app-0' }),
  )
  expect(traffic.reads).toContain('wss://source-author.example/')
  expect([...new Set(traffic.writes)].sort()).toEqual([
    'wss://both.example/',
    'wss://outbox.example/',
  ])
  expect(published.length).toBeGreaterThan(0)
  expect(
    published.every((e) => e.pubkey === pubkey && e.pubkey !== foreignPubkey),
  ).toBe(true)
  expect(published[0].tags).toContainEqual(['d', 'app-0'])
  expect(published[0].tags).toContainEqual([
    'source',
    `blossom:${'c'.repeat(64)}.zip?xs=source.example`,
  ])
})
test('QR connection uses custom relay and can be cancelled', async ({
  page,
}) => {
  await page.routeWebSocket(/wss:\/\//, () => {})
  await page.goto('/')
  await page.getByRole('button', { name: 'Connect QR', exact: true }).click()
  await expect(page.getByLabel('Connection relay')).toHaveValue(
    'wss://bucket.coracle.social',
  )
  await page.getByLabel('Connection relay').fill('wss://custom.example')
  await page.getByRole('button', { name: 'Create connection QR' }).click()
  await expect(
    page.getByAltText('NostrConnect QR code for your remote signer'),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Open signer app' }),
  ).toHaveAttribute('href', /relay=wss%3A%2F%2Fcustom.example/)
  await page.getByRole('button', { name: 'Cancel connection' }).click()
  await expect(
    page.getByAltText('NostrConnect QR code for your remote signer'),
  ).toHaveCount(0)
})
test('missing extension and invalid bunker produce useful errors', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Connect extension' }).click()
  await expect(page.getByRole('alert')).toContainText('No NIP-07 extension')
  await page.getByRole('button', { name: 'Bunker URI', exact: true }).click()
  await page.getByLabel('Bunker URI', { exact: true }).fill('invalid')
  await page.getByRole('button', { name: 'Connect bunker' }).click()
  await expect(page.getByRole('alert')).toContainText('bunker://')
})
test('selection can be cleared and mobile view has no horizontal overflow', async ({
  page,
}) => {
  await setup(page)
  await page.getByRole('button', { name: 'Connect extension' }).click()
  await page.getByRole('button', { name: 'Load my napplets' }).click()
  await page.getByRole('button', { name: 'Deselect all' }).click()
  await expect(
    page.getByRole('button', { name: 'Begin Migration' }),
  ).toBeDisabled()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})

test.afterEach(async ({ page }) => {
  expect((await page.pageErrors()).map((e) => e.stack)).toEqual([])
})

test('failed publication stays retryable with the same event', async ({
  page,
}) => {
  let accept = false
  const published = await setup(page, () => accept)
  await page.getByRole('button', { name: 'Connect extension' }).click()
  await page.getByRole('button', { name: 'Specific napplet' }).click()
  await page
    .getByLabel('Napplet address')
    .fill(nip19.naddrEncode({ pubkey, kind: 35129, identifier: 'app-0' }))
  await page.getByRole('button', { name: 'Load napplet' }).click()
  await page.getByRole('button', { name: 'Begin Migration' }).click()
  await page.getByRole('button', { name: 'Review changes' }).click()
  await page.getByRole('button', { name: 'Migrate napplet' }).click()
  await expect(
    page.getByText('No relay accepted this event.', { exact: false }),
  ).toBeVisible()
  accept = true
  await page.getByRole('button', { name: 'Retry failed' }).click()
  await expect(
    page.getByRole('heading', { name: 'All moved in.' }),
  ).toBeVisible()
  expect(new Set(published.map((e) => e.id)).size).toBe(1)
})

test('missing NIP-65 list uses visible, editable fallback relays', async ({
  page,
}) => {
  await setup(page, () => true, null)
  await page.getByRole('button', { name: 'Connect extension' }).click()
  await page.getByText('Discovery & publishing relays', { exact: true }).click()
  await expect(
    page.getByText('No NIP-65 relay list was available.', { exact: false }),
  ).toBeVisible()
  await expect(page.getByLabel('Relay URLs, one per line')).toHaveValue(
    /wss:\/\/nos.lol/,
  )
  await page.getByLabel('Relay URLs, one per line').fill('wss://custom.example')
  await page.getByRole('button', { name: 'Load my napplets' }).click()
  await expect(page.getByText('2 napplets found')).toBeVisible()
})

test('read-only NIP-65 list asks for a write relay instead of using defaults', async ({
  page,
}) => {
  const metadata = finalizeEvent(
    {
      kind: 10002,
      created_at: 200,
      content: '',
      tags: [['r', 'wss://inbox.example', 'read']],
    },
    key,
  )
  await setup(page, () => true, metadata)
  await page.getByRole('button', { name: 'Connect extension' }).click()
  await expect(
    page.getByText('Your NIP-65 list has no usable write relays.', {
      exact: false,
    }),
  ).toBeVisible()
  await expect(page.getByLabel('Relay URLs, one per line')).toHaveValue('')
  await expect(
    page.getByRole('button', { name: 'Load my napplets' }),
  ).toBeDisabled()
  await page.getByLabel('Relay URLs, one per line').fill('wss://outbox.example')
  await page.getByRole('button', { name: 'Load my napplets' }).click()
  await expect(page.getByText('2 napplets found')).toBeVisible()
})

test('the reported Supersonic napplet can be reviewed with its raw signed JSON', async ({
  page,
}) => {
  const published = await setup(page, () => true, relayList, undefined, [
    supersonic,
  ])
  await page.getByRole('button', { name: 'Connect extension' }).click()
  await page.getByRole('button', { name: 'Specific napplet' }).click()
  await page.getByLabel('Napplet address').fill(
    nip19.naddrEncode({
      pubkey: supersonic.pubkey,
      kind: 35129,
      identifier: 'n-143146b0d6f',
    }),
  )
  await page.getByRole('button', { name: 'Load napplet' }).click()
  await page.getByRole('button', { name: 'Begin Migration' }).click()
  await expect(
    page.getByRole('heading', { name: 'Supersonic RC Revive' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Review changes' }),
  ).toBeEnabled()
  await page.getByText('View raw event JSON', { exact: true }).click()
  const raw = page.getByLabel('Original event JSON')
  await expect(raw).toBeVisible()
  expect(JSON.parse((await raw.textContent())!)).toEqual(supersonic)
  await expect(
    page.getByRole('link', { name: 'Download event JSON' }),
  ).toHaveAttribute('download', `napplet-${supersonic.id}.json`)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.getByRole('button', { name: 'Review changes' }).click()
  await page.getByRole('button', { name: 'Migrate napplet' }).click()
  await expect(
    page.getByRole('heading', { name: 'All moved in.' }),
  ).toBeVisible()
  expect(published[0].tags).toContainEqual(
    supersonic.tags.find((t) => t[0] === 'source'),
  )
  expect(published[0].tags).toContainEqual(
    supersonic.tags.find((t) => t[0] === 'source-archive'),
  )
})

test('validation displays the offending tag and index before review', async ({
  page,
}, testInfo) => {
  const bad = finalizeEvent(
    {
      ...fixtures[0],
      created_at: 500,
      tags: [
        ['source', 'invalid://<script>oops</script>'],
        ...fixtures[0].tags,
      ],
    },
    key,
  )
  await setup(page, () => true, relayList, undefined, [bad])
  await page.getByRole('button', { name: 'Connect extension' }).click()
  await page.getByRole('button', { name: 'Specific napplet' }).click()
  await page
    .getByLabel('Napplet address')
    .fill(nip19.naddrEncode({ pubkey, kind: 35129, identifier: 'app-0' }))
  await page.getByRole('button', { name: 'Load napplet' }).click()
  await page.getByRole('button', { name: 'Begin Migration' }).click()
  const issue = page.locator('.validation-issue')
  await expect(issue).toContainText('Source must be')
  await expect(issue).toContainText('tags[0]')
  await expect(issue).toContainText('invalid://<script>oops</script>')
  expect(await issue.locator('script').count()).toBe(0)
  await expect(
    page.getByRole('button', { name: 'Review changes' }),
  ).toBeDisabled()
  await page.getByText('View raw event JSON', { exact: true }).click()
  expect(
    JSON.parse((await page.getByLabel('Original event JSON').textContent())!),
  ).toEqual(JSON.parse(JSON.stringify(bad)))
  await page.screenshot({
    path: testInfo.outputPath('validation-context.png'),
    fullPage: true,
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})

test('address chip offers the full address when clipboard access fails', async ({
  page,
}) => {
  await setup(page)
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      value: async () => {
        throw new Error('Clipboard blocked')
      },
    })
  })
  await page.getByRole('button', { name: 'Connect extension' }).click()
  await page.getByRole('button', { name: 'Load my napplets' }).click()
  const chip = page.getByRole('button', { name: 'Copy naddr for Tiny feed' })
  await chip.click()
  await expect(page.getByLabel('Address to copy')).toHaveValue(
    nip19.naddrEncode({ pubkey, kind: 35129, identifier: 'app-0' }),
  )
  await expect(chip).not.toContainText('Copied')
})
