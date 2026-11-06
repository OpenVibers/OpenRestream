'use strict';
/**
 * Browser sign-in for the standalone UI: OAuth2 authorization-code client of OpenVibe.Network
 * (client `openre`, redirect https://openre.stream/auth/callback). The OAuth half is openvibe-sdk/sso's
 * (createSsoClient): the authorize URL, the PKCE S256 pair, the code and refresh grants and GET /auth/health.
 *
 *   GET  /auth/login     → Network /oauth/authorize (state and verifier cookies; ?next= same-site path)
 *   GET  /auth/callback  → state checked in constant time, code exchange server-side, sets ov_token (+ ov_refresh)
 *   GET  /auth/health    → does the Network accept this OAuth client? 503 only when it refuses it
 *   GET  /auth/logout    → clears cookies
 *   GET  /auth/me        → the signed-in user (offline JWT verification)
 *   POST /auth/refresh   → refresh_token grant (the shared navbar calls it)
 */
const crypto = require('crypto');
const express = require('express');
const { createSsoClient, failurePage } = require('openvibe-sdk/sso');

const ACCESS = 'ov_token';
const REFRESH = 'ov_refresh';
const HINT = 'ov_sso_hint';
const STATE = 'ov_oauth_state';
const VERIFIER = 'ov_oauth_verifier';
const NEXT = 'ov_oauth_next';
const SITE_NAME = 'OpenRestream';

/** Compare two strings in constant time (the state must match the browser that started the flow). */
function sameString(a, b) {
    const x = Buffer.from(String(a || ''));
    const y = Buffer.from(String(b || ''));
    return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/**
 * A same-site path, or '/'. An absolute URL on this site's own origin (BASE_URL) counts as its path: the shared navbar's
 * silent sign-in sends the whole page address, and until 2026-10-22 that landed on the home page.
 */
function sanitizeNext(next, config) {
    // Browsers drop tabs and newlines and read \ as /, so "/<TAB>/evil.com" or "/\\evil.com" would leave the site.
    if (typeof next === 'string' && /[\u0000-\u001f\u007f\\]/.test(next)) return '/';
    if (typeof next === 'string' && /^https?:\/\//i.test(next)) {
        let u = null, own = null;
        try { u = new URL(next); own = config && config.baseUrl ? new URL(config.baseUrl).origin : null; } catch { return '/'; }
        if (!own || u.origin !== own) return '/';
        next = `${u.pathname}${u.search}${u.hash}`;
    }
    if (typeof next === 'string' && /^\/(?!\/)/.test(next)) return next;
    return '/';
}

function createSsoRoutes({ config, auth, fetchImpl = globalThis.fetch }) {
    const router = express.Router();
    const sdkSso = createSsoClient({
        site: 'openre',
        siteName: SITE_NAME,
        baseUrl: config.baseUrl,
        clientId: config.oauth.clientId,
        clientSecret: config.oauth.clientSecret,
        redirectUri: config.oauth.redirectUri,
        scope: config.oauth.scope,
        networkUrl: config.networkUrl,
        networkInternalUrl: config.networkInternalUrl,
        secureCookies: config.cookies.secure,
        fetch: fetchImpl,
    });
    const base = { sameSite: 'lax', secure: config.cookies.secure };
    const flow = { ...base, httpOnly: true, path: '/auth', maxAge: 10 * 60 * 1000 };

    function setSession(res, access, refresh) {
        res.cookie(ACCESS, access, { ...base, httpOnly: false, path: '/', maxAge: 24 * 60 * 60 * 1000 });
        if (refresh) res.cookie(REFRESH, refresh, { ...base, httpOnly: true, path: '/auth', maxAge: 30 * 24 * 60 * 60 * 1000 });
        res.cookie(HINT, 'account', { ...base, httpOnly: false, path: '/', maxAge: 365 * 24 * 60 * 60 * 1000 });
    }

    router.get('/login', (req, res) => {
        const started = sdkSso.authorizeUrl();
        res.cookie(STATE, started.state, flow);
        res.cookie(VERIFIER, started.verifier, flow);
        res.cookie(NEXT, sanitizeNext(req.query.next, config), flow);
        res.redirect(started.url);
    });

    router.get('/callback', async (req, res) => {
        const { code, state, error } = req.query;
        const next = sanitizeNext(req.cookies && req.cookies[NEXT], config);
        const expected = req.cookies && req.cookies[STATE];
        const verifier = req.cookies && req.cookies[VERIFIER];
        res.clearCookie(STATE, { path: '/auth' });
        res.clearCookie(VERIFIER, { path: '/auth' });
        res.clearCookie(NEXT, { path: '/auth' });
        if (error) return res.redirect(`/?auth_error=${encodeURIComponent(String(error))}`);
        const retryHref = `/auth/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`;
        const failed = (status, title, text) => res.status(status).type('html').send(failurePage({
            siteName: SITE_NAME, title, text, retryHref, backHref: next || '/',
        }));
        if (!code) return failed(400, 'Sign-in didn\'t finish', 'OpenVibe.Network sent no sign-in code. Start it again; your account is fine.');
        if (!verifier || !sameString(state, expected)) {
            return failed(400, 'Sign-in didn\'t finish', 'It took too long, or it started in another tab or app. Start it again and it will go through; your account is fine.');
        }
        try {
            const data = await sdkSso.tokenGrant({
                grant_type: 'authorization_code', redirect_uri: config.oauth.redirectUri, code: String(code), code_verifier: verifier,
            });
            setSession(res, data.access_token, data.refresh_token);
            // No Clear-Site-Data here or on sign-out: Chrome holds such an answer (and the cookies it sets) until the
            // cache is cleared, which on phones left people on the account chooser with no session (2026-10-28).
            return res.redirect(next);
        } catch (err) {
            if (err.status === 401 || err.error === 'invalid_client' || err.error === 'unauthorized_client') {
                console.error(`[OpenRestream] the Network refuses this site's OAuth client (${err.error || err.status}): check OV_OAUTH_CLIENT_ID / OV_OAUTH_CLIENT_SECRET`);
                return failed(500, 'Sign-in isn\'t working on OpenRestream right now', 'This is a problem on our side, not with your account, and it has been logged. Please try again a little later.');
            }
            if (err.status && err.status < 500) {
                return failed(400, 'Sign-in didn\'t finish', 'OpenVibe.Network did not accept that sign-in code. Start it again; your account is fine.');
            }
            return failed(502, 'OpenVibe.Network didn\'t answer', 'Your account is fine: the sign-in service did not reply in time. Try again in a moment.');
        }
    });

    // GET /auth/health: does the Network accept this site's OAuth client? 503 only when it refuses it.
    router.get('/health', async (_req, res) => {
        const client = await sdkSso.checkClient();
        res.set('Cache-Control', 'no-store');
        return res.status(client === 'invalid' ? 503 : 200).json({ ok: client !== 'invalid', client });
    });

    router.get('/logout', (req, res) => {
        res.clearCookie(ACCESS, { path: '/' });
        res.clearCookie(REFRESH, { path: '/auth' });
        res.cookie(HINT, 'guest', { ...base, httpOnly: false, path: '/', maxAge: 365 * 24 * 60 * 60 * 1000 });
        res.redirect(sanitizeNext(req.query.next, config));
    });

    router.get('/me', async (req, res) => {
        const token = (req.cookies && req.cookies[ACCESS]) || null;
        const claims = token ? await auth.verifyUser(token) : null;
        if (!claims) return res.json({ user: null });   // signed out: 200 with no user (as Blog, Community, Wiki), not a 401 in every signed-out visitor's console
        const { iat, exp, aud, iss, nbf, jti, ...user } = claims;
        return res.json({ user, expires_at: exp ? exp * 1000 : null });
    });

    router.post('/refresh', async (req, res) => {
        const refresh = req.cookies && req.cookies[REFRESH];
        if (!refresh) return res.status(401).json({ error: 'No refresh token' });
        try {
            const data = await sdkSso.tokenGrant({ grant_type: 'refresh_token', refresh_token: refresh });
            setSession(res, data.access_token, data.refresh_token);
            return res.json({ token: data.access_token });
        } catch (err) {
            if (err.status && err.status < 500) return res.status(401).json({ error: 'Refresh token rejected, please sign in again' });
            return res.status(502).json({ error: 'Could not reach OpenVibe.Network' });
        }
    });

    return router;
}

module.exports = { createSsoRoutes, sanitizeNext };
