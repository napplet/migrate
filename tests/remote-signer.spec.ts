import { test, expect, type Page } from '@playwright/test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { encrypt, decrypt, getConversationKey } from 'nostr-tools/nip44'
const bunkerKey = generateSecretKey(),
  bunkerPubkey = getPublicKey(bunkerKey),
  authorKey = generateSecretKey(),
  authorPubkey = getPublicKey(authorKey)
const fixture = finalizeEvent(
  {
    kind: 35129,
    created_at: 100,
    content: '',
    tags: [
      ['d', 'remote'],
      ['title', 'Remote napplet'],
      ['description', 'A remote app'],
      ['path', '/index.html', 'a'.repeat(64)],
      ['requires', 'theme'],
    ],
  },
  authorKey,
)
async function remoteRelay(page: Page) {
  let approval: (() => void) | undefined
  let clientPubkey = '',
    handshakeSecret = '',
    published = 0
  const subscriptions = new Map<
    string,
    { id: string; send: (data: string) => void; filter: any }
  >()
  const sendResponse = (payload: object) => {
    const event = finalizeEvent(
      {
        kind: 24133,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', clientPubkey]],
        content: encrypt(
          JSON.stringify(payload),
          getConversationKey(bunkerKey, clientPubkey),
        ),
      },
      bunkerKey,
    )
    for (const sub of subscriptions.values())
      if (sub.filter.kinds?.includes(24133))
        sub.send(JSON.stringify(['EVENT', sub.id, event]))
  }
  await page.routeWebSocket(/wss:\/\//, (ws) => {
    ws.onMessage((message) => {
      const [type, id, filter] = JSON.parse(String(message))
      if (type === 'REQ') {
        subscriptions.set(`${ws.url()}:${id}`, {
          id,
          send: (data) => ws.send(data),
          filter,
        })
        if (filter.kinds?.includes(24133)) {
          clientPubkey = filter['#p'][0]
          if (handshakeSecret && !filter.authors) {
            sendResponse({ id: 'connect', result: handshakeSecret })
            handshakeSecret = ''
          }
        } else {
          if (!filter.kinds.includes(10002))
            ws.send(JSON.stringify(['EVENT', id, fixture]))
          ws.send(JSON.stringify(['EOSE', id]))
        }
      }
      if (type === 'CLOSE') subscriptions.delete(`${ws.url()}:${id}`)
      if (type === 'EVENT') {
        const event = id
        ws.send(JSON.stringify(['OK', event.id, true, 'stored']))
        if (event.kind !== 24133) {
          published++
          return
        }
        const request = JSON.parse(
          decrypt(event.content, getConversationKey(bunkerKey, event.pubkey)),
        )
        const result =
          request.method === 'connect'
            ? 'ack'
            : request.method === 'get_public_key'
              ? authorPubkey
              : request.method === 'sign_event'
                ? JSON.stringify(
                    finalizeEvent(JSON.parse(request.params[0]), authorKey),
                  )
                : 'pong'
        if (request.method === 'sign_event') {
          sendResponse({
            id: request.id,
            result: 'auth_url',
            error: 'https://signer.example/approve',
          })
          approval = () => sendResponse({ id: request.id, result })
        } else sendResponse({ id: request.id, result })
      }
    })
  })
  return {
    approve() {
      approval?.()
    },
    get published() {
      return published
    },
    scan(uri: string) {
      const u = new URL(uri)
      clientPubkey = u.hostname
      handshakeSecret = u.searchParams.get('secret')!
      if (subscriptions.size) {
        sendResponse({ id: 'connect', result: handshakeSecret })
        handshakeSecret = ''
      }
    },
  }
}
for (const method of ['bunker', 'qr'])
  test(`${method} authenticates and migrates through encrypted NIP-46`, async ({
    page,
  }) => {
    const relay = await remoteRelay(page)
    await page.goto('/')
    if (method === 'bunker') {
      await page
        .getByRole('button', { name: 'Bunker URI', exact: true })
        .click()
      await page
        .getByLabel('Bunker URI', { exact: true })
        .fill(`bunker://${bunkerPubkey}?relay=wss://other.example&secret=test`)
      await page.getByRole('button', { name: 'Connect bunker' }).click()
    } else {
      await page
        .getByRole('button', { name: 'Connect QR', exact: true })
        .click()
      await page.getByRole('button', { name: 'Create connection QR' }).click()
      await expect(
        page.getByRole('link', { name: 'Open signer app' }),
      ).toBeVisible()
      relay.scan(
        (await page
          .getByRole('link', { name: 'Open signer app' })
          .getAttribute('href'))!,
      )
    }
    await expect(
      page.getByRole('heading', { name: 'What’s moving?' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Load my napplets' }).click()
    await page.getByRole('button', { name: 'Begin Migration' }).click()
    await page.getByRole('button', { name: 'Review changes' }).click()
    await page
      .getByRole('button', { name: 'Migrate napplet', exact: false })
      .click()
    await expect(
      page.getByRole('link', { name: 'Approve this request in your signer' }),
    ).toBeVisible()
    relay.approve()
    await expect(
      page.getByRole('heading', { name: 'All moved in.' }),
    ).toBeVisible()
    expect(relay.published).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(
      page.getByRole('button', { name: 'Connect extension' }),
    ).toBeVisible()
  })

test.afterEach(async ({ page }) => {
  expect((await page.pageErrors()).map((e) => e.stack)).toEqual([])
})
