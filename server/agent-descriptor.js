'use strict';
// What openre.stream tells an agent about itself (openvibe-shared/agent-layer): /.well-known/agent.json.
// Every field is something this host really serves: the front page and the update log, the JSON API under /api/v1,
// llms.txt and the sitemap. Creating a stream and its keys needs an OpenVibe account (Network OIDC); services call
// the API with a Network client-credentials token. No OpenAPI document, documentation page or MCP endpoint is
// published here, so none is named.
module.exports = {
    id: 'openre',
    name: 'OpenRestream',
    purpose: 'Send one stream from OBS or any RTMP encoder and restream it to Twitch, YouTube, Kick and any RTMP, RTMPS or SRT server at once, with the person\'s OpenVibe Live channel on by default; free and open source, with no follower minimum.',
    home: 'https://openre.stream',
    site: 'openre.stream',
    api: '/api/v1',
    policy: {
        auth: ['none', 'Network OIDC', 'Network service token'],
    },
};
