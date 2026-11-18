'use strict';
// A live thumbnail is uploaded to Media as an object of kind 'thumbnail' (workers/thumbnails.js publish). Media's object
// kinds are vod, clip, file, thumbnail, screenshot, avatar and asset; 'image' was refused, so every OpenRestream session
// had no picture (production log 2026-11-18: "upload failed: kind must be one of vod, clip, file, thumbnail, …").
const assert = require('assert');
const { createThumbnailer } = require('../workers/thumbnails');

(async () => {
    const uploads = [];
    const media = { configured: true, uploadObject: async (o) => { uploads.push(o); return { url: 'https://openvibe.media/o/abc.jpg' }; } };
    const config = { webrtc: { thumbnails: { enabled: true, namespace: 'live', width: 640 } }, outputs: { ffmpegPath: 'ffmpeg' } };
    const t = createThumbnailer({ config, media, log: { warn() {} } });
    const set = [];
    const store = { sessions: { setThumbnail: async (id, url) => { set.push([id, url]); } } };
    const url = await t.publish(store, 'ses_x', Buffer.alloc(3000));
    assert.strictEqual(url, 'https://openvibe.media/o/abc.jpg');
    assert.strictEqual(uploads[0].kind, 'thumbnail', 'a kind Media accepts');
    assert.deepStrictEqual([uploads[0].namespace, uploads[0].visibility, uploads[0].mimeType], ['live', 'public', 'image/jpeg']);
    assert.deepStrictEqual(set, [['ses_x', 'https://openvibe.media/o/abc.jpg']]);
    console.log('thumbnails-kind: a live thumbnail is a Media thumbnail object');
})().catch((e) => { console.error(e); process.exit(1); });
