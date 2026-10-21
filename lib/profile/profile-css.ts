/**
 * Base stylesheet for profile documents, inlined into every document ahead of
 * the owner's custom CSS. Kept as a TS string rather than a .css file read at
 * runtime so it bundles into the route with no fs access.
 */
export const PROFILE_CSS = `
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: Verdana, Arial, sans-serif; font-size: 10px; color: #000; }
a { color: #003399; text-decoration: none; cursor: pointer; }
a:hover { text-decoration: underline; }
button.linkish { background: none; border: 0; padding: 0; font: inherit; color: #003399; cursor: pointer; }
button.linkish:hover { text-decoration: underline; }
.soon { color: #666; cursor: default; }
.online-now { display: inline-flex; align-items: center; gap: 3px; margin: 2px 0; padding: 1px 5px; border: 1px solid #cc5200; border-radius: 4px; background: #ff6600; color: #fff; font-size: 9px; font-weight: bold; line-height: 12px; white-space: nowrap; }
.online-now svg { display: block; }

.profile { display: flex; gap: 10px; padding: 10px; width: 800px; box-sizing: border-box; }
.profile-left { width: 300px; flex: none; }
.profile-right { width: 470px; flex: none; }

.name { font-size: 17px; font-weight: bold; margin: 0 0 4px; overflow-wrap: anywhere; }
.basic { display: flex; gap: 8px; }
.basic-photo { flex: none; width: 150px; }
.basic-info { overflow-wrap: anywhere; }
.photo-main { width: 150px; height: 170px; flex: none; }
img.photo-main, .top8 img, .comment-who img { object-fit: cover; border: 1px solid #999; box-sizing: border-box; display: block; }
.default-photo { background: #ccc; color: #666; border: 1px solid #999; box-sizing: border-box; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 10px; }
.view-my { margin-top: 4px; }

.player { background: #111; color: #ddd; border: 2px solid #444; padding: 6px; margin-top: 8px; font-family: Arial, sans-serif; font-size: 11px; }
.player-controls { display: flex; gap: 4px; align-items: center; margin-top: 4px; }
.player-controls button { font-size: 10px; background: #333; color: #ddd; border: 1px solid #555; padding: 1px 6px; cursor: pointer; }
.player-time { margin-left: auto; color: #aaa; }
.player-bar { height: 6px; background: #333; margin: 4px 0; cursor: pointer; }
.player-bar i { display: block; width: 0; height: 100%; background: #ff9900; }
.player-tracks { list-style: none; margin: 0; padding: 0; }
.player-tracks li { display: flex; align-items: baseline; gap: 6px; border-bottom: 1px solid #333; }
.player-track { display: flex; justify-content: space-between; flex: 1; min-width: 0; background: none; border: 0; color: #ddd; font: inherit; padding: 2px 0; text-align: left; cursor: pointer; }
.player-track:hover { color: #fff; }
.player-track .mark { visibility: hidden; }
.player-track.current { color: #ff9900; }
.player-track.current .mark { visibility: visible; }
.player-report { color: #999; font-size: 9px; text-decoration: none; }
.player-report:hover { color: #ccc; text-decoration: underline; }
.player-pick { color: #ff9900; font-size: 9px; text-decoration: none; }
.player-pick:hover { text-decoration: underline; }
.player-by { color: #aaa; white-space: nowrap; }
.player-by a { color: #ff9900; }

.contact { border: 1px solid #6698cb; margin-top: 8px; }
.contact h5, .details h5 { margin: 0; background: #6698cb; color: #fff; font-size: 10px; padding: 3px 5px; }
.contact table { width: 100%; font-size: 10px; }
.contact td { padding: 3px 5px; }
.profile-url { border: 1px solid #6698cb; margin-top: 8px; padding: 4px; overflow-wrap: anywhere; }
.details { border: 1px solid #6698cb; margin-top: 8px; }
.details table { width: 100%; border-collapse: collapse; font-size: 10px; }
.details td { padding: 3px 5px; vertical-align: top; border-top: 1px solid #fff; overflow-wrap: anywhere; }
.details td.k { background: #b1d0f0; color: #336699; font-weight: bold; width: 90px; }
.details td.v { background: #d5e8fb; }

.extended { border: 1px solid #000; padding: 10px; font-size: 14px; font-weight: bold; text-align: center; margin-bottom: 8px; overflow-wrap: anywhere; }
.section-title { color: #ff6600; font-weight: bold; font-size: 11px; background: #ffcc99; padding: 3px 5px; margin: 8px 0 0; }
.blurb { padding: 6px; border: 1px solid #ffcc99; border-top: none; overflow-wrap: anywhere; }
.shows table { width: 100%; border-collapse: collapse; font-size: 10px; }
.shows td { padding: 3px; border-bottom: 1px solid #eee; }

.top8 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; padding: 6px; border: 1px solid #ffcc99; border-top: none; text-align: center; }
.top8-count { grid-column: 1 / -1; text-align: left; }
.top8-all { grid-column: 1 / -1; text-align: right; }
.top8-friend { overflow-wrap: anywhere; }
.top8 .photo { width: 90px; height: 90px; margin: 0 auto 2px; }

.comments { border: 1px solid #ffcc99; border-top: none; }
.comments-head { padding: 4px; }
.comment { display: flex; border-bottom: 1px solid #fff; }
.comment-who { width: 110px; flex: none; background: #ff9933; padding: 5px; text-align: center; color: #fff; box-sizing: border-box; overflow-wrap: anywhere; }
.comment-who a { color: #fff; }
.comment-who .photo { width: 70px; height: 70px; margin: 2px auto 0; }
.comment-what { flex: 1; min-width: 0; background: #f9d9b9; padding: 5px; overflow-wrap: anywhere; }
.comment-what img, .bulletin img { max-width: 100%; height: auto; }
`;
