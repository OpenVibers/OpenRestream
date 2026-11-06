'use strict';
// GET /auth/health (plan L4): 200 when the Network accepts this site's OAuth client, 503 only when it refuses it.
const assert = require('assert');
const express = require('express');
const { createSsoRoutes } = require('../server/auth/sso');

const config = {
    baseUrl: 'https://openre.stream',
    networkUrl: 'https://network.test',
    networkInternalUrl: 'https://network.test',
    oauth: { clientId: 'openre', clientSecret: 's', redirectUri: 'https://openre.stream/auth/callback', scope: 'profile' },
    cookies: { secure: true },
};

async function probe(reply) {
    const calls = [];
    const app = express();
    app.use('/auth', createSsoRoutes({
        config,
        auth: { verifyUser: async () => null },
        fetchImpl: async (url, init) => { calls.push({ url: String(url), body: init.body }); return reply(); },
    }));
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    try {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/auth/health`);
        return { status: res.status, body: await res.json(), calls };
    } finally {
        server.close();
    }
}

(async () => {
    // The health check presents a code no sign-in ever had: invalid_grant means the client id and secret are right.
    let r = await probe(() => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
    assert.deepStrictEqual([r.status, r.body], [200, { ok: true, client: 'ok' }]);
    assert.strictEqual(JSON.parse(r.calls[0].body).grant_type, 'authorization_code');

    // invalid_client: the Network refuses this client.
    r = await probe(() => new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401, headers: { 'Content-Type': 'application/json' } }));
    assert.deepStrictEqual([r.status, r.body], [503, { ok: false, client: 'invalid' }]);

    // A Network that cannot be reached is not a refusal.
    r = await probe(() => { throw new Error('down'); });
    assert.deepStrictEqual([r.status, r.body], [200, { ok: true, client: 'unknown' }]);
    console.log('auth health: 200 unless the Network refuses the client');
})().catch((err) => { console.error(err); process.exit(1); });
