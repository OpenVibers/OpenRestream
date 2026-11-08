'use strict';
const assert = require('node:assert/strict');
const express = require('express');
const { createSsoRoutes } = require('../server/auth/sso');
(async () => {
    const app = express(); app.use(require('cookie-parser')());
    app.use('/auth', createSsoRoutes({ config: {
        baseUrl: 'https://openre.stream', networkUrl: 'https://network.test', networkInternalUrl: 'https://network.test',
        oauth: { clientId: 'openre', clientSecret: 'test-secret', redirectUri: 'https://openre.stream/auth/callback', scope: 'profile' }, cookies: { secure: true },
    }, auth: { verifyUser: async () => null }, fetchImpl: () => { throw Error('no token exchange for a guest'); } }));
    const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
    const get = (path, cookie) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
    try {
        const start = await get('/auth/login?silent=1&next=%2Fsessions%3Ftab%3Dmine%23latest');
        const u = new URL(start.headers.get('location'));
        assert.equal(u.searchParams.get('prompt'), 'none');
        assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
        const cookie = start.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
        const guest = await get('/auth/callback?error=login_required&state='+u.searchParams.get('state'), cookie);
        assert.equal(guest.status, 302);
        assert.equal(guest.headers.get('location'), '/sessions?tab=mine&sso=none#latest');
        assert.ok(!guest.headers.getSetCookie().some(c => c.startsWith('ov_token=')));
        const bad = await get('/auth/callback?code=unissued&state=wrong', cookie);
        assert.equal(bad.status, 400);
        const normal = await get('/auth/login?silent=0');
        assert.equal(new URL(normal.headers.get('location')).searchParams.get('prompt'), null);
        assert.ok(normal.headers.getSetCookie().some(c => c.startsWith('ov_oauth_silent=;')));
        console.log('silent signin: prompt, PKCE, guest return and state checks passed');
    } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(err => { console.error(err); process.exitCode = 1; });
