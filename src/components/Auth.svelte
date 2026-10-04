<script lang="ts">
  import QRCode from 'qrcode'
  import { onDestroy } from 'svelte'
  import {
    DEFAULT_CONNECTION_RELAY,
    extensionLogin,
    remoteLogin,
    type Session,
  } from '../lib/nostr'
  let {
    onlogin,
    onauth,
  }: { onlogin: (s: Session) => void; onauth: (url: string) => void } = $props()
  let mode = $state<'extension' | 'qr' | 'bunker'>('extension'),
    relay = $state(DEFAULT_CONNECTION_RELAY),
    bunker = $state(''),
    busy = $state(false),
    error = $state(''),
    qr = $state(''),
    uri = $state(''),
    authUrl = $state('')
  let pending: ReturnType<typeof remoteLogin> | undefined,
    generation = 0,
    transferred = false
  function cancel() {
    generation++
    pending?.close()
    pending = undefined
    busy = false
    qr = ''
    uri = ''
    authUrl = ''
  }
  function change(next: typeof mode) {
    cancel()
    error = ''
    mode = next
  }
  async function connect() {
    error = ''
    busy = true
    const current = ++generation
    try {
      let result: Session
      if (mode === 'extension') result = await extensionLogin()
      else {
        if (mode === 'bunker' && !bunker.trim())
          throw new Error('Enter a bunker:// URI from your signer.')
        pending = remoteLogin(relay, mode === 'bunker' ? bunker : '', (url) => {
          authUrl = url
          onauth(url)
        })
        if (mode === 'qr') {
          uri = pending.uri
          void QRCode.toDataURL(uri, {
            width: 260,
            margin: 2,
            color: { dark: '#172d28', light: '#ffffff' },
          })
            .then((v) => {
              if (current === generation) qr = v
            })
            .catch(() => {})
        }
        result = await pending.ready
      }
      if (current !== generation) {
        result.close()
        return
      }
      transferred = true
      onlogin(result)
    } catch (e) {
      if (current === generation)
        error = e instanceof Error ? e.message : String(e)
    } finally {
      if (current === generation) busy = false
    }
  }
  onDestroy(() => {
    if (!transferred) cancel()
  })
</script>

<div class="eyebrow">YOUR KEYS, YOUR NAPPLETS</div>
<h1>A little move.<br /><span>A fresh start.</span></h1>
<p class="intro">
  Bring your napplets to the next manifest. Connect your signer to get started.
</p>
<div class="tabs" aria-label="Authentication method">
  <button
    class:active={mode === 'extension'}
    onclick={() => change('extension')}>Extension</button
  >
  <button class:active={mode === 'qr'} onclick={() => change('qr')}
    >Connect QR</button
  >
  <button class:active={mode === 'bunker'} onclick={() => change('bunker')}
    >Bunker URI</button
  >
</div>
{#if mode === 'extension'}
  <div class="connection-card">
    <div class="symbol">↗</div>
    <div>
      <h2>Your browser signer</h2>
      <p>
        Connect securely with a NIP-07 extension.<br />Your private key stays
        with your signer.
      </p>
    </div>
  </div>
{:else}
  <label for="connection-relay">Connection relay</label><input
    id="connection-relay"
    bind:value={relay}
    disabled={busy}
    spellcheck="false"
  />
  <p class="hint">
    Your signer must use this relay too. This also overrides a bunker URI’s
    relay.
  </p>
  {#if mode === 'bunker'}<label for="bunker">Bunker URI</label><input
      id="bunker"
      type="password"
      bind:value={bunker}
      disabled={busy}
      placeholder="bunker://…"
      autocomplete="off"
    />{/if}
  {#if qr}<div class="qr">
      <img src={qr} alt="NostrConnect QR code for your remote signer" />
      <p>Scan with your Nostr signer.</p>
      <a href={uri}>Open signer app ↗</a>
      <details>
        <summary>Connection URI</summary><textarea
          aria-label="NostrConnect URI"
          readonly
          value={uri}></textarea>
      </details>
    </div>{/if}
{/if}
{#if authUrl}<p class="notice">
    <a href={authUrl} target="_blank" rel="noopener noreferrer"
      >Approve this connection in your signer ↗</a
    >
  </p>{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}
<button class="primary wide" onclick={connect} disabled={busy}
  >{busy
    ? 'Waiting for your signer…'
    : mode === 'extension'
      ? 'Connect extension'
      : mode === 'qr'
        ? 'Create connection QR'
        : 'Connect bunker'} <span>↗</span></button
>
{#if busy}<button class="text-button" onclick={cancel}>Cancel connection</button
  >{/if}
<p class="footnote">
  Nothing is signed or published until you review your changes.
</p>
