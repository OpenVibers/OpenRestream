'use strict';
// The discovery routes (server/discovery.js) answer with the right content types: robots.txt
// names the sitemap, sitemap.xml lists the public pages including /, and llms.txt describes what
// OpenRestream does today. All three come from openvibe-shared/seo, the shared toolkit.
const assert = require('assert');

function assertSitemapLastmods(xml, tag = 'url') {
    const entries = [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))];
    for (const [, body] of entries) {
        const match = /<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/.exec(body);
        assert.ok(match, body);
        assert.strictEqual(new Date(match[1]).toISOString().slice(0, 10), match[1]);
    }
    return entries;
}

const seo = require('openvibe-shared/seo');
const social = require('openvibe-shared/social');
const { bootApi, request, suite, userToken, OWNER } = require('./helpers');

const t = suite('discovery');

t('robots.txt welcomes crawlers, keeps the owner pages out, and names the sitemap', async () => {
    const api = await bootApi({});
    try {
        const r = await request(api.base, 'GET', '/robots.txt');
        assert.strictEqual(r.status, 200);
        assert.match(r.headers.get('content-type'), /^text\/plain/);
        assert.ok(r.text.includes(`Sitemap: ${seo.absolute('/sitemap.xml', api.config.baseUrl)}`), 'names the sitemap');
        assert.ok(r.text.includes('Disallow: /streams'), 'signed-in owner pages stay out');
        assert.ok(r.text.includes('Disallow: /api/'), 'the API stays out');
    } finally {
        await api.close();
    }
});

t('sitemap.xml is XML and lists the public pages, including /', async () => {
    const api = await bootApi({});
    try {
        const r = await request(api.base, 'GET', '/sitemap.xml');
        assert.strictEqual(r.status, 200);
        assert.match(r.headers.get('content-type'), /xml/);
        assert.ok(r.text.includes(`<loc>${seo.absolute('/', api.config.baseUrl)}</loc>`), 'lists /');
        assert.ok(r.text.includes(`<loc>${seo.absolute('/updates', api.config.baseUrl)}</loc>`), 'lists /updates');
        assert.strictEqual(assertSitemapLastmods(r.text).length, 2);
    } finally {
        await api.close();
    }
});

t('llms.txt is plain text, leads with open restreaming (OpenVibe Live on by default) and says what runs today', async () => {
    const api = await bootApi({});
    try {
        const r = await request(api.base, 'GET', '/llms.txt');
        assert.strictEqual(r.status, 200);
        assert.match(r.headers.get('content-type'), /^text\/plain/);
        assert.ok(r.text.startsWith('# OpenRestream\n'), 'starts with the site heading');
        const lead = r.text.split('\n').slice(0, 4).join(' ');
        assert.match(lead, /OpenRestream \(openre\.stream\) is an open restreaming platform/, 'open restreaming leads');
        assert.match(lead, /OpenVibe Live channel on by default/);
        assert.match(lead, /go live from their browser on OpenVibe\.Live/, 'browser go-live is still named, where it runs');
        // Only the RTMP ingest and restream workers run in production: WHIP and JSMPEG are ported, not served yet.
        assert.match(r.text, /WHIP \(RFC 9725\) to https:\/\/ingest\.openre\.stream\/whip\/<ingest key>, open to browsers/);
        assert.doesNotMatch(r.text, /do not run in production yet/, 'the workers run');
    } finally {
        await api.close();
    }
});

t('the front page leads with open restreaming, links to Live for browser go-live, and says what runs here', async () => {
    const api = await bootApi({ env: { BASE_URL: 'https://openre.stream' } });
    try {
        const r = await request(api.base, 'GET', '/');
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /<h1>Go live once\.<span class="sc-accent"> Stream everywhere\.<\/span><\/h1>/);
        assert.match(r.text, /<meta name="description" content="Go live once from OBS and restream to Twitch, YouTube, Kick and any RTMP or SRT server at once/);
        const desc = /<meta name="description" content="([^"]*)"/.exec(r.text)[1];
        assert.ok(desc.length <= 160, `the description fits a search result (${desc.length})`);
        const types = [...r.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])['@type']);
        assert.ok(types.includes('WebSite') && types.includes('FAQPage'), `the site and the questions as structured data: ${types}`);
        assert.ok(r.text.includes('id="destinations"') && r.text.includes('Any RTMP, RTMPS or SRT server'), 'where it can stream');
        assert.match(r.text, /<title>OpenRestream — go live once, stream everywhere<\/title>/);
        assert.match(r.text, /OpenVibe Live on by default/);
        assert.ok(r.text.includes(`href="${api.config.liveUrl}"`), 'browser go-live opens OpenVibe.Live, where it runs today');
        assert.match(r.text, /Going live from a browser happens on OpenVibe\.Live for now/);
        assert.match(r.text, /href="\/shared\/showcase\.css\?v=[0-9a-f]{12}"/);
        // A crawlable icon and the installable app's manifest (the shared set): search engines cannot use the data: favicon.
        assert.match(r.text, /<link rel="apple-touch-icon" href="\/shared\/icons\/[a-z0-9-]+-192\.png\?v=[0-9a-f]{12}">/);
        assert.match(r.text, /<link rel="manifest" href="\/shared\/manifest\/openre\.webmanifest\?v=[0-9a-f]{12}">/);
        // The showcase sits in main.ore's column, which has its gutter already: no second one, so the sign-in line and
        // "Recently shipped" line up with the sections above.
        assert.ok(r.text.includes('main.ore .sc-hero,main.ore .sc-sec,main.ore .sc-cta{padding-left:0;padding-right:0}'));
        assert.strictEqual((r.text.match(/<h1[ >]/g) || []).length, 1, 'one h1');
        // The SEO head (openvibe-shared/seo): the front page is shareable and machine-readable.
        assert.match(r.text, /<meta property="og:title" content="OpenRestream — go live once, stream everywhere">/);
        assert.match(r.text, /<meta name="twitter:card" content="summary_large_image">/);
        assert.match(r.text, /<meta property="og:image" content="https:\/\/openre\.stream\/shared\/social\/openre\.jpg\?v=[0-9a-f]{12}">/);
        const blocks = [...r.text.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
        assert.ok(blocks.length, 'JSON-LD is present');
        const app = blocks.find((x) => x['@type'] === 'WebApplication') || {};
        assert.strictEqual(app['@type'], 'WebApplication');
        assert.strictEqual(app.name, 'OpenRestream');
        assert.strictEqual(app.applicationCategory, 'MultimediaApplication');
        // The questions, as a visible list and as FAQPage JSON-LD; the OBS settings name the ingest server.
        const all = [...r.text.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
        const faq = all.find((x) => x['@type'] === 'FAQPage');
        assert.ok(faq && faq.mainEntity.length >= 5, 'FAQPage JSON-LD');
        assert.ok(faq.mainEntity.every((q) => r.text.includes(`<summary>${q.name.replace(/'/g, '&#39;')}</summary>`) || r.text.includes(`<summary>${q.name}</summary>`)), 'every JSON-LD question is on the page');
        assert.match(r.text, /Server: +rtmp:\/\/[^\s<]+\/live/);
    } finally {
        await api.close();
    }
});

t('the signed-in owner pages stay noindex and carry no og:image or JSON-LD', async () => {
    const api = await bootApi({});
    try {
        const r = await request(api.base, 'GET', '/streams', { cookie: `ov_token=${userToken({ subjectId: OWNER })}` });
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /<meta name="robots" content="noindex,nofollow">/);
        assert.ok(!r.text.includes('og:image'), 'no share image on a private page');
        assert.ok(!r.text.includes('application/ld+json'), 'no JSON-LD on a private page');
    } finally {
        await api.close();
    }
});

t('the site serves its own pinned share card at /shared/social/openre.jpg', async () => {
    const api = await bootApi({});
    try {
        const card = social.url('openre');
        assert.ok(card && card.startsWith('/shared/social/openre.jpg?v='), 'the card has a content-addressed URL');
        const r = await request(api.base, 'GET', card);
        assert.strictEqual(r.status, 200);
        assert.match(r.headers.get('content-type'), /^image\/jpeg/);
    } finally {
        await api.close();
    }
});


t.run();
