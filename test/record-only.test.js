'use strict';
// Record only, to my videos (record_to 'videos'; plan 2026-10-22 §3 D1, the owner's "record privately, then an AI edit"):
// the stream is always a private VOD and never on OpenVibe Live; each session records into OpenVibe.Video's Media app
// (media-hub) with the owner in the VOD's meta, for MediaHub; restream destinations never start; the form offers it.
const assert = require('assert');
const http = require('http');
const { runtime, manualClock, suite, OWNER, silent, bootApi, request, userToken, outboxEnvelopes } = require('./helpers');
const { createCoordinator } = require('../server/coordinator');
const { createMediaClient } = require('../server/media-client');
const { csrfFor } = require('../server/ui/routes');

const t = suite('record-only');

function stub(handler) {
    return new Promise((resolve) => {
        const s = http.createServer((req, res) => {
            let body = '';
            req.on('data', (c) => { body += c; });
            req.on('end', () => { let parsed = null; try { parsed = body ? JSON.parse(body) : null; } catch { parsed = null; } handler(req, res, parsed, body); });
        });
        s.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${s.address().port}`, close: () => new Promise(r => { s.closeAllConnections(); s.close(r); }) }));
    });
}
const reply = (res, status, obj) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj || {})); };
const refused = async (p, code) => { await assert.rejects(p, (err) => err.code === code && err.status === 400); };

t('a record-only stream is a private VOD that never goes to OpenVibe Live', async () => {
    const rt = await runtime({ clock: manualClock() });
    const { definition: d } = await rt.store.definitions.create({ owner_subject: OWNER, title: 'Diary', record_to: 'videos', recording_visibility: 'public', mirror_to_live: false });
    assert.deepStrictEqual([d.record_to, d.recording_mode, d.recording_visibility, d.playback_visibility, d.mirror_to_live], ['videos', 'vod', 'private', 'private', false]);
    await refused(rt.store.definitions.create({ owner_subject: OWNER, title: 'x', record_to: 'videos', mirror_to_live: true }), 'openre.record_only');
    await refused(rt.store.definitions.create({ owner_subject: OWNER, title: 'x', record_to: 'tape' }), 'openre.invalid_field');
    // Once record-only: switching OpenVibe Live on, or a public recording, is refused; the stream is left as it was.
    await refused(rt.store.definitions.update(d.id, { mirror_to_live: true }), 'openre.record_only');
    await refused(rt.store.definitions.update(d.id, { recording_visibility: 'public' }), 'openre.record_only');
    assert.strictEqual((await rt.store.definitions.get(d.id)).recording_visibility, 'private');
    // Back to a normal stream: it can go out again, and keeps what it had until changed.
    const normal = await rt.store.definitions.update(d.id, { record_to: null, mirror_to_live: true });
    assert.deepStrictEqual([normal.record_to, normal.mirror_to_live, normal.recording_visibility], [null, true, 'private']);
    // And a normal stream switched to record-only loses OpenVibe Live in the same change.
    const again = await rt.store.definitions.update(d.id, { record_to: 'videos', recording_visibility: 'public' });
    assert.deepStrictEqual([again.record_to, again.mirror_to_live, again.recording_visibility, again.playback_visibility], ['videos', false, 'private', 'private']);
});

t('each session records privately into OpenVibe.Video\'s Media app, naming the owner; destinations never start', async () => {
    const calls = [];
    const media = await stub((req, res, body) => {
        calls.push({ method: req.method, url: req.url, body });
        if (req.url === '/api/v1/media-hub/vods') return reply(res, 201, { id: 777 });
        if (req.url === '/api/v1/media-hub/vods/777/ingest/rtmp') return reply(res, 202, { status: 'recording' });
        if (req.url === '/api/v1/media-hub/vods/777/finalize') return reply(res, 200, {});
        return reply(res, 404);
    });
    const network = await stub((req, res) => reply(res, 200, { access_token: 'svc-media', token_type: 'Bearer', expires_in: 300 }));
    const clock = manualClock();
    const rt = await runtime({ clock, env: { MEDIA_URL: media.url, OV_NETWORK_INTERNAL_URL: network.url, OV_OAUTH_CLIENT_SECRET: 's3cret', OPENRE_RECORDING_START_DELAY_MS: '0' } });
    const coordinator = createCoordinator({ rt, media: createMediaClient({ config: rt.config }), log: silent });
    const { definition, key } = await rt.store.definitions.create({ owner_subject: OWNER, title: 'Morning take', record_to: 'videos', external_refs: [{ service: 'live', type: 'user', id: '8' }] });
    const dest = await rt.store.outputs.createDestination(definition.id, { platform: 'twitch', name: 'T', server_url: 'rtmps://live.twitch.tv/app', stream_key: 'example-not-a-secret', enabled: true, auto_start: true });
    const w = await rt.store.workers.register({ kind: 'rtmp-ingest', endpoints: { rtmpPlayPort: 19390, flvPort: 19391 } });
    await rt.store.workers.ready(w.id);
    const a = await rt.store.sessions.admit({ definition, key, protocol: 'rtmp', worker: await rt.store.workers.get(w.id) });
    await rt.store.sessions.transition(a.session.id, 'live');

    await coordinator.tick();
    await coordinator.tick();
    assert.deepStrictEqual(calls.map(c => `${c.method} ${c.url}`), ['POST /api/v1/media-hub/vods', 'POST /api/v1/media-hub/vods/777/ingest/rtmp']);
    const made = calls[0].body;
    assert.deepStrictEqual([made.visibility, made.title, made.user_id, made.meta.record_only, made.meta.owner_subject, made.meta.openre_session_id],
        ['private', 'Morning take', undefined, true, OWNER, a.session.id], 'private, the owner named, no Live ids');
    const rec = await rt.store.recordings.bySession(a.session.id);
    assert.deepStrictEqual([rec.media_app, rec.state], ['media-hub', 'recording']);
    const ev = (await outboxEnvelopes(rt.db)).find(e => e.event_type === 'openre.recording.requested');
    assert.deepStrictEqual(ev.payload.media, { app: 'media-hub', vod_id: '777' });

    // No output was made for the destination, and starting it by hand is refused.
    assert.deepStrictEqual(await rt.store.outputs.outputsOfSession(a.session.id), []);
    await assert.rejects(rt.store.outputs.startDestination(dest.id), (err) => err.code === 'openre.record_only' && err.status === 409);

    await rt.store.sessions.finish(a.session.id, { reason: 'publisher_disconnected' });
    await coordinator.tick();
    assert.strictEqual(calls.pop().url, '/api/v1/media-hub/vods/777/finalize', 'finalized in the same tenant');
    assert.strictEqual((await rt.store.recordings.bySession(a.session.id)).state, 'finalized');
    await media.close();
    await network.close();
});

t('the form offers "Record only, to my videos" and the stream page says where the recordings go', async () => {
    const api = await bootApi();
    const cookie = `ov_token=${userToken({ subjectId: OWNER })}`;
    const token = cookie.slice('ov_token='.length);
    try {
        const form = await request(api.base, 'GET', '/streams', { cookie });
        assert.match(form.text, /name="record_to" value="videos"/);
        assert.match(form.text, /Record only, to my videos/);
        const created = await request(api.base, 'POST', '/streams', { cookie, form: { title: 'Private take', record_to: 'videos', recording_mode: 'clips', recording_visibility: 'public', show_on_live: '1', _csrf: csrfFor(token) } });
        assert.strictEqual(created.status, 200);
        assert.match(created.text, /record only/);
        const d = (await api.rt.store.definitions.list({ owner_subject: OWNER })).find(x => x.title === 'Private take');
        assert.deepStrictEqual([d.record_to, d.recording_mode, d.recording_visibility, d.mirror_to_live], ['videos', 'vod', 'private', false]);
        const page = await request(api.base, 'GET', `/streams/${d.id}`, { cookie });
        assert.match(page.text, /your videos on OpenVibe\.Video/);
        assert.match(page.text, /Off while this stream records only to your videos/);
        assert.match(page.text, /name="record_to" value="videos" checked/);
        // Switched back in Settings: a normal stream again.
        const saved = await request(api.base, 'POST', `/streams/${d.id}`, { cookie, form: { title: 'Private take', record_to: '', recording_mode: 'vod', recording_visibility: 'unlisted', playback_visibility: 'public', state: 'active', _csrf: csrfFor(token) } });
        assert.strictEqual(saved.status, 303);
        const back = await api.rt.store.definitions.get(d.id);
        assert.deepStrictEqual([back.record_to, back.recording_visibility], [null, 'unlisted']);
    } finally {
        await api.close();
    }
});

t.run();
