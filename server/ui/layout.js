'use strict';
const ovServe = require('openvibe-shared/serve');
const seo = require('openvibe-shared/seo');
const social = require('openvibe-shared/social');
const { TWIN_PATH_RE } = require('../agent-pages');
const { linkHeaderTags } = require('openvibe-shared/agent-layer');
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
/* The reader's theme (theme-loader), with the old dark palette as the fallback: a fixed dark page around Shared's themed
   sections drew white text on white cards on light themes (2026-11-01). */
:root{--ore-bg:var(--bg-primary,#0d131d);--ore-panel:var(--bg-secondary,#141c2b);--ore-line:var(--border,#233049);--ore-text:var(--text-primary,#e6ecf5);--ore-muted:var(--text-secondary,#93a2bd);--ore-accent:var(--accent,#3b82f6);--ore-ok:var(--success-text,#22c55e);--ore-warn:var(--warning-text,#f59e0b);--ore-bad:var(--danger-text,#ef4444);--ore-field:var(--bg-input,#0a0f18)}
body{margin:0;background:var(--ore-bg);color:var(--ore-text);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main.ore{max-width:1040px;margin:0 auto;padding:24px 16px 64px}
main.ore .sc-hero,main.ore .sc-sec,main.ore .sc-cta{padding-left:0;padding-right:0}
.ore h1{font-size:1.6rem;margin:.2em 0 .4em}.ore h2{font-size:1.15rem;margin:1.6em 0 .6em}.ore h3{font-size:1rem;margin:1em 0 .4em}
.ore a{color:color-mix(in srgb,var(--accent,#3b82f6) 60%,var(--text-primary,#e6ecf5))}.ore p.muted,.ore .muted{color:var(--ore-muted)}
.ore .card{background:var(--ore-panel);border:1px solid var(--ore-line);border-radius:10px;padding:14px 16px;margin:12px 0}
.ore-stats{margin:0;display:grid;gap:10px}.ore-stats div{border:1px solid var(--ore-line);border-radius:12px;padding:12px 16px;background:var(--bg-card,#131c2e)}
.ore-stats dt{font-size:1.25rem;font-weight:700}.ore-stats dd{margin:2px 0 0;color:var(--ore-muted);font-size:.92rem}
/* The hero (11-07): the signal flow, one stream in, every platform out, a switch each. */
.ore-hero{display:grid;grid-template-columns:minmax(0,1fr);gap:28px;align-items:center;padding:28px 0 8px}
@media (min-width:900px){.ore-hero{grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:40px;padding:56px 0 16px}}
.ore-eyebrow{margin:0 0 10px;font-size:.78rem;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:color-mix(in srgb,var(--accent,#3b82f6) 70%,var(--ore-text))}
.ore-hero-copy{min-width:0}.ore-hero h1{margin:0;font-size:clamp(2.1rem,6vw,3.6rem);line-height:1.02;letter-spacing:-.045em;text-wrap:balance}
.ore-accent{background:linear-gradient(100deg,#9146FF,#FF0033 45%,#53FC18 90%);-webkit-background-clip:text;background-clip:text;color:transparent}
.ore-lede{margin:16px 0 0;max-width:52ch;font-size:1.06rem;line-height:1.6;color:var(--ore-muted)}
.ore-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
.ore-btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 20px;border-radius:14px;border:1px solid var(--ore-line);color:var(--ore-text)!important;font-weight:750;text-decoration:none;transition:transform .15s,border-color .15s}
.ore-btn:hover{border-color:color-mix(in srgb,var(--accent,#3b82f6) 55%,var(--ore-line));transform:translateY(-1px)}
.ore-btn-primary{background:var(--accent,#3b82f6);border-color:transparent;color:var(--on-accent,#fff)!important;box-shadow:0 12px 30px -14px var(--accent,#3b82f6)}
.ore-note{margin:14px 0 0;font-size:.86rem;color:var(--ore-muted)}
.ore-flow{position:relative;display:grid;grid-template-columns:minmax(0,104px) 22px minmax(0,118px) minmax(230px,1fr);align-items:center;gap:0;padding:22px;border:1px solid var(--ore-line);border-radius:24px;background:radial-gradient(120% 120% at 0% 50%,color-mix(in srgb,var(--accent,#3b82f6) 14%,transparent),transparent 60%),var(--ore-panel);counter-reset:ore-on}
.ore-src,.ore-hub{display:grid;justify-items:center;gap:3px;text-align:center;padding:12px 8px;border-radius:18px;background:var(--ore-bg);border:1px solid var(--ore-line);min-width:0}
.ore-src b,.ore-hub b{font-size:.84rem;letter-spacing:-.01em}.ore-src small,.ore-hub small{font-size:.72rem;color:var(--ore-muted);max-width:12ch}
.ore-src-dot{width:12px;height:12px;border-radius:50%;background:#ef4444;box-shadow:0 0 0 0 rgba(239,68,68,.6);animation:ore-rec 1.6s ease-out infinite}
@keyframes ore-rec{70%{box-shadow:0 0 0 10px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
.ore-trunk{height:3px;background:repeating-linear-gradient(90deg,var(--accent,#3b82f6) 0 10px,transparent 10px 22px);background-size:44px 3px;animation:ore-flow 1s linear infinite;border-radius:2px}
.ore-hub{position:relative;border-color:color-mix(in srgb,var(--accent,#3b82f6) 45%,var(--ore-line))}
.ore-hub-ring{width:30px;height:30px;border-radius:50%;border:3px solid var(--accent,#3b82f6);box-shadow:0 0 18px color-mix(in srgb,var(--accent,#3b82f6) 60%,transparent)}
.ore-n::before{content:counter(ore-on)}
.ore-total{margin:0;font-size:.78rem;font-weight:700;color:var(--ore-muted);text-align:center;max-width:14ch}
@media (min-width:641px){.ore-src{grid-column:1;grid-row:1/3}.ore-trunk{grid-column:2;grid-row:1/3}.ore-hub{grid-column:3;grid-row:1;align-self:end}.ore-total{grid-column:3;grid-row:2;align-self:start;justify-self:center;margin-top:8px}.ore-dests{grid-column:4;grid-row:1/3;padding-left:6px}}
.ore-n{color:var(--ore-text);font-weight:900}
.ore-dests{list-style:none;margin:0;padding:0 0 0 0;display:grid;gap:6px}
.ore .ore-dest label{margin:0;color:inherit;font-size:inherit;position:relative;display:grid;grid-template-columns:26px 26px minmax(0,1fr) auto;align-items:center;gap:10px;min-height:42px;padding:0 10px 0 0;border-radius:12px;cursor:pointer}
.ore-dest-in{position:absolute;opacity:0;pointer-events:none}
.ore-dest:has(.ore-dest-in:checked){counter-increment:ore-on}
.ore-wire{height:3px;border-radius:2px;background:color-mix(in srgb,var(--ore-text) 14%,transparent)}
.ore-dest:has(.ore-dest-in:checked) .ore-wire{background:repeating-linear-gradient(90deg,var(--c) 0 8px,transparent 8px 18px);background-size:36px 3px;animation:ore-flow .9s linear infinite;animation-delay:calc(var(--i) * -.13s)}
@keyframes ore-flow{to{background-position:36px 0}}
.ore-dest-mark{display:grid;place-items:center;width:26px;height:26px;color:var(--c)}
.ore-dest-mark svg{width:24px;height:24px}
.ore-dest-ov{font-size:.72rem;font-weight:900;color:var(--accent,#3b82f6)}
.ore-dest-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700;font-size:.95rem;color:var(--ore-muted);transition:color .2s}
.ore-dest:has(.ore-dest-in:checked) .ore-dest-name{color:var(--ore-text)}
.ore-dest:not(:has(.ore-dest-in:checked)) .ore-dest-mark{filter:grayscale(1);opacity:.5}
.ore-switch{position:relative;width:38px;height:22px;border-radius:999px;background:color-mix(in srgb,var(--ore-text) 18%,transparent);transition:background-color .2s}
.ore-switch::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s cubic-bezier(.2,1.4,.4,1)}
.ore-dest:has(.ore-dest-in:checked) .ore-switch{background:var(--c)}
.ore-dest-own:has(.ore-dest-in:checked) .ore-switch{background:var(--accent,#3b82f6)}
.ore-dest:has(.ore-dest-in:checked) .ore-switch::after{transform:translateX(16px)}
.ore .ore-dest:has(.ore-dest-in:focus-visible) label{outline:2px solid var(--accent,#3b82f6);outline-offset:2px}
.ore .ore-dest label:hover{background:color-mix(in srgb,var(--ore-text) 5%,transparent)}
/* A phone: top to bottom (stream, then OpenRestream, then the switches), the wires short and to the left. */
@media (max-width:640px){.ore-flow{grid-template-columns:1fr;justify-items:stretch;padding:16px;gap:0}.ore-src,.ore-hub{justify-self:center;grid-auto-flow:row}.ore-total{order:3;grid-column:1;grid-row:auto;justify-self:center;margin:10px 0 0}.ore-dests{order:4}.ore .ore-flow .ore-dest label{grid-template-columns:18px 26px minmax(0,1fr) auto;min-height:46px}.ore-trunk{justify-self:center;width:3px;height:22px;background:repeating-linear-gradient(180deg,var(--accent,#3b82f6) 0 8px,transparent 8px 16px);background-size:3px 32px;animation:ore-flow-v 1s linear infinite}.ore-dests{margin-top:12px}.ore-dest label{grid-template-columns:18px 26px minmax(0,1fr) auto;min-height:46px}}
@keyframes ore-flow-v{to{background-position:0 32px}}
.ore-logos{display:none;list-style:none;margin:14px 0 0;padding:0;gap:14px;align-items:center}.ore-logos li{display:grid;place-items:center;width:28px;height:28px;color:var(--c)}.ore-logos svg{width:26px;height:26px}.ore-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media (max-width:640px){.ore-logos{display:flex}.ore-logos li:nth-child(3){width:44px}.ore-logos li:nth-child(3) svg{width:44px}}
.ore-stats-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));margin:18px 0 6px}
@media (prefers-reduced-motion:reduce){.ore-src-dot,.ore-trunk,.ore-dest .ore-wire{animation:none!important}}
.ore-tier-grid{margin:14px 0 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:1px;border:1px solid var(--ore-line);border-radius:14px;overflow:hidden;background:var(--ore-line)}
.ore-tier-grid div{padding:12px 16px;background:var(--bg-card,#131c2e)}.ore-tier-grid dt{font-size:.74rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ore-muted)}
.ore-tier-grid dd{margin:4px 0 0;font-size:.95rem;line-height:1.45}
.ore-faq details{border-bottom:1px solid var(--ore-line);padding:.75rem 0}.ore-faq details:first-of-type{border-top:1px solid var(--ore-line)}
.ore-faq summary{cursor:pointer;font-weight:600;list-style-position:inside}.ore-faq summary:hover{color:color-mix(in srgb,var(--accent,#3b82f6) 60%,var(--text-primary,#e6ecf5))}.ore-faq details p{margin:.5rem 0 0;color:var(--ore-muted);max-width:46rem}
.ore table{width:100%;border-collapse:collapse;font-size:.92rem}.ore th,.ore td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--ore-line);vertical-align:top}
.ore code,.ore .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88rem;word-break:break-all}
.ore .secret{display:block;background:var(--ore-field);border:1px dashed var(--ore-warn);padding:10px;border-radius:8px;user-select:all}
.ore form.inline{display:inline}.ore label{display:block;margin:.4em 0 .15em;color:var(--ore-muted);font-size:.88rem}
.ore input[type=text],.ore input[type=password],.ore input[type=number],.ore select,.ore textarea{width:100%;box-sizing:border-box;background:var(--ore-field);color:var(--ore-text);border:1px solid var(--ore-line);border-radius:6px;padding:7px 9px}
.ore .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
:where(.ore) button{background:var(--accent-strong,#3472d8);color:var(--on-accent-strong,#fff);border:0;border-radius:6px;padding:7px 12px;cursor:pointer;font-weight:600;margin:6px 6px 0 0}
:where(.ore) button.secondary{background:var(--bg-tertiary,#334155);color:var(--ore-text)}:where(.ore) button.danger{background:#dc2626;color:#fff}
.ore .pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:.8rem;font-weight:600;background:var(--bg-tertiary,#334155)}
.ore .pill.live,.ore .pill.ok{background:#22c55e;color:#04110a}.ore .pill.starting,.ore .pill.ending,.ore .pill.pending,.ore .pill.error,.ore .pill.draining{background:#f59e0b;color:#1a1000}
.ore .pill.failed,.ore .pill.lost{background:#b91c1c;color:#fff}
.ore .flash{border-left:4px solid var(--ore-accent);padding:8px 12px;background:var(--ore-panel);margin:12px 0}.ore .flash.bad{border-color:var(--ore-bad)}
.ore .ore-choice{border:0;padding:0;margin:.4em 0 .7em}.ore .ore-choice legend{color:var(--ore-muted);font-size:.88rem;padding:0;margin-bottom:.35em}
.ore .ore-options{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))}
.ore .ore-option{display:flex;gap:10px;align-items:flex-start;margin:0;padding:10px 12px;border:1px solid var(--ore-line);border-radius:8px;background:var(--ore-field);color:var(--ore-text);font-size:.95rem;cursor:pointer}
.ore .ore-option:has(input:checked){border-color:var(--ore-accent);box-shadow:inset 0 0 0 1px var(--ore-accent)}.ore .ore-option:has(input:focus-visible){outline:2px solid var(--ore-accent);outline-offset:2px}
.ore .ore-option input{margin:.3em 0 0;accent-color:var(--ore-accent);flex:none}.ore .ore-option strong{display:block}.ore .ore-option .muted{display:block;font-size:.86rem;margin-top:2px}
.ore .nf-links{list-style:none;margin:22px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:10px}
.ore .nf-links a{display:inline-block;padding:9px 16px;border-radius:999px;border:1px solid var(--ore-line);background:var(--ore-panel);color:var(--ore-text);text-decoration:none;font-weight:600}
.ore .nf-links a:hover,.ore .nf-links a:focus-visible{border-color:var(--ore-accent);outline:0}
.ore form:has(input[name=record_to][value=videos]:checked) .ore-live-only{display:none}
.ore .ovk-page-head h1{margin:0}.ore .ovk-page-head a,.ore .ovk-btn,.ore .ovk-icon-btn{color:inherit;text-decoration:none}
.ore .ovk-btn--primary{color:var(--on-accent-strong,#fff)}
.ore-session-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px}
.ore-session-card{padding:20px;background:var(--ore-panel);border:1px solid var(--ore-line);border-radius:20px;min-width:0}
.ore-session-card h2{margin:14px 0 4px;font-size:1.2rem}.ore-session-card h2 a{color:var(--ore-text);text-decoration:none}
.ore-session-top{display:flex;justify-content:space-between;align-items:center}
.ore-session-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:20px 0}
.ore-session-metrics dt{font-size:.8rem;color:var(--ore-muted)}.ore-session-metrics dd{margin:4px 0 0;font-weight:650;overflow-wrap:anywhere}
.ore-session-destinations{display:flex;gap:8px;overflow:auto;position:relative;padding-bottom:8px}
.ore-platform{display:inline-flex;align-items:center;gap:7px;white-space:nowrap;border-radius:999px;background:var(--bg-secondary);padding:6px 10px;font-size:.85rem}
.ore-platform svg{width:20px;height:20px;flex:none}
.ore-session-actions{display:flex;justify-content:flex-end;margin-top:12px}
.ore-scope{display:flex;width:fit-content;gap:4px;padding:4px;border-radius:999px;background:var(--bg-secondary);border:1px solid var(--ore-line);margin-bottom:20px}
.ore-scope a{display:flex;align-items:center;justify-content:center;min-height:44px;min-width:90px;border-radius:999px;color:var(--ore-muted);text-decoration:none}
.ore-scope a[aria-current]{background:var(--ore-panel);color:var(--ore-text);box-shadow:0 2px 8px #0002}
.ore-how{text-align:center}.ore-how a{display:inline-flex;align-items:center;min-height:44px}
.ore :where(button,input,select){min-height:44px}.ore input[type=checkbox],.ore input[type=radio]{min-height:auto}
.ore table{display:block;overflow-x:auto;position:relative}.ore .ovk-sheet{color:var(--ore-text)}
@media(min-width:1000px){main.ore{padding-top:36px}}
@media(max-width:760px){main.ore{padding-top:16px}.ore-session-card{padding:16px}.ore .ovk-heading-icon{flex-shrink:0}}

/* Touch targets on phones (fleet audit, 2026-10-29): touch pointers only. */
@media (pointer: coarse) {
  .ore-faq summary { min-height: 44px; }
}

`;

const DESCRIPTION = 'OpenRestream: go live once from OBS and restream to Twitch, YouTube, Kick and any RTMP or SRT server at once, with OpenVibe Live on by default.';

function renderPage({ title, body, user, canonicalPath = '/', robots = 'noindex,nofollow', config, description = DESCRIPTION, styles = [], jsonLd = null }) {
    // A title that already names the site is not suffixed again ("What shipped on OpenRestream · OpenRestream").
    const pageTitle = title ? (title.includes(SITE) ? title : `${title} · ${SITE}`) : `${SITE} — go live once, stream everywhere`;
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
    // A public page names its Markdown twin (openvibe-shared/agent-layer); a signed-in owner page has none.
    const twinHead = TWIN_PATH_RE.test(canonicalPath.split('?')[0]) ? linkHeaderTags(canonical, '/llms.txt').head : '';
    const nav = {
        service: 'openre',
        apiBase: NETWORK_URL,
        // The two places, with icons (the owner, 2026-10-28: navbars that say what matters at a glance).
        links: [
            { label: 'Streams', href: '/streams', icon: 'fa-tower-broadcast' },
            { label: 'Sessions', href: '/sessions', icon: 'fa-clock-rotate-left' },
            { label: 'Destinations', href: '/destinations', icon: 'fa-satellite-dish' },
            { label: 'Go live', href: '/go-live', icon: 'fa-circle-play' },
            { label: 'You', href: '/settings', icon: 'fa-user' },
        ],
        appBar: true,
        sessionUrl: '/auth/me',
        silentLogin: '/auth/login?silent=1&next={url}',
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
${twinHead}
${icon}
<script src="${ovServe.url('theme-loader.js')}" defer></script>
<style>${CSS}</style>
<!-- The shared showcase stylesheet on every page, not only the home: inner pages use its buttons (sc-btn), and without it a sign-in button drew as a bare link (phone sweep, 2026-11-01). It is scoped to its own sc- classes. -->
${[...new Set(['showcase.css', 'kit.css', 'kit-data.css', ...styles])].map((name) => `<link rel="stylesheet" href="${esc(ovServe.url(name))}">`).join('\n')}
<script src="${ovServe.url('navbar.js')}" defer></script>
<script src="${ovServe.url('kit-web.js')}" defer></script>
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
