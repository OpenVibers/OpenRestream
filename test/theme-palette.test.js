'use strict';
// OpenRestream's pages follow the reader's theme. Its palette was a fixed dark one around Shared's themed sections,
// so on a light theme the showcase cards drew white text on white (axe: 1.1:1 on 38 nodes, 2026-11-01). Each
// --ore-* colour is now the theme's token, with the old dark value as the fallback.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'ui', 'layout.js'), 'utf8');
const css = src.slice(src.indexOf('const CSS = `'), src.indexOf('`;', src.indexOf('const CSS = `')));
const root = /:root\{([^}]*)\}/.exec(css);
assert.ok(root, 'the palette is on :root');
const want = { '--ore-bg': '--bg-primary', '--ore-panel': '--bg-secondary', '--ore-line': '--border', '--ore-text': '--text-primary',
    '--ore-muted': '--text-secondary', '--ore-accent': '--accent', '--ore-ok': '--success-text', '--ore-warn': '--warning-text',
    '--ore-bad': '--danger-text', '--ore-field': '--bg-input' };
Object.entries(want).forEach(([name, token]) => {
    assert.ok(new RegExp(`${name}:var\\(${token},#[0-9a-f]{6}\\)`).test(root[1]), `${name} is the theme's ${token}`);
});
// No fixed dark field, link or button colours outside a var() fallback.
const bare = css.replace(/var\([^()]*\)/g, '');
['#0a0f18', '#93c5fd', '#334155'].forEach((c) => assert.ok(!bare.includes(c), `${c} only as a fallback`));
console.log('theme palette: all checks passed');
