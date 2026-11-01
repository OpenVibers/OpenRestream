'use strict';
/**
 * The page a browser gets for a path nothing serves: OpenRestream's own Frame, a way back, and no clue
 * about what was asked for. An API client keeps the problem document (server/app.js).
 */
const { renderPage, esc } = require('./layout');

function renderNotFound({ config }) {
    const host = String(config.baseUrl).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return renderPage({
        title: 'Page not found',
        robots: 'noindex,nofollow',
        config,
        body: `<h1>Page not found</h1>
<p>There is no page at this address on ${esc(host)}. The link may be old or mistyped.</p>
<ul class="nf-links">
<li><a href="/">OpenRestream home</a></li>
<li><a href="/streams">Streams</a></li>
<li><a href="/sessions">Sessions</a></li>
</ul>`,
    });
}

module.exports = { renderNotFound };
