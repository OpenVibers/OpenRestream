'use strict';
const ovServe = require('openvibe-shared/serve');
const seo = require('openvibe-shared/seo');
const social = require('openvibe-shared/social');
/**
 * Page shell for openre.stream: server-rendered HTML that works without JavaScript, with the shared
 * OpenVibe Frame (theme loader, navbar and footer from openvibe.network, footer SSR from the
 * pinned openvibe-shared release) the way OpenVibe.Community renders it.
 *
 * The <head>'s SEO tags (title, description, canonical, robots, og:*, twitter:* and JSON-LD) come
 * from openvibe-shared/seo, so every OpenVibe site emits the same, consistently clipped fields. The
 * public, indexable pages share the site's card (openvibe-shared/social) and may carry JSON-LD; the
 * signed-in owner pages (/streams, /sessions, …) stay noindex and get neither an image nor JSON-LD.
 */
const NETWORK_URL = 'https://openvibe.network';
const SITE = 'OpenRestream';

function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CSS = `
:root{--ore-bg:#0d131d;--ore-panel:#141c2b;--ore-line:#233049;--ore-text:#e6ecf5;--ore-muted:#93a2bd;--ore-accent:#3b82f6;--ore-ok:#22c55e;--ore-warn:#f59e0b;--ore-bad:#ef4444}
body{margin:0;background:var(--ore-bg);color:var(--ore-text);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main.ore{max-width:1040px;margin:0 auto;padding:24px 16px 64px}
main.ore .sc-hero,main.ore .sc-sec,main.ore .sc-cta{padding-left:0;padding-right:0}
.ore h1{font-size:1.6rem;margin:.2em 0 .4em}.ore h2{font-size:1.15rem;margin:1.6em 0 .6em}.ore h3{font-size:1rem;margin:1em 0 .4em}
.ore a{color:#93c5fd}.ore p.muted,.ore .muted{color:var(--ore-muted)}
.ore .card{background:var(--ore-panel);border:1px solid var(--ore-line);border-radius:10px;padding:14px 16px;margin:12px 0}
.ore-stats{margin:0;display:grid;gap:10px}.ore-stats div{border:1px solid var(--ore-line);border-radius:12px;padding:12px 16px;background:var(--bg-card,#131c2e)}
.ore-stats dt{font-size:1.25rem;font-weight:700}.ore-stats dd{margin:2px 0 0;color:var(--ore-muted);font-size:.92rem}
.ore-faq details{border-bottom:1px solid var(--ore-line);padding:.75rem 0}.ore-faq details:first-of-type{border-top:1px solid var(--ore-line)}
.ore-faq summary{cursor:pointer;font-weight:600;list-style-position:inside}.ore-faq summary:hover{color:#93c5fd}.ore-faq details p{margin:.5rem 0 0;color:var(--ore-muted);max-width:46rem}
.ore table{width:100%;border-collapse:collapse;font-size:.92rem}.ore th,.ore td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--ore-line);vertical-align:top}
.ore code,.ore .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88rem;word-break:break-all}
.ore .secret{display:block;background:#0a0f18;border:1px dashed var(--ore-warn);padding:10px;border-radius:8px;user-select:all}
.ore form.inline{display:inline}.ore label{display:block;margin:.4em 0 .15em;color:var(--ore-muted);font-size:.88rem}
.ore input[type=text],.ore input[type=password],.ore input[type=number],.ore select,.ore textarea{width:100%;box-sizing:border-box;background:#0a0f18;color:var(--ore-text);border:1px solid var(--ore-line);border-radius:6px;padding:7px 9px}
.ore .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
:where(.ore) button{background:var(--accent-strong,#3472d8);color:var(--on-accent-strong,#fff);border:0;border-radius:6px;padding:7px 12px;cursor:pointer;font-weight:600;margin:6px 6px 0 0}
:where(.ore) button.secondary{background:#334155;color:#fff}:where(.ore) button.danger{background:#dc2626;color:#fff}
.ore .pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:.8rem;font-weight:600;background:#334155}
.ore .pill.live,.ore .pill.ok{background:var(--ore-ok);color:#04110a}.ore .pill.starting,.ore .pill.ending,.ore .pill.pending,.ore .pill.error,.ore .pill.draining{background:var(--ore-warn);color:#1a1000}
.ore .pill.failed,.ore .pill.lost{background:#b91c1c;color:#fff}
.ore .flash{border-left:4px solid var(--ore-accent);padding:8px 12px;background:var(--ore-panel);margin:12px 0}.ore .flash.bad{border-color:var(--ore-bad)}
@media (max-width:640px){.ore th:nth-child(n+4),.ore td:nth-child(n+4){display:none}}
`;

const DESCRIPTION = 'OpenRestream: go live once from OBS and restream to Twitch, YouTube, Kick and any RTMP or SRT server at once, with OpenVibe Live on by default.';

function renderPage({ title, body, user, canonicalPath = '/', robots = 'noindex,nofollow', config, description = DESCRIPTION, styles = [], jsonLd = null }) {
    const pageTitle = title ? `${title} · ${SITE}` : `${SITE} — go live once, stream everywhere`;
    const canonical = config.baseUrl + canonicalPath;
    // Indexable (public) pages are the only ones a crawler shares: they carry the site's card and,
    // where the route supplies one, JSON-LD. The signed-in owner pages stay noindex with neither.
    const indexable = /^\s*index/i.test(String(robots));
    const seoHead = seo.headTags({
        title: pageTitle,
        description,
        canonical,
        siteName: SITE,
        robots,
        image: indexable ? social.url('openre') : null,
        jsonLd: indexable ? jsonLd : null,
    });
    const nav = {
        service: 'openre',
        apiBase: NETWORK_URL,
        links: [
            { label: 'Streams', href: '/streams' },
            { label: 'Sessions', href: '/sessions' },
        ],
        sessionUrl: '/auth/me',
        loginUrl: `/auth/login?next=${encodeURIComponent(canonicalPath)}`,
        logoutUrl: '/auth/logout?next={path}',   // Sign out in the shared navbar ends this site's session too
        notificationsRealtime: true,   // the bell hears new notifications over OpenVibe.Events (Shared 1.22.0)
    };
    const foot = { service: 'openre', variant: 'compact', mount: '#ov-footer', brandName: SITE, legalBase: config.liveUrl, updates: '/updates',
        links: [{ heading: SITE, items: [{ name: 'Streams', url: '/streams' }, { name: 'Source code', url: 'https://github.com/OpenVibers/OpenRestream' }] }] };
    let footerSsr = '';
    try { footerSsr = require('openvibe-shared/footer').ssr({ service: 'openre', variant: 'compact', updates: '/updates' }); } catch { footerSsr = '<footer id="ov-footer"></footer>'; }
    let icon = '';
    try { icon = require('openvibe-shared/app-icon').headTags({ site: 'network' }); } catch { icon = ''; }
    // A crawlable icon (search engines cannot use the data: favicon) and the installable app's manifest: the shared set.
    try {
        icon += `\n<link rel="apple-touch-icon" href="${require('openvibe-shared/app-icons').url('openre', 192)}">\n<link rel="manifest" href="${ovServe.manifestUrl('openre')}">`;
    } catch { /* the inline favicon is enough to render */ }
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${seoHead}
${icon}
<script src="${ovServe.url('theme-loader.js')}" defer></script>
<style>${CSS}</style>
${styles.map((name) => `<link rel="stylesheet" href="${esc(ovServe.url(name))}">`).join('\n')}
<script src="${ovServe.url('navbar.js')}" defer></script>
<script src="${ovServe.url('footer.js')}" defer></script>
</head>
<body>
<div id="navbar-mount"></div>
<noscript><nav class="ore" style="padding:8px 16px"><a href="/">OpenRestream</a> · <a href="/streams">Streams</a> · <a href="/sessions">Sessions</a> · ${user ? '<a href="/auth/logout">Sign out</a>' : '<a href="/auth/login">Sign in</a>'}</nav></noscript>
<main id="main" class="ore">
${body}
</main>
${footerSsr}
<script>
window.__OV_PAGE = ${JSON.stringify({ navbar: nav, footer: foot }).replace(/</g, '\\u003c')};
document.addEventListener('DOMContentLoaded', function () {
  try { if (window.OpenVibeNavbar) OpenVibeNavbar.init(window.__OV_PAGE.navbar); } catch (e) { /* the Frame is optional */ }
  try { if (window.OpenVibeFooter) OpenVibeFooter.init(window.__OV_PAGE.footer); } catch (e) { /* */ }
});
</script>
</body>
</html>`;
}

module.exports = { renderPage, esc };
