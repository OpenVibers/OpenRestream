'use strict';
/**
 * OpenRestream's control API for person-owned restream definitions (ADR-048 amendment 2026-10-15, step 8 phase 2;
 * capability openre.resource.control): POST /api/v1/resources/control takes one common.owned-resource-control-request@1
 * from a first-party service (OpenVibe.Services) naming an openre.stream by its definition id and its owner, and
 * answers a common.resource-control-result@1 (200 for every outcome, without `resource`: definitions have no OVRN; a
 * malformed request is a 400 problem).
 *
 *   suspend   state disabled, as the owner's edit does: new ingest is refused (stream_disabled); a session already
 *             live keeps going until it ends
 *   resume    state active again
 *
 * Any other action is refused `control.unsupported_action`. Only the owner OpenRestream holds may be named: a definition
 * of another person (or an archived one) is refused as unknown, never confirmed to exist. dry_run decides and explains
 * without applying. The first answer per (caller, idempotency_key) is kept in openre_control_log and returned for a
 * repeat; the same key with another request is refused `control.idempotency_conflict`.
 */
const crypto = require('crypto');
const express = require('express');
const contracts = require('openvibe-contracts');

const CAPABILITY = 'openre.resource.control';
const KIND = 'openre.stream';
const TARGET = { suspend: 'disabled', resume: 'active' };

function canonical(v) {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
    return JSON.stringify(v);
}
const digestOf = (request) => crypto.createHash('sha256')
    .update(canonical({ ...request, idempotency_key: undefined, confirmation_id: undefined, trace_id: undefined })).digest('hex');

function router({ db, store, guard, now = () => Date.now() }) {
    const r = express.Router();
    const problemOf = (status, code, detail) => ({ type: `https://openvibe.network/problems/${code}`, title: code, status, code, detail });
    const send = (req, res, status, code, detail) => contracts.http.sendProblem(res, status, code, { detail, ctx: req.ov });
    const result = (request, state, extra = {}) => ({ action: request.action, state, at: new Date(now()).toISOString(), ...extra });

    async function decide(request) {
        if (request.owned.kind !== KIND) return result(request, 'refused', { problem: problemOf(404, 'resources.unknown_resource', `no stream ${request.owned.kind} ${request.owned.id}`) });
        if (!(request.action in TARGET)) return result(request, 'refused', { problem: problemOf(422, 'control.unsupported_action', `a stream takes suspend and resume, not ${request.action}`) });
        const d = await store.definitions.get(request.owned.id);
        if (!d || d.state === 'archived' || d.owner_subject !== request.owner.id) {
            return result(request, 'refused', { problem: problemOf(404, 'resources.unknown_resource', `no stream ${request.owned.id} of this person`) });
        }
        const target = TARGET[request.action];
        if (d.state === target) return result(request, 'done', { result: { state: d.state, changed: false } });
        if (request.dry_run) return result(request, 'done', { result: { dry_run: true, would: `make the stream ${target}` } });
        const updated = await store.definitions.update(d.id, { state: target });
        return result(request, 'done', { result: { state: updated.state, changed: true } });
    }

    // First-party only: the shared guard lets owners through on ordinary routes; control needs a service.
    r.use((req, res, next) => {
        const caller = req.caller || { kind: 'anonymous' };
        if (caller.kind === 'service' && /^svc:/.test(String(caller.sub || ''))) return next();
        if (caller.kind === 'anonymous') return send(req, res, 401, 'token.missing', 'call with a service token');
        return send(req, res, 403, 'capability.denied', `${CAPABILITY} is first-party and requires a service token`);
    });
    r.post('/', guard, express.json({ limit: '16kb' }), async (req, res, next) => {
        try {
            const request = req.body;
            if (!request || typeof request !== 'object' || request.owned === undefined) {
                // OpenRestream holds no project resources: a project-scoped request names nothing here.
                return send(req, res, 400, 'control.bad_request', 'restream definitions are person-owned: send common.owned-resource-control-request@1');
            }
            const check = contracts.resources.checkControlRequest(request);
            if (!check.valid) return send(req, res, 400, 'control.bad_request', JSON.stringify(check.errors).slice(0, 500));
            const caller = req.caller.sub;
            const digest = digestOf(request);
            const seen = await db.prepare('SELECT digest, response FROM openre_control_log WHERE caller = ? AND idempotency_key = ?').get(caller, request.idempotency_key);
            if (seen) {
                if (seen.digest !== digest) return send(req, res, 409, 'control.idempotency_conflict', 'this idempotency_key was used for another request');
                return res.json(typeof seen.response === 'string' ? JSON.parse(seen.response) : seen.response);
            }
            const answer = await decide(request);
            await db.prepare(`INSERT INTO openre_control_log (caller, idempotency_key, owner_subject, digest, response, created_at)
                VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(caller, request.idempotency_key, request.owner.id, digest, JSON.stringify(answer), now());
            return res.json(answer);
        } catch (err) { return next(err); }
    });
    return r;
}

module.exports = { router, CAPABILITY, digestOf };
