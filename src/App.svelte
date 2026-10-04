<script lang="ts">
  import Auth from './components/Auth.svelte'
  import { onDestroy } from 'svelte'
  import { NappletRepository, relayUrls, type Session } from './lib/nostr'
  import {
    createDraft,
    title,
    migrationIssues,
    migrationNotes,
    buildMigration,
    type Draft,
  } from './lib/migration'
  import { MigrationBatch, type Outcome } from './lib/batch'
  import type { NostrEvent } from 'nostr-tools'
  let session = $state<Session | null>(null),
    step = $state(0),
    busy = $state(false),
    error = $state(''),
    message = $state('')
  let source = $state<'mine' | 'address'>('mine'),
    address = $state(''),
    relayText = $state(''),
    resolvingRelays = $state(false),
    relaySettingsOpen = $state(false),
    relayInfo = $state('')
  let events = $state<NostrEvent[]>([]),
    selected = $state<string[]>([]),
    loaded = $state(false),
    drafts = $state<Draft[]>([]),
    index = $state(0),
    outcomes = $state<Outcome[]>([])
  let signerAuthUrl = $state('')
  let repository = new NappletRepository(),
    batch: MigrationBatch | undefined,
    generation = 0
  const steps = ['Connect', 'Choose', 'Prepare', 'Review', 'Migrate']
  let current = $derived(drafts[index]),
    issues = $derived(current ? migrationIssues(current) : []),
    successes = $derived(outcomes.filter((o) => o.state === 'success').length)
  async function login(value: Session) {
    session = value
    step = 1
    signerAuthUrl = ''
    busy = true
    resolvingRelays = true
    relayText = ''
    relayInfo = ''
    const version = ++generation
    const result = await repository.resolveRelays(value.pubkey)
    if (version !== generation) return
    relayText = result.relays.join('\n')
    relaySettingsOpen = result.relays.length === 0
    relayInfo =
      result.source === 'nip65'
        ? result.relays.length
          ? 'Using write relays from your NIP-65 relay list.'
          : 'Your NIP-65 list has no usable write relays. Add a relay below to continue.'
        : 'No NIP-65 relay list was available. Using fallback relays; you can change them below.'
    resolvingRelays = false
    busy = false
  }
  function logout() {
    generation++
    batch?.cancel()
    repository.close()
    repository = new NappletRepository()
    session?.close()
    session = null
    signerAuthUrl = ''
    step = 0
    busy = false
    error = ''
    message = ''
    events = []
    drafts = []
    selected = []
    loaded = false
    outcomes = []
    batch = undefined
    address = ''
    relayText = ''
    relayInfo = ''
    resolvingRelays = false
    relaySettingsOpen = false
  }
  function reset() {
    step = 1
    events = []
    drafts = []
    selected = []
    loaded = false
    outcomes = []
    batch = undefined
    error = ''
    message = ''
  }
  async function load() {
    error = ''
    message = ''
    busy = true
    loaded = false
    events = []
    selected = []
    const version = ++generation
    try {
      const found = await repository.load(
        session!.pubkey,
        relayUrls(relayText),
        source === 'address' ? address : undefined,
      )
      if (version !== generation) return
      events = found
      selected = found.map((e) => e.id)
      loaded = true
      if (!found.length)
        message =
          'No legacy napplets found on these relays. Try another relay or a specific address. Already migrated manifests are excluded.'
    } catch (e) {
      if (version === generation)
        error = e instanceof Error ? e.message : String(e)
    } finally {
      if (version === generation) busy = false
    }
  }
  function begin() {
    drafts = events.filter((e) => selected.includes(e.id)).map(createDraft)
    index = 0
    step = 2
    error = ''
  }
  function next() {
    if (issues.length) return
    if (index < drafts.length - 1) index++
    else step = 3
  }
  async function migrate() {
    error = ''
    let relays: string[]
    try {
      relays = relayUrls(relayText)
    } catch (e) {
      error = String(e)
      return
    }
    batch ??= new MigrationBatch($state.snapshot(drafts))
    step = 4
    busy = true
    const version = generation
    await batch.run(session!, repository, relays, (values) => {
      if (version === generation) outcomes = values
    })
    if (version === generation) busy = false
  }
  function download() {
    const data = outcomes.flatMap((o) => (o.event ? [o.event] : []))
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = 'migrated-napplets.json'
    a.click()
    URL.revokeObjectURL(url)
  }
  onDestroy(() => {
    batch?.cancel()
    repository.close()
    session?.close()
  })
</script>

<svelte:head><title>Napplet · {steps[step]}</title></svelte:head>
<div class="shell">
  <header>
    <a class="brand" href="/" aria-label="Napplet Migrate home"
      ><span class="brand-mark">n<span>↗</span></span>napplet<span
        class="brand-divider">/</span
      ><span class="brand-sub">migrate</span></a
    >{#if session}<button class="logout" onclick={logout}
        >Log out <span>↗</span></button
      >{:else}<span class="draft-badge"><span></span> NEXT MANIFEST</span>{/if}
  </header>
  <main>
    <nav class="progress" aria-label="Migration progress">
      <div class="progress-track">
        <div style:width={`${step * 25}%`}></div>
      </div>
      <ol>
        {#each steps as name, i}<li
            class:completed={i < step}
            class:current={i === step}
            aria-current={i === step ? 'step' : undefined}
          >
            <span>{i < step ? '✓' : String(i + 1).padStart(2, '0')}</span>{name}
          </li>{/each}
      </ol>
    </nav>
    <section class="panel" aria-label={steps[step]}>
      {#if step === 0}<Auth
          onlogin={login}
          onauth={(url) => (signerAuthUrl = url)}
        />
      {:else if step === 1}
        <div class="eyebrow">02 / FIND YOUR NAPPLETS</div>
        <h1>What’s moving?</h1>
        <p class="intro">
          Choose your napplets. We’ll take care of them one at a time.
        </p>
        <div class="tabs">
          <button
            class:active={source === 'mine'}
            disabled={busy}
            onclick={() => {
              source = 'mine'
              loaded = false
              events = []
            }}>My napplets</button
          ><button
            class:active={source === 'address'}
            disabled={busy}
            onclick={() => {
              source = 'address'
              loaded = false
              events = []
            }}>Specific napplet</button
          >
        </div>
        {#if source === 'address'}<label for="address">Napplet address</label
          ><input
            id="address"
            bind:value={address}
            placeholder="naddr1…"
            spellcheck="false"
          />{/if}
        <details class="relay-settings" bind:open={relaySettingsOpen}>
          <summary>Discovery & publishing relays</summary>
          <p class="hint">{relayInfo}</p>
          <label for="relays">Relay URLs, one per line</label><textarea
            id="relays"
            bind:value={relayText}
            disabled={busy}
            rows="3"
            spellcheck="false"></textarea>
          <p class="hint">
            These relays are used to find and publish your manifests.
          </p>
        </details>
        <button
          class="secondary wide"
          onclick={load}
          disabled={busy ||
            !relayText.trim() ||
            (source === 'address' && !address.trim())}
          >{resolvingRelays
            ? 'Finding your relays…'
            : busy
              ? 'Looking for napplets…'
              : source === 'mine'
                ? 'Load my napplets'
                : 'Load napplet'}<span>↓</span></button
        >
        {#if message}<p class="notice" role="status">{message}</p>{/if}
        {#if loaded && events.length}<div class="list-heading">
            <span
              >{events.length}
              {events.length === 1 ? 'napplet' : 'napplets'} found</span
            >{#if events.length > 1}<button
                class="text-button"
                onclick={() =>
                  (selected =
                    selected.length === events.length
                      ? []
                      : events.map((e) => e.id))}
                >{selected.length === events.length
                  ? 'Deselect all'
                  : 'Select all'}</button
              >{/if}
          </div>
          <div class="napplet-list">
            {#each events as event}<label class="napplet-row"
                ><input
                  type="checkbox"
                  bind:group={selected}
                  value={event.id}
                /><span class="app-icon">↗</span><span
                  ><strong>{title(event)}</strong><small
                    >{event.kind === 5129
                      ? 'Snapshot'
                      : event.kind === 15129
                        ? 'Root napplet'
                        : 'Named napplet'}</small
                  ></span
                ></label
              >{/each}
          </div>
          <button
            class="primary wide"
            onclick={begin}
            disabled={!selected.length}
            >Begin Migration <span>{selected.length} →</span></button
          >{/if}
      {:else if step === 2 && current}
        <div class="eyebrow">
          03 / PREPARE <span class="counter"
            >NAPPLET {index + 1} OF {drafts.length}</span
          >
        </div>
        <h1>{title(current.original)}</h1>
        <p class="intro">A few details for its next chapter.</p>
        <label for="description"
          >Description <span class="required">REQUIRED</span></label
        ><textarea
          id="description"
          bind:value={current.description}
          rows="4"
          placeholder="What does this napplet do?"></textarea>
        <p class="hint">
          Plain text, displayed exactly as written. No HTML or Markdown
          rendering.
        </p>
        <div class="section-label">API capabilities</div>
        <p class="hint">
          Required APIs are needed for full functionality. Optional APIs add
          integrations.
        </p>
        {#if !current.capabilities.length}<p class="notice">
            This napplet declares no API capabilities.
          </p>{/if}
        <div class="capabilities">
          {#each current.capabilities as cap}<div class="capability">
              <code>{cap.name || '(empty domain)'}</code>
              <div class="segmented" aria-label={`${cap.name} requirement`}>
                <button
                  class:active={!cap.optional}
                  aria-pressed={!cap.optional}
                  onclick={() => (cap.optional = false)}>Required</button
                ><button
                  class:active={cap.optional}
                  aria-pressed={cap.optional}
                  onclick={() => (cap.optional = true)}>Optional</button
                >
              </div>
            </div>{/each}
        </div>
        {#if issues.length}<div class="notice" role="status">
            {#each issues as issue}<p>{issue}</p>{/each}
          </div>{/if}
        <div class="actions">
          <button
            class="text-button"
            onclick={() => {
              if (index > 0) index--
              else step = 1
            }}>← Back</button
          ><button class="primary" disabled={!!issues.length} onclick={next}
            >{index < drafts.length - 1 ? 'Next napplet' : 'Review changes'}
            <span>→</span></button
          >
        </div>
      {:else if step === 3}
        <div class="eyebrow">04 / ONE LAST LOOK</div>
        <h1>Ready for the move.</h1>
        <p class="intro">
          Review {drafts.length === 1
            ? 'your napplet'
            : `all ${drafts.length} napplets`} before signing and publishing.
        </p>
        <p class="notice">
          Targets the <a
            href="https://github.com/dskvr/nips/pull/7"
            target="_blank"
            rel="noreferrer">unmerged NIP-5D proposal ↗</a
          >. Migrations are published under your connected account. Keep the
          original event backup below.
        </p>
        {#each drafts as draft, i}<details
            class="review-card"
            open={drafts.length === 1}
          >
            <summary
              ><span class="app-icon small">↗</span><strong
                >{title(draft.original)}</strong
              ><span class="pill">{draft.capabilities.length} APIs</span
              ></summary
            >
            <p class="description-preview">{draft.description}</p>
            <div class="chips">
              {#each draft.capabilities as cap}<span class="chip"
                  >{cap.name} · {cap.optional ? 'optional' : 'required'}</span
                >{/each}
            </div>
            <ul class="changes">
              {#each migrationNotes(draft, session!.pubkey) as note}<li>
                  {note}
                </li>{/each}
            </ul>
            <button
              class="text-button"
              onclick={() => {
                index = i
                step = 2
              }}>Edit napplet ↗</button
            >
            <details class="json">
              <summary>Compare event JSON</summary>
              <h3>Before</h3>
              <pre>{JSON.stringify(draft.original, null, 2)}</pre>
              <h3>After (before signing)</h3>
              <pre>{JSON.stringify(
                  { ...buildMigration(draft), pubkey: session!.pubkey },
                  null,
                  2,
                )}</pre>
            </details>
          </details>{/each}
        <a
          class="backup"
          href={`data:application/json;charset=utf-8,${encodeURIComponent(
            JSON.stringify(
              drafts.map((d) => d.original),
              null,
              2,
            ),
          )}`}
          download="original-napplets.json">↓ Download original events</a
        >
        <details class="relay-settings">
          <summary>Publish to {relayUrls(relayText).length} relays</summary
          >{#each relayUrls(relayText) as relay}<p class="hint">
              {relay}
            </p>{/each}
        </details>
        <div class="actions">
          <button
            class="text-button"
            onclick={() => {
              index = drafts.length - 1
              step = 2
            }}>← Back</button
          ><button class="primary" onclick={migrate}
            >Migrate {drafts.length === 1
              ? 'napplet'
              : `${drafts.length} napplets`} <span>↗</span></button
          >
        </div>
      {:else if step === 4}
        <div class="eyebrow">
          05 / {busy ? 'MAKING THE MOVE' : 'MIGRATION RESULTS'}
        </div>
        <h1>
          {busy
            ? 'On their way.'
            : successes === drafts.length
              ? 'All moved in.'
              : 'Let’s finish the move.'}
        </h1>
        <p class="intro" role="status">
          {busy
            ? 'Approve signing requests in your signer.'
            : `${successes} of ${drafts.length} napplets accepted by at least one relay.`}
        </p>
        <progress
          max={drafts.length}
          value={outcomes.filter((o) => ['success', 'error'].includes(o.state))
            .length}
          aria-label="Migration completion"
        ></progress>
        {#each drafts as draft, i}{@const result = outcomes[i]}
          <div class="result">
            <div class="result-heading">
              <strong>{title(draft.original)}</strong><span
                class:success={result?.state === 'success'}
                >{result?.state === 'success'
                  ? '✓ Published'
                  : result?.state === 'error'
                    ? 'Needs retry'
                    : result?.state === 'signing'
                      ? 'Awaiting signature'
                      : result?.state === 'publishing'
                        ? 'Publishing…'
                        : 'Queued'}</span
              >
            </div>
            {#if result?.error}<p class="error">
                {result.error}
              </p>{/if}{#if result?.accepted}<p class="hint">
                Accepted: {result.accepted.join(', ')}
              </p>{/if}{#if result?.failed?.length}<p class="hint">
                Unavailable: {result.failed.join(', ')}
              </p>{/if}
          </div>{/each}
        {#if !busy}<div class="actions">
            <button class="text-button" onclick={download}
              >↓ Export signed events</button
            >{#if successes < drafts.length}<button
                class="primary"
                onclick={migrate}>Retry failed <span>↗</span></button
              >{:else}<button class="primary" onclick={reset}
                >Back to napplets <span>→</span></button
              >{/if}
          </div>{/if}
      {/if}
      {#if session && signerAuthUrl}<p class="notice">
          <a href={signerAuthUrl} target="_blank" rel="noopener noreferrer"
            >Approve this request in your signer ↗</a
          >
        </p>{/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </section>
    <div class="bottom-note">
      <span>↳</span> Your napplets. Just a new address for the details.
    </div>
  </main>
  <footer>
    <span>A small tool for the next chapter.</span><a
      href="https://github.com/dskvr/nips/pull/7"
      target="_blank"
      rel="noreferrer">NIP-5D proposal ↗</a
    >
  </footer>
</div>
