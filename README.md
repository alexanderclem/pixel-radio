# Pixel Radio

A pixel world receiver with live internet radio, station search, generated ambience,
weather, and CRT controls. Built with React, TypeScript, Vite, Zustand, Web Audio,
and hls.js. No backend or API keys are required.

## Studying and getting around

- **Focus timer.** The Focus module runs a Pomodoro clock: 25/5, 50/10, 90/20 or custom
  minutes, with a long break after every fourth session. It plays a soft chime at each phase
  change, lowers the radio during breaks (Quiet breaks) and can send desktop notifications.
  The countdown also shows in the tab title. Phases are stored as wall-clock end times, so a
  background tab doesn't drift.
- **Focus mode** (`F`) hides the deck. All that's left is the map and a bar with the timer,
  what's playing, volume and Exit. Focus mode always turns Calm on.
- **Calm** (Sky & Screen) turns off CRT flicker and chromatic aberration, halves the
  scanlines and weather, stops lightning flashes and thunder, and holds map markers and
  LCD text still. Calm starts on when the OS asks for reduced motion. The default effects
  are already gentler than before.
- **Favorites and recents.** Star the playing station (☆ on the display or `S`). Played
  stations are added to Recent automatically. Both are in the Stations drawer (`D`).
- **Find the playing station.** Use the crosshair map button, press `L`, or click the
  location line on the display.
- **Compact deck.** By default the deck shows only the tuner, the timer and volume, so the
  map gets most of the screen. *All controls* (or `C`) opens the mixer, atmosphere and screen
  panels. Station search lives in the header.
- **Station markers.** A `((•))` glyph is one station; a numbered badge is a group of nearby
  stations. Clicking a badge plays its most popular station and zooms in.
- **Song titles.** When a station announces what it's playing, the song shows on the display,
  the Focus bar, the map label and your device's media controls. Sources, best first: titles
  inside HLS streams; the station's Icecast status page, when it allows cross-origin reads;
  the friends Worker reading the stream's ICY metadata server-side (needs
  `VITE_PRESENCE_URL`); and Radio Paradise's API for the built-in fallback stations. Talk
  stations and stations that don't publish titles show the station name only.
- **Avatars** (`A`). Build a pixel walker from swappable heads, hats, shirts, pants and
  shoes. It travels across the map to whatever station you tune to, and friends' avatars
  travel to theirs. Short trips are walked. Water narrower than 25° is crossed in a rowing
  boat: walk to the coast, row across, walk on. Trips longer than 70° (or over wider oceans)
  fly, by prop plane or, about one time in four, hot-air balloon. Planes and balloons take
  their colours from the rider's shirt.
- **Unlocks.** Milestones earn extra parts: row across water 3 times (Captain hat), fly 3
  times (Aviator cap), ride a balloon (Sky tee), finish 10 focus sessions (Grad cap), listen
  in 10 countries (Explorer helmet), play 50 different stations (Gold cans) and have 3
  friends (Party hat). Progress is listed under the avatar editor. Unlocks are cosmetic and
  counted on your devices only; the server stores them for accounts but doesn't check them.
- **Keyboard shortcuts.** Press `?` for the full list: `N`/`B` next/previous station,
  `1`–`0` city presets, `/` search, `M` mute, `H` world view, `T` start/pause the timer,
  `G` friends, `A` avatar, `U` account, `C` all controls, `Esc` close.
- Settings (mix, screen effects, weather/sky, timer lengths, favorites, privacy
  switches, avatar, unlocks, deck size) are kept in localStorage. Playback and timer state
  are not. An optional account (below) also keeps favorites, recents, avatar, unlocks and
  friends on the server, so they follow you between devices.

## Friends

Friends (`G`) shows who is online, what they're tuned to, and whether they're focusing or
on a break. Each friend's avatar walks to the station they're playing, and the list shows
the song when the station announces one. Click their avatar, or Tune in, to listen along.

- No sign-up is needed. Choosing a nickname creates a profile on this device with a friend
  code like `PR-7K3Q-9XZT`. Adding someone's code is mutual and immediate. The bearer token
  stays in this browser's localStorage, and clearing site data loses the profile unless it's
  been saved to an account.
- Friends see your nickname, your avatar, the station you're playing (name, song, place
  and catalogue id, never your location), and your focus phase with the time left. *Share listening* hides
  the station, and *Appear offline* hides you entirely while you can still see your friends.
- Presence carries only station ids and labels. Tuning in to a friend looks the station up
  in the local catalogue or Radio Browser, so a peer can never make you play an arbitrary URL.

## Accounts

Accounts are optional. The Account tab (`U`, or the person icon in the drawer) offers:

- **Save profile**: give this device's friends profile a username and password. It keeps
  its friend code and friends.
- **Create account**: when there's no profile yet, this also creates one.
- **Sign in**: on any other device. You get the same profile, friends and code, and this
  device's favorites, recents, unlocks and progress are merged with the account's. The
  account's avatar replaces this device's. Signing in replaces a device-only profile on that
  device, so save that one first if you want to keep it.

While signed in, changes to favorites, recents, avatar, unlocks and progress save a few
seconds after they happen, when the tab is hidden, and from *Sync now*. Each device pulls
the latest copy when it connects or comes back to the foreground. Saves are versioned. If
another device saved first, both copies are merged (lists joined, the larger counts kept) and
saved again. A device with no unsaved changes takes the server copy as is, so a favorite
removed on one device disappears on the others. Mixer, screen, weather and timer settings
stay per device. *Sign out here* revokes only that device's token and keeps its local copy.

Usernames are 3–20 characters (`a–z`, `0–9`, `.`, `_`, `-`) and not case-sensitive.
Passwords are 8–128 characters. They're hashed with PBKDF2-SHA256 (100,000 iterations, the
Workers maximum) and a random 16-byte salt. Sign-in is rate-limited to 10 tries per 15
minutes per network and username. There is no email and no password reset. Friends never
see your username.

The friends server is a Cloudflare Worker with one SQLite-backed Durable Object
(`worker/`). It stores user ids, nicknames, friend codes, SHA-256 token hashes (one for the
profile, plus one per signed-in device), friendships, and for accounts the username,
password hash and salt, and the synced data (at most 64 KiB, as JSON). Live presence exists only in memory, on the open WebSockets. It also serves
`/api/nowplaying`, which reads one ICY metadata block from a station's stream (about 16 KiB)
and caches the title for 15 seconds.

Changes in `worker/` (such as avatars and song titles in presence, and accounts) reach
friends only after the Worker is deployed again with `npm run worker:deploy`. Until then,
friends on the old server get a stable stand-in avatar and no song, the Account tab reports
that accounts need the updated server, and avatars wearing an unlocked part show as a
stand-in to friends (the old server doesn't know the new parts).

```sh
# Local: Worker on :8787, app pointed at it
npm run worker:dev
VITE_PRESENCE_URL=http://127.0.0.1:8787 npm run dev

# Deploy: add your site origin(s) to ALLOWED_ORIGINS in worker/wrangler.toml first
npx wrangler login
npm run worker:deploy
```

Then set `VITE_PRESENCE_URL` to the site's own address (for example
`https://pixelradios.com`) as a build variable of the site's Cloudflare project, and
redeploy. The site Worker forwards `/api/*` to `pixel-radio-presence` over a service
binding, so the friends server shares the site's origin. The friends Worker's own
`workers.dev` address works too. Any path in the setting is ignored. Without it, the app
builds and runs as before, the Friends tab says no server is configured, and song titles
come only from the browser-side sources. Durable Objects with SQLite storage are available
on the Workers free plan.

## Develop and verify

```sh
npm ci
npm run dev
npm test
npm run lint
npm run build
npm run typecheck:worker
npm run preview
```

The regression runner uses Node's `module.registerHooks` API: Node 22.15+ on the
22.x line, or Node 23.5 and later. The build itself follows Vite's Node requirements.
Tests transpile source using the existing TypeScript dependency; no separate test
framework is installed.

## Playback behavior

- A short stall displays BUFFERING; playback progress restores LIVE.
- A persistent stall (10 seconds), disconnect, ended stream, or fatal HLS error
  triggers recovery. The first recovery retries the current station; a repeated
  drop tries other stations. After two automatic recoveries, Retry is required.
  Thirty seconds of uninterrupted playback resets the recovery allowance.
- Station attempts share a six-second CORS/direct playback budget. Ordinary
  candidates have a 12-second combined budget, followed by nine seconds reserved
  for curated fallbacks. City discovery adds at most 4.5 seconds, so normal active
  page timers reach playback or a retryable error within roughly 26 seconds.
  Browser suspension/background timer throttling can extend wall-clock timing.
- Autoplay rejection asks for Retry instead of silently cycling through stations.
- Power-off and new tuning actions cancel pending playback and city lookups.
- Direct playback respects master/radio volume from its first frame, including mute.
- The catalogue discovers current Radio Browser servers, uses bounded request
  timeouts, and filters HTTP-only streams when served over HTTPS.

The app's frontend and radio streams are served independently. Third-party stations
can be unavailable, omit CORS headers, or support different codecs. The curated
fallbacks are all provided by Radio Paradise; they are not independent providers.

## Cloudflare deployment

The repository is connected to **Cloudflare Workers Builds** as the `pixel-radio`
Worker: every push builds it, and pushes to the production branch (normally `main`)
deploy the live site. Settings live in the Cloudflare dashboard under Workers & Pages →
pixel-radio → Settings → Build. The site needs no environment variables; to enable
friends, add `VITE_PRESENCE_URL` (see Friends above) as a build variable there.

`wrangler.jsonc` at the repository root tells Wrangler to serve `dist` as static assets.
Requests to `/api/*` alone run `worker/src/site.ts`, which passes them to the friends Worker
through the `PRESENCE` service binding, so `pixel-radio-presence` must be deployed first.
Its `previews` block is required by `wrangler preview`, which Workers Builds runs for
non-production branches.

A failed build can be retried from its page in the dashboard, or by pushing a new
commit. The friends Worker in `worker/` is a separate deployment and is not built by
this integration; deploy it with `npm run worker:deploy`.

Cloudflare Pages also works: use the React (Vite) preset, build command
`npm run build` and output directory `dist`.

## Verification limits

The regression suite exercises playback lifecycle, mocked HLS failures, tuning
recovery, cancellation, power/volume races, catalogue discovery, and request budgets.
It also covers the focus timer, settings persistence, the presence protocol, the hub's
friend graph and fan-out (against an in-memory store), and the presence client's
reconnect and publish logic. Travel planning (walk, boat and flight legs against a fake
coastline), vehicle sprites, unlock rules, and accounts are covered as well: sign-up, login,
per-device tokens, rate limits, versioned saves, merging and the client's sync loop.
Mocks do not verify audio decoding, audible output, device autoplay policies, or
browser layout. A real-browser HTTPS check, including iOS Safari and mobile reflow,
is still required before a public launch.
