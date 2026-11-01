'use strict';
/**
 * The standalone UI (openre.stream). Server-rendered, useful without JavaScript, forms post back
 * to the same process and go through the same store rules as the API.
 *
 *   /                         what OpenRestream is, and the signed-in owner's streams
 *   /streams                  definitions + create
 *   /streams/:id              ingest URL, keys (rotate: the new key is shown once), settings,
 *                             destinations (add, edit, delete, test, start, stop), sessions
 *   /sessions                 recent sessions
 *   /sessions/:id             lifecycle, outputs with health and logs, recording, playback
 *
 * CSRF: every form carries a token derived from the session cookie (an attacker's page cannot
 * read the cookie, so it cannot produce the token); SameSite=Lax cookies are the second layer.
 */
const crypto = require('crypto');
const ovServe = require('openvibe-shared/serve');
const seo = require('openvibe-shared/seo');
const frame = require('openvibe-shared/frame');
const showcase = require('openvibe-shared/showcase');
const express = require('express');
const { renderPage, esc } = require('./layout');
const { TWIN_PATH_RE } = require('../agent-pages');
const { linkHeaderTags } = require('openvibe-shared/agent-layer');
const { StoreError } = require('../store/definitions');
const { testDestination } = require('../destination-test');

const iso = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—');
const { REASONS: LIVE_REASONS } = require('../live-link');
// A channel URL comes from Live's answer; only an http(s) URL becomes a link.
const httpUrl = (u) => (/^https?:\/\/[^\s"'<>]+$/.test(String(u || '')) ? String(u) : null);
const pill = (state) => `<span class="pill ${esc(state)}">${esc(state)}</span>`;

// The front page's description reaches the <meta>, og:*/twitter:* and the softwareApp JSON-LD from
// one place (server/ui/layout.js clips it to 160 for the meta tags).
const FRONT_PAGE_DESCRIPTION = 'Go live once from OBS and restream to Twitch, YouTube, Kick and any RTMP or SRT server at once, with OpenVibe Live on by default. Free and open source.';

// The front page's questions, answered from what OpenRestream does today (README): shown as a list and as FAQPage JSON-LD.
const FRONT_FAQ = [
    { q: 'Is OpenRestream free?', a: 'Yes. Any OpenVibe account can restream from the first minute, with no follower, subscriber or eligibility minimum. The code is open source (AGPL-3.0).' },
    { q: 'Which platforms can I stream to?', a: 'Any platform that takes RTMP, RTMPS or SRT: Twitch, YouTube, Kick and others. Add each destination\'s server and key once; every destination has its own health, logs and retries.' },
    { q: 'Does OpenRestream re-encode my stream?', a: 'Not for a stream sent from OBS or another RTMP encoder: it is copied to every destination as it arrives, so each platform gets the quality you sent.' },
    { q: 'Can I go live without OBS?', a: 'Yes. On OpenVibe.Live you can go live from your browser, with nothing to install and no follower minimum.' },
    { q: 'Are my keys safe?', a: 'Your OpenRestream stream key is shown once and stored only as a hash; rotate it any time. Destination keys and SRT passphrases are encrypted (AES-256-GCM), the API only ever shows their last four characters, and logged command lines are redacted.' },
    { q: 'Does my stream also appear on OpenVibe Live?', a: 'By default, yes: every stream also goes live on your openvibe.live channel with chat, clips and VODs. Switch it off for any stream.' },
];

// The platforms a destination can be (store/outputs.js PLATFORMS), as the front page lists them: what each one needs.
const DESTINATIONS = [
    { id: 'twitch', name: 'Twitch', text: 'Your Twitch ingest server and stream key from the Twitch dashboard.' },
    { id: 'youtube', name: 'YouTube', text: 'The RTMP or RTMPS URL and stream key from YouTube Studio\'s Go live page.' },
    { id: 'kick', name: 'Kick', text: 'Kick\'s RTMPS server and stream key from your creator dashboard.' },
    { id: 'custom', name: 'Any RTMP, RTMPS or SRT server', text: 'Another platform, a friend\'s server or your own: a URL and a key or passphrase.' },
];

function csrfFor(token) { return crypto.createHash('sha256').update(`openre-csrf:${token}`).digest('hex').slice(0, 32); }

function createUiRouter({ rt, auth, limits = null, liveLink = null }) {
    const { store, config } = rt;
    const router = express.Router();
    router.use(express.urlencoded({ extended: false, limit: '64kb' }));
    router.use(auth.middleware({ services: false }));
    // The API's per-person limits count these form posts too (a test, a new stream, a rotation): one budget per person.
    if (limits) router.use(limits);

    const page = (req, res, o, status = 200) => {
        // The Link header names the same twin as the head, where the site sets headers; a signed-in page has none.
        if (TWIN_PATH_RE.test(String(o.canonicalPath || '/').split('?')[0])) {
            res.set('Link', linkHeaderTags(config.baseUrl + (o.canonicalPath || '/'), '/llms.txt').header);
        }
        return res.status(status).type('html').send(renderPage({ ...o, user: req.caller.kind === 'user' ? req.caller : null, config }));
    };
    const csrfField = (req) => `<input type="hidden" name="_csrf" value="${esc(csrfFor(req.caller.token))}">`;
    const form = (req, action, inner, { cls = '', confirm } = {}) => `<form method="post" action="${esc(action)}" class="${cls}"${confirm ? ` onsubmit="return confirm('${esc(confirm)}')"` : ''}>${csrfField(req)}${inner}</form>`;

    function needUser(req, res) {
        if (req.caller.kind === 'user' && req.caller.subject) return true;
        page(req, res, {
            title: 'Sign in', canonicalPath: req.path,
            body: `<h1>Sign in</h1><p>OpenRestream uses your OpenVibe account.</p><p><a class="sc-btn sc-primary" href="/auth/login?next=${encodeURIComponent(req.originalUrl)}">Sign in with OpenVibe</a></p>`,
        }, 401);
        return false;
    }

    function checkCsrf(req, res) {
        const given = String((req.body && req.body._csrf) || '');
        const expected = csrfFor(req.caller.token || '');
        if (given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return true;
        page(req, res, { title: 'Expired form', body: '<h1>That form expired</h1><p>Go back, reload the page and try again.</p>' }, 403);
        return false;
    }

    async function ownDefinition(req, res, id) {
        const d = await store.definitions.get(id);
        if (!d || d.state === 'archived' || !auth.canAccess(req.caller, d.owner_subject)) {
            page(req, res, { title: 'Not found', body: '<h1>Stream not found</h1><p><a href="/streams">Your streams</a></p>' }, 404);
            return null;
        }
        return d;
    }

    async function ownDestination(req, res, id) {
        const dest = await store.outputs.destinationRow(id);
        const d = dest ? await ownDefinition(req, res, dest.definition_id) : null;
        if (!dest && !res.headersSent) page(req, res, { title: 'Not found', body: '<h1>Destination not found</h1>' }, 404);
        return d ? { dest, definition: d } : null;
    }

    const post = (path, fn) => router.post(path, async (req, res, next) => {
        if (!needUser(req, res) || !checkCsrf(req, res)) return;
        try { await fn(req, res); } catch (err) {
            if (err instanceof StoreError || err.code === 'openre.secrets_unavailable') {
                return page(req, res, { title: 'Could not save', body: `<div class="flash bad">${esc(err.message)}</div><p><a href="javascript:history.back()">Back</a></p>` }, err.status || 400);
            }
            return next(err);
        }
    });

    // ── Pages ─────────────────────────────────────────────────

    // What shipped on OpenRestream: the shared update log every OpenVibe site has.
    router.get('/updates', (req, res) => page(req, res, { canonicalPath: '/updates', robots: 'index,follow', title: 'What shipped on OpenRestream', body: frame.updatesBody({ service: 'openre', siteName: 'OpenRestream' }) + `<script src="${ovServe.url('shipped.js')}" defer></script>` }));
    // The front page's real figures, read at most once a minute: streams set up, destinations by platform, sessions run
    // and the ones live now. A figure that is 0 is not shown, and a failed read shows none.
    let figuresCache = { at: 0, value: null };
    async function figures() {
        if (figuresCache.value && Date.now() - figuresCache.at < 60_000) return figuresCache.value;
        try {
            const one = async (sql) => Number(((await rt.db.prepare(sql).get()) || {}).n) || 0;
            const value = {
                streams: await one("SELECT count(*) AS n FROM stream_definitions WHERE state <> 'archived'"),
                destinations: await one('SELECT count(*) AS n FROM destinations'),
                sessions: await one('SELECT count(*) AS n FROM ingest_sessions'),
                live: await one("SELECT count(*) AS n FROM ingest_sessions WHERE state IN ('starting', 'live')"),
            };
            figuresCache = { at: Date.now(), value };
            return value;
        } catch { return null; }
    }

    router.get('/', async (req, res) => {
        const signedIn = req.caller.kind === 'user' && req.caller.subject;
        const f = await figures();
        const mine = signedIn ? await store.definitions.list({ owner_subject: req.caller.subject }) : [];
        page(req, res, {
            canonicalPath: '/', robots: 'index,follow', styles: [showcase.STYLESHEET],
            description: FRONT_PAGE_DESCRIPTION,
            // Structured data for the front page only: the site is a web application (openre.stream).
            jsonLd: [seo.jsonLd.website({ name: 'OpenRestream', url: `${config.baseUrl}/`, description: FRONT_PAGE_DESCRIPTION }), seo.jsonLd.softwareApp({
                name: 'OpenRestream', url: `${config.baseUrl}/`, description: FRONT_PAGE_DESCRIPTION, category: 'MultimediaApplication',
            }), seo.jsonLd.faq(FRONT_FAQ)],
            body: `${frontPage(config, f)}
${signedIn ? `<h2>Your streams</h2>${mine.length ? await streamTable(mine) : '<p class="muted">No streams yet.</p>'}<p><a href="/streams">Manage streams</a></p>` : '<p><a href="/auth/login?next=/streams">Sign in with OpenVibe</a> to manage your streams.</p>'}
${frame.shipped({ service: 'openre', title: 'Recently shipped on OpenRestream' })}`,
        });
    });

    /**
     * The front page (openvibe-shared/showcase). OpenRestream is an open restreaming platform with OpenVibe Live on by
     * default (owner, 2026-10-09). It says that RTMP ingest and RTMP/RTMPS/SRT restreaming run here, and that going live
     * from a browser happens on OpenVibe.Live for now (the WebRTC and JSMPEG workers are ported but not deployed).
     */
    // What streamers paste into OBS (config.rtmp.publicHost/publicPort): rtmp://<host>[:port]/live.
    const ingestServer = (cfg) => {
        const r = cfg.rtmp || {};
        const host = r.publicHost || 'ingest.openre.stream';
        return `rtmp://${host}${r.publicPort && Number(r.publicPort) !== 1935 ? `:${r.publicPort}` : ''}/live`;
    };

    /**
     * The free tier, in numbers (market outcome 1: state the real limits, not "free"): every figure is what the service
     * does today, the destination cap read from its own config, so the page can never promise more than it runs.
     */
    function freeTier() {
        const max = Number(config.outputs && config.outputs.maxPerStream) || 10;
        const rows = [
            ['Price', '$0. There is no paid tier'],
            ['Destinations', `Up to ${max} a stream, each with its own health, logs and retries`],
            ['Quality', 'What you send: a stream from OBS is copied, never re-encoded'],
            ['Watermark', 'None'],
            ['In', 'RTMP from OBS or any encoder; or your browser, on OpenVibe.Live'],
            ['Out', 'RTMP, RTMPS and SRT'],
            ['Recording', 'Per stream: a VOD, clips only, or nothing, saved to your OpenVibe.Video'],
            ['Minimum', 'None: no follower, subscriber or eligibility threshold'],
        ];
        return `<section class="sc-sec ore-tier" aria-labelledby="ore-tier-h"><h2 id="ore-tier-h">The free tier, in numbers</h2>
<dl class="ore-tier-grid">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>`;
    }

    function frontPage(cfg, f) {
        const live = cfg.liveUrl;
        const n = (v) => Number(v).toLocaleString('en-US');
        const stats = f ? [
            [f.live, f.live === 1 ? 'stream live right now' : 'streams live right now'],
            [f.streams, f.streams === 1 ? 'stream set up' : 'streams set up'],
            [f.destinations, f.destinations === 1 ? 'destination added' : 'destinations added'],
            [f.sessions, f.sessions === 1 ? 'time gone live' : 'times gone live'],
        ].filter(([v]) => v > 0) : [];
        return showcase.hero({
            eyebrow: 'OpenRestream · open restreaming',
            title: 'Go live once.', accent: 'Stream everywhere.',
            lede: 'Send one stream from OBS or any RTMP encoder, and OpenRestream sends it to Twitch, YouTube, Kick and any RTMP, RTMPS or SRT server at the same time. Your OpenVibe Live channel is on by default, with chat, clips and VODs. It is free and open source, with no follower minimum.',
            actions: [
                { label: 'Start restreaming', href: '/streams', primary: true },
                { label: 'No OBS? Go live from your browser', href: live },
                { label: 'How browser streaming works', href: `${live}/docs/go-live-in-your-browser` },
            ],
            note: 'Alpha. RTMP ingest and RTMP, RTMPS and SRT restreaming run here. Going live from a browser happens on OpenVibe.Live for now.',
            html: stats.length ? `<dl class="ore-stats">${stats.map(([v, d]) => `<div><dt>${n(v)}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl>` : undefined,
        }) + showcase.features({
            title: 'What OpenRestream does',
            items: [
                { icon: 'ov:live', title: 'One stream, every platform', text: 'Twitch, YouTube, Kick and any RTMP, RTMPS or SRT server at once. Each destination has its own health, logs and retries.' },
                { icon: 'ov:stream', title: 'OpenVibe Live on by default', text: 'Every stream also goes live on your openvibe.live channel, with chat, clips and VODs. Switch it off for any stream.' },
                { icon: 'ov:check', title: 'Keys you control', text: 'Each stream has its own RTMP key, shown once and stored only as a hash. Rotate it any time.' },
                { icon: 'ov:video', title: 'Recording', text: 'Per stream: record a VOD, keep clips only, or record nothing. Or record only: nothing goes live, and each session lands privately in your OpenVibe.Video, ready for the AI edit.' },
                { icon: 'ov:code', title: 'Open API and SDK', text: 'Streams, keys, sessions and destinations through the OpenVibe API and SDK, for your own tools and bots.' },
                { icon: 'ov:community', title: 'Free, open, no minimum', text: 'Any OpenVibe account can restream from the first minute: no follower, subscriber or eligibility threshold, and the code is on GitHub.' },
            ],
        }) + freeTier() + showcase.features({
            id: 'destinations',
            title: 'Where it can stream',
            lede: 'Add each destination once, test it, and it goes live with you every time.',
            items: DESTINATIONS.map((d) => ({ title: d.name, text: d.text })),
        }) + showcase.steps({
            title: 'Restream with OBS',
            items: [
                { title: 'Sign in', text: 'With your OpenVibe account.', href: '/auth/login?next=/streams' },
                { title: 'Create a stream', text: 'Copy the RTMP server and key; the key is shown only once. OpenVibe Live is already ticked.' },
                { title: 'Add destinations', text: 'The server and key of each platform you also stream to. Test each one before you go live.' },
                { title: 'Go live from OBS', text: 'Every destination, and your OpenVibe Live channel, shows its health while you stream.' },
            ],
        }) + showcase.code({
            title: 'OBS settings',
            lede: 'In OBS, open Settings → Stream, choose Custom, and paste the server and the key from your stream\'s page.',
            samples: [{ label: 'Settings → Stream', code: `Service:     Custom...\nServer:      ${ingestServer(cfg)}\nStream Key:  (from your stream's page, shown once)` }],
        }) + `<section class="sc-sec ore-faq" aria-labelledby="ore-faq-h"><h2 id="ore-faq-h">Questions</h2>
${FRONT_FAQ.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n')}
</section>`;
    }

    async function streamTable(list) {
        return `<table><tr><th>Stream</th><th>State</th><th>Now</th><th>Linked to</th></tr>${(await Promise.all(list.map(async (d) => {
            const open = (await store.sessions.openFor(d.id))[0];
            const refs = d.external_refs.map(r => `${r.service}:${r.type}:${r.id}`).join(', ');
            return `<tr><td><a href="/streams/${esc(d.id)}">${esc(d.title)}</a></td><td>${pill(d.state)}</td><td>${open ? pill(open.state) : '<span class="muted">offline</span>'}</td><td class="mono">${esc(refs) || '—'}</td></tr>`;
        }))).join('')}</table>`;
    }

    router.get('/streams', async (req, res) => {
        if (!needUser(req, res)) return;
        const list = await store.definitions.list({ owner_subject: req.caller.subject });
        page(req, res, {
            title: 'Streams', canonicalPath: '/streams',
            body: `<h1>Streams</h1>${list.length ? await streamTable(list) : '<p class="muted">No streams yet.</p>'}
<div class="card"><h2>New stream</h2>${form(req, '/streams', `
<label>Title</label><input type="text" name="title" maxlength="140" required>
${whereItGoes(null)}
<div class="ore-live-only"><div class="row"><div><label>Recording</label><select name="recording_mode"><option value="vod">Record a VOD</option><option value="clips">Clips only</option><option value="none">Do not record</option></select></div>
<div><label>Recording visibility</label><select name="recording_visibility"><option>public</option><option>unlisted</option><option>private</option></select></div></div>
<label><input type="checkbox" name="show_on_live" value="1" checked> Show it live on my OpenVibe Live channel too</label></div>
<button type="submit">Create stream</button><p class="muted">The ingest key is shown once, on the next page.</p>`)}</div>`,
        });
    });

    /** Where the stream shows on OpenVibe Live, or why it does not (the outcome of liveLink.link). */
    function liveNote(live) {
        if (!live) return '';
        if (live.linked) return `<div class="card"><p><strong>OpenVibe Live is on.</strong> When you go live, this stream also shows on ${httpUrl(live.channel_url) ? `<a href="${esc(live.channel_url)}">${esc(live.channel_url.replace(/^https?:\/\//, ''))}</a>` : 'your OpenVibe Live channel'}, with chat, clips and VODs. Switch it off in the stream's settings.</p></div>`;
        return `<div class="flash bad">${esc(live.reason || 'OpenVibe Live did not link this stream.')}</div>`;
    }

    /**
     * The choice between a normal stream and one that records only to the owner's videos (record_to 'videos', plan
     * 2026-10-22 §3 D1). Choosing "record only" hides the fields that only a stream going out uses (CSS :has, no
     * script); the server forces them anyway.
     */
    function whereItGoes(recordTo) {
        const option = (value, title, text) => `<label class="ore-option"><input type="radio" name="record_to" value="${value}"${(recordTo || '') === value ? ' checked' : ''}><span><strong>${title}</strong><span class="muted">${text}</span></span></label>`;
        return `<fieldset class="ore-choice"><legend>Where it goes</legend><div class="ore-options">
${option('', 'Go live', 'Restream to your destinations, and to your OpenVibe Live channel if you like. The recording follows the settings below.')}
${option('videos', 'Record only, to my videos', `Nothing goes live. Each session is recorded privately to your <a href="${esc(config.videoUrl)}/me/videos">OpenVibe.Video</a>, where the AI edit adds captions, chapters and a summary and can cut an edited copy.`)}
</div></fieldset>`;
    }

    /** What a record-only stream does, on its pages. */
    function recordNote(d) {
        if (d.record_to !== 'videos') return '';
        return `<div class="card"><p><span class="pill ok">record only</span> Each session is recorded privately to <a href="${esc(config.videoUrl)}/me/videos">your videos on OpenVibe.Video</a>, where the AI edit is one click away. Nothing goes live: OpenVibe Live and your restream destinations stay off until you switch this back in Settings.</p></div>`;
    }

    async function keyPage(req, res, definition, key, heading, live = null) {
        const ep = await store.definitions.ingestEndpoints(definition);
        res.set('Cache-Control', 'no-store');
        page(req, res, {
            title: heading, canonicalPath: `/streams/${definition.id}`,
            body: `<h1>${esc(heading)}</h1>
<div class="card"><p><strong>Copy the key now.</strong> OpenRestream stores only a hash of it; this page is the only time it is shown.</p>
<label>Server (OBS: Settings → Stream → Custom)</label><code class="secret">${esc(ep.rtmp ? ep.rtmp.url : '')}</code>
<label>Stream key</label><code class="secret">${esc(key.key)}</code></div>
${liveNote(live)}${recordNote(definition)}
<p><a href="/streams/${esc(definition.id)}">Continue to the stream</a></p>`,
        });
    }

    post('/streams', async (req, res) => {
        const b = req.body || {};
        const recordOnly = b.record_to === 'videos';
        const { definition, key } = await store.definitions.create({
            owner_subject: req.caller.subject, title: b.title, recording_mode: b.recording_mode,
            recording_visibility: b.recording_visibility, record_to: recordOnly ? 'videos' : null, created_by: req.caller.subject,
        });
        // OpenVibe Live on by default: the box is ticked on the form, unticking it opts out. A record-only stream never goes live.
        const live = liveLink && b.show_on_live === '1' && !recordOnly ? await liveLink.link(await store.definitions.get(definition.id)) : null;
        await keyPage(req, res, definition, key, 'Stream created', live);
    });

    router.get('/streams/:id', async (req, res) => {
        if (!needUser(req, res)) return;
        const d = await ownDefinition(req, res, req.params.id);
        if (!d) return;
        const ep = await store.definitions.ingestEndpoints(d);
        const keys = (await store.definitions.keys(d.id)).filter(k => k.status !== 'revoked');
        const dests = await store.outputs.destinations(d.id);
        const sessions = await store.sessions.list({ definition_id: d.id, limit: 15 });
        const open = await sessions.find(s => ['starting', 'live', 'ending'].includes(s.state));
        const outputs = open ? await store.outputs.outputsOfSession(open.id) : [];
        const outFor = async (destId) => await outputs.find(o => o.destination_id === destId);
        page(req, res, {
            title: d.title, canonicalPath: `/streams/${d.id}`,
            body: `<h1>${esc(d.title)} ${pill(d.state)}</h1>
<p class="muted mono">${esc(d.id)}${d.external_refs.length ? ` · linked to ${esc(d.external_refs.map(r => `${r.service}:${r.type}:${r.id}`).join(', '))}` : ''}</p>
${d.record_to ? recordNote(d) : liveStatus(d, req.query.live)}
<div class="card"><h2>Ingest</h2>
${ep.rtmp ? `<label>RTMP server</label><code class="secret">${esc(ep.rtmp.url)}</code>` : '<p class="muted">RTMP is not enabled for this stream.</p>'}
<table><tr><th>Key</th><th>Status</th><th>Created</th><th>Last used</th></tr>${keys.map(k => `<tr><td class="mono">ork_…${esc(k.hint)}</td><td>${pill(k.status)}${k.grace_until ? ` until ${esc(iso(k.grace_until))}` : ''}</td><td>${esc(iso(k.created_at))}</td><td>${esc(iso(k.last_used_at))}</td></tr>`).join('') || '<tr><td colspan="4">No usable key: rotate to get one.</td></tr>'}</table>
${form(req, `/streams/${d.id}/rotate`, `<div class="row"><div><label>Old key stays valid for (seconds, 0 = revoke now)</label><input type="number" name="grace_seconds" min="0" max="604800" value="0"></div>
<div><label><input type="checkbox" name="end_sessions" value="1"> also disconnect a running session</label></div></div><button type="submit" class="danger">Rotate key</button>`, { confirm: 'Issue a new key and retire the current one?' })}
</div>
<div class="card"><h2>Now</h2>${open ? `<p>${pill(open.state)} since ${esc(iso(open.live_at || open.created_at))} on ${esc(open.worker_kind)} generation ${esc(open.worker_generation)} · <a href="/sessions/${esc(open.id)}">session</a></p>
${form(req, `/sessions/${open.id}/end`, '<button type="submit" class="danger">End session</button>', { cls: 'inline', confirm: 'Disconnect the encoder?' })}` : '<p class="muted">Offline.</p>'}</div>
<div class="card"><h2>Restream destinations</h2>${d.record_to ? '<p class="muted">Off while this stream records only to your videos.</p>' : ''}
${dests.length ? `<table><tr><th>Destination</th><th>Output</th><th>Health</th><th>Actions</th></tr>${(await Promise.all(dests.map(async (x) => {
                const o = await outFor(x.id);
                return `<tr><td><strong>${esc(x.name || x.platform)}</strong> <span class="muted">${esc(x.platform)}</span><br><span class="mono">${esc(x.server_url)}</span><br><span class="muted">key ${esc(x.stream_key_hint || 'not set')}${x.enabled ? '' : ' · disabled'}${x.auto_start ? ' · auto-start' : ''}${x.hold_reason ? ` · held: ${esc(x.hold_reason)}` : ''}${x.cooldown_ms ? ` · cooling down until ${esc(x.cooldown_until)}` : ''}</span></td>
<td>${o ? pill(o.state) : '<span class="muted">—</span>'}</td>
<td>${o && o.progress ? `${esc(o.progress.fps ?? '?')} fps · ${esc(o.progress.bitrate_kbps ?? '?')} kbit/s · speed ${esc(o.progress.speed ?? '?')}` : ''}${o && o.last_error ? `<br><span class="muted">${esc(o.last_error)}</span>` : ''}${!o && x.last_error ? `<span class="muted">${esc(x.last_error)}</span>` : ''}</td>
<td>${form(req, `/destinations/${x.id}/test`, '<button type="submit" class="secondary">Test</button>', { cls: 'inline' })}${open && !d.record_to ? (o && ['pending', 'starting', 'live', 'error'].includes(o.state) ? form(req, `/destinations/${x.id}/stop`, '<button type="submit" class="secondary">Stop</button>', { cls: 'inline' }) : form(req, `/destinations/${x.id}/start`, '<button type="submit">Start</button>', { cls: 'inline' })) : ''}
<a href="/destinations/${esc(x.id)}">Edit</a>${form(req, `/destinations/${x.id}/delete`, '<button type="submit" class="danger">Delete</button>', { cls: 'inline', confirm: 'Delete this destination?' })}</td></tr>`;
            }))).join('')}</table>` : '<p class="muted">No destinations.</p>'}
<h3>Add a destination</h3>${form(req, `/streams/${d.id}/destinations`, destinationFields({}))}</div>
<div class="card"><h2>Settings</h2>${form(req, `/streams/${d.id}`, `
<label>Title</label><input type="text" name="title" maxlength="140" value="${esc(d.title)}">
${whereItGoes(d.record_to)}
<div class="row"><div class="ore-live-only"><label>Recording</label><select name="recording_mode">${['vod', 'clips', 'none'].map(m => `<option value="${m}"${d.recording_mode === m ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
<div class="ore-live-only"><label>Recording visibility</label><select name="recording_visibility">${['public', 'unlisted', 'private'].map(m => `<option${d.recording_visibility === m ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
<div class="ore-live-only"><label>Playback</label><select name="playback_visibility">${['public', 'unlisted', 'private'].map(m => `<option${d.playback_visibility === m ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
<div><label>State</label><select name="state">${['active', 'disabled'].map(m => `<option${d.state === m ? ' selected' : ''}>${m}</option>`).join('')}</select></div></div>
<label class="ore-live-only"><input type="checkbox" name="mirror_to_live" value="1"${d.mirror_to_live ? ' checked' : ''}> Show it live on my OpenVibe Live channel too</label>
<button type="submit">Save</button>`)}</div>
<h2>Sessions</h2>${sessionTable(sessions)}`,
        });
    });

    /** The stream page's OpenVibe Live line: where it shows, that it is off, or why switching it on failed. */
    function liveStatus(d, failed) {
        const slot = liveLink ? liveLink.slotOf(d) : null;
        const reason = failed && LIVE_REASONS[failed];
        const flash = failed ? `<div class="flash bad">${esc(reason || 'OpenVibe Live did not link this stream.')}</div>` : '';
        if (d.mirror_to_live && slot) return `${flash}<p><span class="pill live">on</span> OpenVibe Live: sessions show on ${httpUrl(slot.label) ? `<a href="${esc(slot.label)}">${esc(String(slot.label).replace(/^https?:\/\//, ''))}</a>` : 'your OpenVibe Live channel'}.</p>`;
        return `${flash}<p class="muted">OpenVibe Live is off for this stream: switch it on in Settings.</p>`;
    }

    function destinationFields(x) {
        const sel = (name, opts, cur) => `<select name="${name}">${opts.map(o => `<option${o === cur ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
        return `<div class="row"><div><label>Platform</label>${sel('platform', ['twitch', 'youtube', 'kick', 'custom'], x.platform)}</div>
<div><label>Name</label><input type="text" name="name" maxlength="80" value="${esc(x.name || '')}"></div></div>
<label>Server URL (rtmp://, rtmps:// or srt://)</label><input type="text" name="server_url" maxlength="2048" value="${esc(x.server_url || '')}" required>
<label>Stream key ${x.id ? '(leave empty to keep the stored key)' : ''}</label><input type="password" name="stream_key" autocomplete="off" maxlength="512">
<div class="row"><div><label>Quality (only used when re-encoding)</label>${sel('quality_preset', ['auto', 'low', 'medium', 'high', 'ultra', 'source'], x.quality_preset || 'auto')}</div>
<div><label>SRT latency (ms)</label><input type="number" name="srt_latency_ms" min="20" max="8000" value="${esc(x.srt_latency_ms || '')}"></div>
<div><label>SRT passphrase ${x.id ? '(empty = keep)' : ''}</label><input type="password" name="srt_passphrase" autocomplete="off" maxlength="79"></div></div>
<label><input type="checkbox" name="enabled" value="1"${x.enabled === false ? '' : ' checked'}> enabled</label>
<label><input type="checkbox" name="auto_start" value="1"${x.auto_start === false ? '' : ' checked'}> start automatically when the stream goes live</label>
<button type="submit">${x.id ? 'Save destination' : 'Add destination'}</button>`;
    }

    function destInput(b, { editing }) {
        const out = {
            platform: b.platform, name: b.name, server_url: b.server_url, quality_preset: b.quality_preset,
            enabled: b.enabled === '1', auto_start: b.auto_start === '1',
            srt_latency_ms: b.srt_latency_ms === '' || b.srt_latency_ms == null ? null : b.srt_latency_ms,
        };
        if (!editing || b.stream_key) out.stream_key = b.stream_key || '';
        if (!editing || b.srt_passphrase) out.srt_passphrase = b.srt_passphrase || '';
        return out;
    }

    function sessionTable(list) {
        if (!list.length) return '<p class="muted">No sessions yet.</p>';
        return `<table><tr><th>Session</th><th>State</th><th>Started</th><th>Ended</th><th>Worker</th></tr>${list.map(s => `<tr><td><a class="mono" href="/sessions/${esc(s.id)}">${esc(s.id)}</a></td><td>${pill(s.state)}${s.failure_reason ? ` <span class="muted">${esc(s.failure_reason)}</span>` : ''}</td><td>${esc(iso(s.live_at || s.created_at))}</td><td>${esc(iso(s.ended_at))}</td><td>${esc(s.worker_kind)} #${esc(s.worker_generation)}</td></tr>`).join('')}</table>`;
    }

    post('/streams/:id', async (req, res) => {
        const d = await ownDefinition(req, res, req.params.id);
        if (!d) return;
        const b = req.body || {};
        // Record only wins: the fields it hides are still posted, and the store sets them for a record-only stream.
        const recordTo = b.record_to === 'videos' ? 'videos' : null;
        const want = b.mirror_to_live === '1' && !recordTo;
        await store.definitions.update(d.id, { title: b.title, recording_mode: b.recording_mode, recording_visibility: b.recording_visibility, playback_visibility: b.playback_visibility, state: b.state, record_to: recordTo, mirror_to_live: want && liveLink ? undefined : want });
        if (want && liveLink) {
            // Switching it on gets the Live slot first; refused, it stays off and the page says why.
            const r = await liveLink.link(await store.definitions.get(d.id));
            if (!r.linked) return res.redirect(303, `/streams/${d.id}?live=${encodeURIComponent(r.code)}`);
        }
        res.redirect(303, `/streams/${d.id}`);
    });

    post('/streams/:id/rotate', async (req, res) => {
        const d = await ownDefinition(req, res, req.params.id);
        if (!d) return;
        const r = await store.definitions.rotateKey(d.id, { grace_seconds: Number(req.body.grace_seconds) || 0, rotated_by: req.caller.subject });
        if (req.body.end_sessions === '1') for (const s of await store.sessions.openFor(d.id)) await store.sessions.requestEnd(s.id, `key_rotation:${req.caller.subject}`);
        await keyPage(req, res, await store.definitions.get(d.id), r.key, 'New ingest key');
    });

    post('/streams/:id/destinations', async (req, res) => {
        const d = await ownDefinition(req, res, req.params.id);
        if (!d) return;
        await store.outputs.createDestination(d.id, destInput(req.body || {}, { editing: false }));
        res.redirect(303, `/streams/${d.id}`);
    });

    router.get('/destinations/:id', async (req, res) => {
        if (!needUser(req, res)) return;
        const own = await ownDestination(req, res, req.params.id);
        if (!own) return;
        const x = store.outputs.publicDest(own.dest);
        const logs = await store.outputs.logsOfDestination(x.id, 50);
        page(req, res, {
            title: `Destination ${x.name || x.platform}`, canonicalPath: `/destinations/${x.id}`,
            body: `<h1>${esc(x.name || x.platform)}</h1><p><a href="/streams/${esc(own.definition.id)}">← ${esc(own.definition.title)}</a></p>
<div class="card">${form(req, `/destinations/${x.id}`, destinationFields(x))}</div>
<h2>Log</h2>${logs.length ? `<table><tr><th>When</th><th>Level</th><th>Message</th></tr>${logs.map(l => `<tr><td>${esc(iso(l.at))}</td><td>${pill(l.level === 'error' ? 'failed' : l.level === 'warn' ? 'error' : 'ok')}</td><td class="mono">${esc(l.message)}</td></tr>`).join('')}</table>` : '<p class="muted">Nothing logged yet.</p>'}`,
        });
    });

    post('/destinations/:id', async (req, res) => {
        const own = await ownDestination(req, res, req.params.id);
        if (!own) return;
        await store.outputs.updateDestination(own.dest.id, destInput(req.body || {}, { editing: true }));
        res.redirect(303, `/streams/${own.definition.id}`);
    });

    post('/destinations/:id/delete', async (req, res) => {
        const own = await ownDestination(req, res, req.params.id);
        if (!own) return;
        await store.outputs.deleteDestination(own.dest.id);
        res.redirect(303, `/streams/${own.definition.id}`);
    });

    post('/destinations/:id/test', async (req, res) => {
        const own = await ownDestination(req, res, req.params.id);
        if (!own) return;
        const result = await testDestination(own.dest, { allowPrivate: config.outputs.allowPrivateHosts });
        await store.outputs.log(null, own.dest.id, result.ok ? 'info' : 'warn', `test ${result.ok ? 'passed' : 'failed'}: ${result.checks.map(c => `${c.check} ${c.ok ? 'ok' : 'FAIL'} (${c.detail})`).join('; ')}`);
        page(req, res, {
            title: 'Destination test',
            body: `<h1>Test ${result.ok ? pill('ok') : pill('failed')}</h1><table>${result.checks.map(c => `<tr><td>${esc(c.check)}</td><td>${c.ok ? pill('ok') : pill('failed')}</td><td>${esc(c.detail)}</td></tr>`).join('')}</table>
<p class="muted">A passing test means the ingest is reachable. Whether the platform accepts the key shows once an output runs.</p><p><a href="/streams/${esc(own.definition.id)}">Back</a></p>`,
        });
    });

    post('/destinations/:id/start', async (req, res) => {
        const own = await ownDestination(req, res, req.params.id);
        if (!own) return;
        await store.outputs.startDestination(own.dest.id);
        res.redirect(303, `/streams/${own.definition.id}`);
    });

    post('/destinations/:id/stop', async (req, res) => {
        const own = await ownDestination(req, res, req.params.id);
        if (!own) return;
        await store.outputs.stopDestination(own.dest.id);
        res.redirect(303, `/streams/${own.definition.id}`);
    });

    router.get('/sessions', async (req, res) => {
        if (!needUser(req, res)) return;
        const all = req.caller.staff && req.query.all === '1';
        page(req, res, { title: 'Sessions', canonicalPath: '/sessions', body: `<h1>Sessions</h1>${req.caller.staff ? `<p class="muted"><a href="/sessions${all ? '' : '?all=1'}">${all ? 'Only mine' : 'Everyone (staff)'}</a></p>` : ''}${sessionTable(await store.sessions.list({ owner_subject: all ? undefined : req.caller.subject, limit: 100 }))}` });
    });

    router.get('/sessions/:id', async (req, res) => {
        if (!needUser(req, res)) return;
        const s = await store.sessions.get(req.params.id);
        const d = s ? await store.definitions.row(s.definition_id) : null;
        if (!s || !d || !auth.canAccess(req.caller, d.owner_subject)) return page(req, res, { title: 'Not found', body: '<h1>Session not found</h1>' }, 404);
        const outputs = await store.outputs.outputsOfSession(s.id);
        const rec = await store.recordings.bySession(s.id);
        const pb = await store.sessions.playback(s);
        const open = ['starting', 'live', 'ending'].includes(s.state);
        return page(req, res, {
            title: `Session ${s.id}`, canonicalPath: `/sessions/${s.id}`,
            body: `<h1>Session ${pill(s.state)}</h1><p class="mono">${esc(s.id)}</p><p><a href="/streams/${esc(d.id)}">← ${esc(d.title)}</a></p>
<div class="card"><table>
<tr><th>Protocol</th><td>${esc(s.protocol)}</td></tr>
<tr><th>Worker</th><td>${esc(s.worker_kind)} generation ${esc(s.worker_generation)} <span class="mono muted">${esc(s.worker_id)}</span></td></tr>
<tr><th>Live since</th><td>${esc(iso(s.live_at))}</td></tr><tr><th>Ended</th><td>${esc(iso(s.ended_at))} ${esc(s.end_reason || s.failure_reason || '')}</td></tr>
<tr><th>Media</th><td>${s.media_info ? esc(`${s.media_info.video_codec || '?'} ${s.media_info.width || '?'}×${s.media_info.height || '?'} @${s.media_info.fps || '?'} · ${s.media_info.audio_codec || 'no audio'} · ${s.media_info.bitrate_kbps || '?'} kbit/s`) : '—'}</td></tr>
<tr><th>Recording</th><td>${rec ? `${pill(rec.state)} ${rec.media_vod_id ? `Media ${esc(rec.media_app)} VOD ${esc(rec.media_vod_id)}` : ''} ${esc(rec.last_error || '')}${rec.media_app === config.media.videosAppId ? `<br>Private, in <a href="${esc(config.videoUrl)}/me/videos">your videos on OpenVibe.Video</a> once it is ready.` : ''}` : '<span class="muted">none</span>'}</td></tr>
<tr><th>Playback</th><td>${pb && pb.flv && s.state === 'live' ? `<a class="mono" href="${esc(pb.flv.public_url)}">${esc(pb.flv.public_url)}</a> (HTTP-FLV)` : '—'}</td></tr>
</table>${open ? form(req, `/sessions/${s.id}/end`, '<button type="submit" class="danger">End session</button>', { confirm: 'Disconnect the encoder?' }) : ''}</div>
<h2>Outputs</h2>${outputs.length ? `<table><tr><th>Output</th><th>State</th><th>Health</th><th>Restarts</th></tr>${(await outputs.map(o => `<tr><td class="mono">${esc(o.id)}<br><span class="muted">${esc(o.destination_id)}</span></td><td>${pill(o.state)}</td><td>${o.progress ? `${esc(o.progress.fps ?? '?')} fps · ${esc(o.progress.bitrate_kbps ?? '?')} kbit/s` : ''} ${esc(o.last_error || '')}</td><td>${esc(o.restart_attempts)}/${esc(o.max_restart_attempts)}</td></tr>`)).join('')}</table>` : '<p class="muted">No outputs.</p>'}
<h2>Lifecycle</h2><table>${(await store.sessions.transitions(s.id)).map(t => `<tr><td>${esc(iso(t.at))}</td><td>${esc(t.from_state || '·')} → ${pill(t.to_state)}</td><td>${esc(t.reason || '')}</td><td class="mono muted">${esc(t.actor || '')}</td></tr>`).join('')}</table>`,
        });
    });

    post('/sessions/:id/end', async (req, res) => {
        const s = await store.sessions.get(req.params.id);
        const d = s ? await store.definitions.row(s.definition_id) : null;
        if (!s || !d || !auth.canAccess(req.caller, d.owner_subject)) return page(req, res, { title: 'Not found', body: '<h1>Session not found</h1>' }, 404);
        await store.sessions.requestEnd(s.id, req.caller.subject);
        return res.redirect(303, `/sessions/${s.id}`);
    });

    return router;
}

module.exports = { createUiRouter, csrfFor };
