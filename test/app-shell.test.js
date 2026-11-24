'use strict';
const assert = require('assert');
const { bootApi, request, userToken, suite, OWNER, OTHER } = require('./helpers');
const cards = require('../server/ui/cards');
const t = suite('app-shell');
t('session scope and new tabs retain owner boundaries', async () => {
    const api = await bootApi();
    try {
        const mine = await api.rt.store.definitions.create({ owner_subject: OWNER, title: 'My broadcast' });
        await api.rt.store.definitions.create({ owner_subject: OTHER, title: 'Private other broadcast' });
        const cookie = `ov_token=${userToken()}`;
        for (const path of ['/streams', '/destinations', '/settings', '/go-live', '/sessions?all=1']) {
            const r = await request(api.base, 'GET', path, { cookie });
            assert.strictEqual(r.status, 200, path);
            assert.ok(r.text.includes('ovk-page-head'), path);
            assert.ok(r.text.includes('"appBar":true'), path);
            assert.ok(!r.text.includes('Private other broadcast'), path);
        }
        // Signed out: Go live (in the menu) is a real page that says what it is for, 200 and noindex; the rest 401.
        const guest = await request(api.base, 'GET', '/go-live', {});
        assert.strictEqual(guest.status, 200, 'Go live answers a guest');
        assert.ok(/reach every place at the same time/.test(guest.text) && /noindex/.test(guest.text), 'saying what it does, out of the index');
        assert.strictEqual((await request(api.base, 'GET', '/streams', {})).status, 401, 'a private page keeps its 401');
        const ordinary = await request(api.base, 'GET', '/sessions?all=1', { cookie });
        assert.ok(!ordinary.text.includes('Session owner'));
        assert.ok(ordinary.text.includes('Your restream sessions show here: each time you go live, where it went and how it did'));
        const staff = await request(api.base, 'GET', '/sessions?all=1', { cookie: `ov_token=${userToken({ role: 'admin' })}` });
        assert.ok(staff.text.includes('Session owner') && staff.text.includes('Everyone'));
        const anonymous = await request(api.base, 'GET', '/destinations');
        assert.ok(anonymous.status === 401 || anonymous.status === 302);
        assert.ok(mine.definition.id);
    } finally { await api.close(); }
});
t('session cards escape content and distinguish missing measurements', () => {
    const h = cards.session({ id: 's_test', state: 'ended', created_at: 1700000000000, ended_at: 1700003600000 }, { title: '<script>bad</script>' }, [{ state: 'error', last_error: 'lost' }], [{ platform: 'twitch' }]);
    assert.ok(h.includes('&lt;script&gt;') && !h.includes('<script>bad'));
    assert.ok(h.includes('1h 0m') && h.includes('Needs attention'));
    // No made-up number: an ended card has no Viewers figure, and its sheet says the destinations report none.
    assert.ok(!h.includes('<dt>Viewers</dt>') && h.includes('Viewer totals are not reported by these destinations.'));
    assert.ok(h.includes('data-ovk-sheet') && h.includes('<dialog') && h.includes('/sessions/s_test'));
    assert.ok(h.includes('Twitch') && h.includes('<svg'));
});
void t.run();
