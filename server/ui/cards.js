'use strict';
const kit = require('openvibe-shared/kit');
const { PLATFORMS, markSvg } = require('./platforms');
const esc = kit.esc;
const emptySessions = () => kit.empty({ icon: 'clock', title: 'Your next broadcast starts here', text: 'Your restream sessions show here: each time you go live, where it went and how it did', action: { href: '/go-live', label: 'Go live', icon: 'live' } }) + '<p class="ore-how"><a href="/#how-it-works">How restreaming works</a></p>';
const emptyStreams = () => kit.empty({ icon: 'live', title: 'One stream, every destination', text: 'Create a stream, connect your destinations and go live from your encoder.', action: { href: '/streams#new-stream', label: 'Create a stream', icon: 'plus' } });
function platform(id) {
    const p = PLATFORMS.find(p => p.id === id);
    return `<span class="ore-platform">${p ? markSvg(p) : kit.icon('link')}<span>${esc(p ? p.name : id || 'Destination')}</span></span>`;
}
function scope(all) {
    return `<nav class="ore-scope" aria-label="Session owner"><a href="/sessions"${!all ? ' aria-current="page"' : ''}>Mine</a><a href="/sessions?all=1"${all ? ' aria-current="page"' : ''}>Everyone</a></nav>`;
}
function session(s, definition, outputs = [], destinations = []) {
    const started = new Date(s.live_at || s.created_at);
    const valid = Number.isFinite(started.getTime());
    const running = ['starting', 'live', 'ending'].includes(s.state);
    const minutes = valid && s.ended_at ? Math.max(0, Math.round((Number(s.ended_at) - started.getTime()) / 60000)) : null;
    const length = minutes == null ? (running ? 'In progress' : 'Unavailable') : minutes < 1 ? 'Under a minute' : `${Math.floor(minutes / 60) ? Math.floor(minutes / 60) + 'h ' : ''}${minutes % 60}m`;
    const health = outputs.some(o => o.last_error || ['failed', 'error', 'lost'].includes(o.state)) ? 'Needs attention' : outputs.length ? (running ? 'Delivering' : 'Finished') : 'No output data';
    const title = definition && definition.title || 'Restream session';
    const sid = 'session-' + s.id;
    // Viewers only while it runs and someone is watching here (OpenRestream's own players); the destinations report no
    // totals, so an ended card never shows a number it does not have (the sheet says why).
    const watching = running && Number(s.viewers) > 0 ? `<div><dt>Watching here</dt><dd>${esc(String(Number(s.viewers)))}</dd></div>` : '';
    const metrics = `<dl class="ore-session-metrics"><div><dt>Length</dt><dd>${esc(length)}</dd></div><div><dt>Health</dt><dd>${esc(health)}</dd></div>${watching}</dl>`;
    const marks = `<div class="ore-session-destinations" data-ovk-scroll aria-label="Destinations">${destinations.filter(Boolean).map(d => platform(d.platform)).join('') || '<span class="muted">No destinations recorded</span>'}</div>`;
    const when = valid ? `<time datetime="${started.toISOString()}">${esc(started.toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))} UTC</time>` : 'Start unavailable';
    const details = `<p>${when}</p>${metrics}${marks}<p class="muted">Viewer totals are not reported by these destinations.</p>` + kit.button({ href: '/sessions/' + s.id, icon: 'clock', label: 'Full session details', kind: 'quiet' });
    return `<article class="ore-session-card"><div class="ore-session-top"><span class="ovk-heading-icon">${kit.icon('live')}</span>${kit.badge(s.state, running ? 'live' : '')}</div><h2><a href="/sessions/${esc(s.id)}">${esc(title)}</a></h2><p class="muted">${when}</p>${metrics}${marks}<div class="ore-session-actions">${kit.sheetButton({ sheet: sid, icon: 'list', label: 'Session details', iconOnly: false })}</div>${kit.sheet({ id: sid, title, body: details })}</article>`;
}
module.exports = { emptySessions, emptyStreams, platform, scope, session };
