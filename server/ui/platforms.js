'use strict';
// Where OpenRestream streams to, with each platform's mark: Font Awesome Free 6 brand glyphs (CC BY 4.0,
// https://fontawesome.com/license/free), extracted to path data; Kick has no Font Awesome glyph, so it is its word in
// its green. The marks only say which service a destination is (nominative use); OpenRestream is not affiliated with
// any of them.
const MARKS = {
    'twitch': { w: 512, d: "M391 103H353H391H353V213H391ZM285 103H246H285H246V213H285ZM121 0 24 91 121 0 24 91V421H140V512L237 421H314L488 256V0ZM449 238 372 311 449 238 372 311H295L227 375V311H140V37H449Z" },
    'youtube': { w: 576, d: "M550 124Q538 87 501 75Q477 70 427 67Q377 65 334 64Q291 64 288 64Q285 64 242 64Q199 65 149 67Q99 70 75 75Q38 87 26 124Q21 147 18 177Q16 208 15 232Q15 255 15 256Q15 258 15 281Q16 305 18 335Q21 366 26 389Q38 426 75 437Q99 442 149 445Q199 447 242 448Q285 448 288 448Q288 448 288 448Q291 448 334 448Q377 447 427 445Q477 442 501 437Q538 426 550 389Q555 366 558 335Q560 305 561 281Q561 258 561 256Q561 255 561 232Q560 208 558 177Q555 147 550 124ZM232 338V175V338V175L375 256L232 338Z" },
    'facebook': { w: 512, d: "M512 256Q511 184 477 127Q443 69 385 35Q328 1 256 0Q184 1 127 35Q69 69 35 127Q1 184 0 256Q2 348 55 415Q109 482 194 505V334H141V256H194V222Q193 93 319 95Q332 95 349 97Q365 99 375 101V172Q365 171 345 171Q314 171 300 184Q287 198 287 228V256H371L356 334H287V510Q384 496 447 426Q510 356 512 256Z" },
    'x-twitter': { w: 512, d: "M389 48H460H389H460L306 224L487 464H345L234 319L107 464H36L201 276L27 48H172L273 181L389 48ZM364 422H404H364H404L151 88H109L364 422Z" },
    'tiktok': { w: 448, d: "M448 210Q380 210 325 171V349Q325 401 296 442Q268 483 220 502Q171 519 123 507Q75 495 40 456Q7 417 1 367Q-4 318 20 272Q45 227 89 204Q134 182 185 188V278Q161 271 139 279Q117 286 102 306Q88 326 88 350Q88 373 102 394Q117 413 140 420Q162 428 186 420Q209 412 223 393Q237 374 237 349V0H325Q325 11 327 22Q338 73 381 102Q412 122 448 123Z" },
    'linkedin': { w: 448, d: "M416 32H32H416H32Q18 32 9 41Q0 51 0 64V448Q0 461 9 471Q18 480 32 480H416Q430 480 439 471Q448 461 448 448V64Q448 51 439 41Q430 32 416 32ZM135 416H69H135H69V202H136V416ZM102 173Q86 173 75 162Q64 151 64 135Q64 118 75 107Q86 96 102 96Q119 96 129 107Q140 118 141 135Q140 151 129 162Q119 173 102 173ZM384 416H318H384H318V312Q319 292 313 274Q308 257 283 255Q258 256 250 272Q243 288 244 310V416H177V202H241V231H242Q248 218 264 208Q280 197 305 197Q354 198 370 226Q386 255 384 299V416Z" },
};
const PLATFORMS = [
    { id: 'twitch', name: 'Twitch', color: '#9146FF', mark: 'twitch' },
    { id: 'youtube', name: 'YouTube', color: '#FF0033', mark: 'youtube' },
    { id: 'kick', name: 'Kick', color: '#53FC18', mark: null },
    { id: 'x', name: 'X', color: '#E7E9EA', mark: 'x-twitter' },
    { id: 'facebook', name: 'Facebook', color: '#1877F2', mark: 'facebook' },
    { id: 'tiktok', name: 'TikTok', color: '#FE2C55', mark: 'tiktok' },
    { id: 'linkedin', name: 'LinkedIn', color: '#0A66C2', mark: 'linkedin' },
];
/** A platform's mark as inline SVG (currentColor), or its word for Kick. */
function markSvg(p) {
    const m = p.mark && MARKS[p.mark];
    if (!m) return `<svg viewBox="0 0 120 40" aria-hidden="true" focusable="false"><text x="60" y="30" text-anchor="middle" font-family="system-ui,sans-serif" font-size="30" font-weight="900" letter-spacing="-1" fill="currentColor">KICK</text></svg>`;
    return `<svg viewBox="0 0 ${m.w} 512" aria-hidden="true" focusable="false"><path fill="currentColor" d="${m.d}"/></svg>`;
}
module.exports = { PLATFORMS, MARKS, markSvg };
