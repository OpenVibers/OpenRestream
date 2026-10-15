'use strict';
// ADR-048 amendment 2026-10-15: OpenVibe.Services suspends and resumes a person's restream definition through
// OpenRestream's control API (openre.resource.control, common.owned-resource-control-request@1).
const assert = require('assert');
const contracts = require('openvibe-contracts');
const { bootApi, request, serviceToken, userToken, suite, OWNER, OTHER } = require('./helpers');

const t = suite('resource-control');
const services = serviceToken('services', ['openre.resource.control']);
let api, mine, theirs;
let n = 0;
const send = (body, token = services) => request(api.base, 'POST', '/api/v1/resources/control', { token, body });
const req = (action, over = {}) => ({
    action, owned: { kind: 'openre.stream', id: mine.id }, owner: { type: 'user', id: OWNER },
    on_behalf_of: { type: 'user', id: OWNER }, idempotency_key: `idem_stream_${++n}_${Date.now()}`, ...over,
});
const stateOf = async (id) => (await api.rt.store.definitions.get(id)).state;

t('suspend disables (a dry run first); a repeat answers the first result; resume makes it active', async () => {
    api = await bootApi();
    mine = (await api.rt.store.definitions.create({ owner_subject: OWNER, title: 'My stream' })).definition;
    theirs = (await api.rt.store.definitions.create({ owner_subject: OTHER, title: 'Their stream' })).definition;
    let r = await send(req('suspend', { dry_run: true }));
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual([r.body.state, r.body.result.dry_run], ['done', true]);
    assert.strictEqual(await stateOf(mine.id), 'active');
    const first = req('suspend');
    r = await send(first);
    assert.ok(contracts.resources.checkControlResult(r.body).valid, JSON.stringify(r.body));
    assert.deepStrictEqual([r.body.state, r.body.result, r.body.resource], ['done', { state: 'disabled', changed: true }, undefined]);
    assert.strictEqual(await stateOf(mine.id), 'disabled');
    assert.deepStrictEqual((await send(first)).body, r.body, 'the same key answers the first result');
    const conflict = await send({ ...first, dry_run: true });
    assert.deepStrictEqual([conflict.status, conflict.body.code], [409, 'control.idempotency_conflict']);
    assert.deepStrictEqual((await send(req('suspend'))).body.result, { state: 'disabled', changed: false });
    r = await send(req('resume'));
    assert.deepStrictEqual(r.body.result, { state: 'active', changed: true });
    assert.strictEqual(await stateOf(mine.id), 'active');
});

t('only the owner OpenRestream holds; other actions and kinds are refused', async () => {
    let r = await send(req('suspend', { owned: { kind: 'openre.stream', id: theirs.id } }));
    assert.deepStrictEqual([r.body.state, r.body.problem.code], ['refused', 'resources.unknown_resource'], 'another person\'s stream is not confirmed to exist');
    assert.strictEqual(await stateOf(theirs.id), 'active');
    r = await send(req('delete'));
    assert.strictEqual(r.body.problem.code, 'control.unsupported_action');
    r = await send(req('stop', { owned: { kind: 'openre.session', id: 'ses_x' } }));
    assert.strictEqual(r.body.problem.code, 'resources.unknown_resource');
    r = await send(req('suspend', { on_behalf_of: { type: 'user', id: OTHER } }));
    assert.deepStrictEqual([r.status, r.body.code], [400, 'control.bad_request'], 'a person acts only on what they own');
    r = await send({ action: 'suspend', resource: 'ovrn:openre:prj_01J8ZQ4Y7N3M2K1H0G9F8E7D6C:stream/str_01J8ZQ4Y7N3M2K1H0G9F8E7D6C', project_id: 'prj_01J8ZQ4Y7N3M2K1H0G9F8E7D6C', idempotency_key: 'idem_project_1' });
    assert.deepStrictEqual([r.status, r.body.code], [400, 'control.bad_request'], 'OpenRestream holds no project resources');
});

t('first-party only, with openre.resource.control', async () => {
    let r = await send(req('suspend'), serviceToken('services', ['openre.resource.read']));
    assert.strictEqual(r.status, 403);
    r = await send(req('suspend'), userToken({ subjectId: OWNER }));
    assert.strictEqual(r.status, 403, 'the owner\'s own token goes to the ordinary edit, not here');
    r = await send(req('suspend'), null);
    assert.strictEqual(r.status, 401);
    assert.strictEqual(await stateOf(mine.id), 'active');
    await api.close();
});

t.run();
