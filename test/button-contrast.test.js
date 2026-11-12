'use strict';
// The filled button reads at AA: white on the strong accent (#2563eb, 5.2:1), not on the light accent (#3b82f6, 3.7:1),
// which the release browser check's axe run failed as serious (color-contrast) on the home page (11-12).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'server', 'ui', 'layout.js'), 'utf8');
const rule = (css.match(/\.ore-btn-primary\{[^}]*\}/) || [''])[0];
assert.match(rule, /background:var\(--accent-strong,#2563eb\)/, 'the strong accent behind the text');
assert.match(rule, /color:var\(--on-accent-strong,#fff\)/, 'its own text colour');
console.log('button contrast: the filled button is white on the strong accent');
