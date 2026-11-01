'use strict';
// A path nothing serves: a browser gets OpenRestream's own 404 page in the Frame, an API client (or a
// client that does not accept HTML) keeps the problem document.
const assert = require('assert');
const { bootApi, request, suite } = require('./helpers');

const t = suite('not-found');

t('a browser that asks for a missing page gets the site 404 page; an API client the problem document', async () => {
    const api = await bootApi({});
    try {
        const host = api.config.baseUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        const page = await request(api.base, 'GET', '/no-such-page-xyz', { headers: { Accept: 'text/html,application/xhtml+xml' } });
        assert.strictEqual(page.status, 404);
        assert.match(page.headers.get('content-type'), /^text\/html/);
        assert.ok(page.text.includes('<h1>Page not found</h1>'), page.text.slice(0, 300));
        assert.ok(page.text.includes(`There is no page at this address on ${host}. The link may be old or mistyped.`));
        assert.ok(page.text.includes('id="navbar-mount"'), 'the page is in the site Frame');
        assert.ok(page.text.includes('<meta name="robots" content="noindex,nofollow">'));
        assert.strictEqual(page.headers.get('x-robots-tag'), 'noindex');
        assert.ok(page.text.includes('class="nf-links"') && page.text.includes('href="/"'), 'home is the first way back');

        const apiPath = await request(api.base, 'GET', '/api/no-such', { headers: { Accept: 'text/html' } });
        assert.strictEqual(apiPath.status, 404);
        assert.match(apiPath.headers.get('content-type'), /problem\+json/);
        assert.strictEqual(apiPath.body.code, 'openre.not_found');

        const notHtml = await request(api.base, 'GET', '/no-such-page-xyz', { headers: { Accept: 'application/json' } });
        assert.strictEqual(notHtml.status, 404);
        assert.match(notHtml.headers.get('content-type'), /problem\+json/);
    } finally {
        await api.close();
    }
});

t.run();
