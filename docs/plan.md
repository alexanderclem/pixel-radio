# Plan: Pixel Radio, a cozy radio world you share

**Pitch:** *Settle into real radio from real places, and listen with friends.* Pixel Radio is
Radio Garden with your friends in it, plus a mood you can step into.

This combines the original shared-world plan with the newer brief (atmospheres, shareable
sessions, resume, a simpler first visit, journeys, clearer recovery, readability). Where the
brief repeated something already planned or built, it's merged into that phase, not listed
twice. The pixel art and retro radio identity stay throughout.

| # | Phase | Why it matters | Status |
|---|-------|----------------|--------|
| 0 | Groundwork (protocol version, SPA routing, forward-compatible avatars) | Unblocks the rest | **Done** |
| 1 | Live weather where you're listening | "It's actually raining in Tokyo right now" | **Done** |
| 2 | Station links, invite links, share images, link previews | Sharing a station | **Done** |
| 3 | Atmosphere presets, session links, resume, saved setups | One click to a mood; easy to return and to pass on | **Done** |
| 4 | First visit, journeys, playback recovery, readability | Start listening in one click; discover; never confused by a fallback | **Done** |
| 5 | Public world, friends highlighted | The world feels alive | **Done** (needs the Worker deploy) |
| 6 | Listening and focus rooms (opt-in, invitations, host picks the station) | Listen and study *together* | **Done** (needs the Worker deploy) |
| 7 | Streaks, passport, avatar unlocks | A reason to come back | **Done** (friends see streaks after the Worker deploy) |

Each phase ships on its own and keeps the app working when the friends Worker is old or
missing.

### As built: where it differs from the phases below
- **Deploy.** Merging to `main` deploys the site. The public world, rooms and shared streaks
  also need `npm run worker:deploy`. Until then the site detects the older Worker and hides
  those controls; guests stay out of the world quietly. This was tested against `main`'s
  Worker.
- **Phase 3.** *Save this setup…* sits in the share menu and opens the Saved tab with the
  name field.
- **Phase 4.** Journeys live in the Moods tab and on the first screen (no separate tab or
  `J` key; `Y` opens both). `public/og-image.png` is drawn from a real map view.
- **Moods, later.** Six more built-in atmospheres (nine in all). Listeners can make, edit and
  delete their own moods (`library.moods`, synced like setups), starting from what's on or
  from a copy of a built-in. A mood's music is *keep what's playing*, a genre or a city,
  never one fixed station, which is still what saved setups are for. The editor previews
  live and restores the previous scene on cancel. Links to a listener's mood add `mn=<name>`
  (spaces written `%20` so room moods still validate). The Worker's previews only name
  built-ins.
- **Phase 5.** Each client's snapshot includes its own `pid`, so you're never drawn as a
  stranger. The first screen says you appear as an anonymous listener and where to hide.
- **Phase 6.** Rooms are not advertised in friends' presence; invitations and room links
  are the only ways in, to keep them opt-in. Only the host invites. A host whose
  connection drops keeps the role for 30 seconds, so a reload doesn't hand the room away.
  The room panel lives in the Friends tab (no `R` key, no map tag).
- **Phase 7.** Twelve earnable parts. Streak and week minutes travel in presence as
  `stats`.

**Where the new brief overlapped the original:**

| Brief item | Already covered by | What's new here |
|---|---|---|
| Shareable sessions | Phase 2 station links (`/s/<id>`, click to start, previews) | Restoring map position, weather, sky and mix (Phase 3) |
| Simplify the first visit | Original Phase 6 positioning, compact deck | Experience chooser, one-line intro (Phase 4) |
| Page descriptions, social previews | Phase 2 (built) | og-image, atmosphere-aware previews (Phases 3–4) |
| Listening rooms with invitations | Original Phase 4 focus rooms | Opt-in invitations, host-controlled station (Phase 6) |
| Atmospheres, resume and saved setups, journeys, recovery, readability | — | All new (Phases 3–4) |

---

## Current state (what we're building on)

- **Presence server:** one SQLite-backed Durable Object, `PresenceHub` (`worker/src/hub.ts`).
  The logic lives in `worker/src/core.ts` (`Hub`) so it can be tested in Node. Per-socket
  `Session`s are stored as WebSocket attachments, so they survive hibernation. Presence is
  sent **only to friends** (`broadcastUser`). Connecting requires a registered token
  (`hello`).
- **Protocol:** `src/social/protocol.ts` is shared by the client and the Worker. Every frame is
  validated on both sides. Stations travel as ids plus labels, never URLs.
- **Map:** `src/components/PixelCanvas.tsx` builds walker targets for you and your online
  friends (`friendTargetsOf`). `AvatarWalker` animates them, and `MapRenderer.drawAvatars`
  queues avatars at a station with one name tag (friends in `FRIEND_COLOR`; tags hidden below
  zoom 3).
- **Weather:** real since Phase 1 (`src/weather/liveWeather.ts`), with the per-city presets in
  `src/constants/cities.ts` as the fallback. The sky phase (`src/render/solar.ts`) and local
  time (`src/utils/time.ts`) were already real.
- **Focus timer:** `FocusController` uses wall-clock `endsAt`. Presence already carries the
  focus phase and the time left.
- **Hosting:** the site Worker (`worker/src/site.ts`) serves `dist` and forwards `/api/*` to
  `pixel-radio-presence` over a service binding.

---

## Phase 0: Groundwork (done)

1. **Forward-compatible avatars.** `sanitizeAvatar` now clamps a part index it doesn't know
   (from a newer client) to that slot's first part instead of dropping the whole avatar.
   Negative, fractional or missing slots still drop it.
2. **Protocol versioning.** `PROTOCOL_VERSION = 2` in `src/social/protocol.ts`. `hello` and
   `welcome` carry `v`, and peers without one count as version 1. The hub stores
   `Session.version`. Later phases send world, room and stats frames only to `v >= 2`
   sockets. A test pins that the client ignores frame types it doesn't know.
3. **SPA routing.** `wrangler.jsonc` sets `assets.not_found_handling` to
   `"single-page-application"`, so `/s/…`, `/f/…` and `/r/…` will load the app.

Moved to the phases that use them, so nothing ships unused:
- the `src/routing/deepLink.ts` parser goes to Phase 2;
- the hub `alarm()` / `scheduleTick()` plumbing goes to Phase 5 (public world).

---

## Phase 1: Live weather (done)

**What it does:** in **Live** mode (the weather control's old `Auto`; saved settings keep the
value `'auto'`), three things match the real current weather at the place you're listening
to (the selected city, the playing station, or a nearby preset city):
- the rain, snow, storm and wind on the map;
- the ambient rain and wind beds;
- a second HUD line, e.g. `RAIN 57°F`.

When you've panned to open country (`GEO`), nothing is fetched and the nearest city's preset
mood is used, as before.

### Source: Open-Meteo, fetched by the browser
`current=weather_code,temperature_2m,wind_speed_10m,wind_direction_10m`. It needs no key,
allows CORS, and is free for non-commercial use (confirmed for pixelradios.com).

**Change from the first draft:** the browser calls Open-Meteo directly instead of going
through a Worker proxy.
- **Why:** behind a proxy, every listener's requests would come from Cloudflare's shared
  addresses and count against one free-tier allowance. Direct calls count per listener.
- **Also:** Phase 1 needs no Worker deploy, and it works without `VITE_PRESENCE_URL`.

### Behaviour (`src/weather/liveWeather.ts`)
- **Cells:** cached per 0.5° cell (about 55 km), so nearby stations share a fetch. Up to 64
  cells are kept, least recently used dropped first.
- **Refreshing:** fresh for 20 minutes. Stale weather keeps showing while it refreshes.
- **Failures:** retried after 3 minutes, keeping the last good weather.
- **Load:** one request at a time, with an 8 s timeout.
- **Fallback:** if the first fetch for a place fails, its city preset is used.

### Mapping
| WMO `weather_code` | Drawn as | HUD |
|---|---|---|
| 0–1 | clear | CLEAR |
| 2–3 | clear | CLOUDY |
| 45, 48 | clear | FOG |
| 51–57 | light rain (0.2–0.4) | DRIZZLE |
| 61–67, 80–82 | rain (0.4–1.0 by code) | RAIN |
| 71–77, 85–86 | snow (0.3–0.9) | SNOW |
| 95–99 | storm (0.7–1.0) | STORM |

- **Wind:** the east–west part of the 10 m wind, with full drift at 40 km/h. The direction is
  where the wind comes *from*, so a westerly blows rain to the right.
- **Ambient beds:** live weather sets the rain and wind levels. City and fire beds keep their
  presets, and zoomed out everything still relaxes to the planetary bed.
- **Temperature:** °F for Fahrenheit regions (from the browser locale), °C everywhere else.
- `embers` stays a manual mode.

### Tests
`tests/live-weather.test.mjs`:
- code mapping;
- rejecting bad responses;
- wind sign and clamping;
- ambient beds, including Tokyo's rainy preset going quiet under real clear skies;
- cell rounding and antimeridian wrap;
- temperature locale;
- caching, refresh, failure backoff and the one-request rule.

Checked in Chromium with a mocked "heavy rain, 14 °C, westerly" reply over Tokyo: HUD
`RAIN 57°F`, rain drifting east, one request for the cell.

### Possible follow-ups
- A weather line on the station display.
- Fog as its own low-contrast effect.

---

## Phase 2: Deep links, invite links, share cards (done)

**As built:** the Share menu sits on the station display (not the Focus bar), with *Share
link…*, *Copy link* and *Share as image*. A toast confirms copies and invites. Default
description and Open Graph tags are in `index.html`. **Still missing:** the static
`public/og-image.png` the tags point to. Phase 4 adds it.

### Station links: `pixelradios.com/s/<stationId>`
- **Share** button (lucide `Share2`) on `StationDisplay` and the Focus bar. It uses
  `navigator.share({ url, title })` and falls back to copying the link, with a "Link
  copied" toast.
- **On open:** `deepLink.ts` gives the station id. Resolve it with the same path as friends:
  `resolveSharedStation` (local index, then curated, then `fetchStationById`). Browsers block
  autoplay, so `PowerOnScreen` shows **"Tune in to KEXP · Seattle"** as its button. Pressing it
  powers on and then calls `requestStation(station, true)`.
- **Link previews** (so Discord and iMessage show the station): add `/s/*` to
  `run_worker_first`. `site.ts` fetches the station name from Radio Browser by uuid (cached
  for a day) and rewrites `<title>` and the `og:*` / `twitter:*` tags in `index.html` with
  `HTMLRewriter`. `index.html` has no OG tags yet, so add defaults first (title, description,
  a static 1200×630 `og-image.png` in `public/`). Everything else is served unchanged from `ASSETS`.

### Friend invite links: `pixelradios.com/f/<code>`
- The Friends panel's self card gets **Copy invite link** next to the code.
- **On open:** if a profile exists, send `addFriend` once connected and open the Friends tab
  with "You and Maya are now friends". If not, open the Friends tab with the nickname form
  pre-focused, and add the friend right after sign-up. Keep the pending code in
  `sessionStorage` so a reload doesn't lose it.

### Share cards
- `src/share/card.ts` draws a 1200×630 PNG on an offscreen canvas:
  - left half: a crop of the current map buffer around the station, scaled ×4 with no
    smoothing, plus the user's avatar;
  - right half, in the pixel font: song, station, `TOKYO · 23:14 · RAIN 14°`, and the
    `pixelradios.com/s/…` link.
- **Entry point:** a long-press or menu on Share, labelled "Share as image". It uses
  `navigator.share({ files })` where supported, otherwise downloads the file.
- `PixelCanvas` exposes a `snapshot(lon, lat, w, h)` helper through a ref. It reads the
  internal buffer before the CRT pass, so the card stays crisp.

### Tests
- `deepLink` parsing, including bad ids and trailing slashes.
- The pending-invite flow, extending the mocked WebSocket in `tests/presence-client.test.mjs`.
- Card layout as a pure function that returns draw ops, tested without a real canvas.

---

## Phase 3: Atmospheres, session links, resume and saved setups (next)

**Build this first.** It's new: the original plan shared stations but never a whole setup.

### The setup model (`src/session/setup.ts`)
One type describes "a way to listen". Atmospheres, saved setups, the last session and
session links all use it.
```ts
interface Setup {
  stationId: string
  station: Station | null         // a full copy when known (saved / resume); links carry the id
  view: { lon: number; lat: number; zoom: number } | null   // null: fly to the station
  weather: WeatherControls        // mode ('auto' = Live, or a themed type), density, wind
  sky: 'auto' | SolarPhase
  mix: { rain; wind; city; fire; pad; staticBlend; hiss; cutoff }  // 0..1 each
  ambientLinked: boolean          // presets turn Geo Link off so their mix holds
  timer: { work: number; short: number } | null
  atmosphereId: string | null
}
```
- `captureSetup(state)` and `applySetup(setup, { startTimer })` are pure-ish helpers over
  the store.
- **Never part of a setup:** master volume, radio volume, CRT settings, and Calm (those
  belong to the listener).

### Atmosphere presets (`src/session/atmospheres.ts`)
One click sets the station, weather, sky, ambient mix and optionally a timer.

| Atmosphere | Station pick (fallback: curated) | Weather · sky | Mix highlights | Timer |
|---|---|---|---|---|
| **Rainy Tokyo** | Most popular working stream near Tokyo (`findStationsForCity('tokyo')`) | Themed rain · night | rain 0.85, city 0.55 | — |
| **Morning Jazz** | Most popular working jazz stream (new `searchStations` by tag) | Clear · golden | fire 0.15, pad 0.3 | — |
| **Quiet Study** | Lo-fi / ambient by tag, else Radio Paradise Mellow | Soft rain · night | rain 0.4, fire 0.5, pad 0.55 | 50 / 10, optional tick box |

**Themed vs real, always visible:**
- An `ATMOSPHERE · Rainy Tokyo` chip appears on the display.
- The weather line reads `THEMED RAIN`, never the live line.
- The location line always shows the **station's real location**, e.g.
  `PLAYING FROM OSAKA, JAPAN`. Morning Jazz may well be a Paris station; the display says
  so.
- The chip's ✕ leaves the atmosphere: Live weather and Geo Link come back, and the station
  keeps playing.

**Picking stations:**
- Picks resolve when you choose an atmosphere, from Radio Browser in that moment, so a dead
  stream isn't baked in.
- The pick goes through the same recovery as any tuning (Phase 4), and the curated
  fallback is the last resort.

**Entry points:**
- the first screen (Phase 4);
- an *Atmospheres* tab in the Stations drawer;
- `Y` to open it.

### Session links
- They extend the Phase 2 station link with optional query parameters, for example:
  `/s/<id>?atm=rainy-tokyo&at=139.69,35.68,6&wx=rain.65.45&sky=night&mix=85.30.55.0.45.5.10.85&t=50-10`.
- **Encoding** (`encodeSession` / `decodeSession`, pure):
  - mix values are 0–99 integers, and each parameter is clamped;
  - a malformed parameter is dropped on its own, so the station still plays;
  - volume is never included.
- **Recipient:**
  1. The power screen shows *Shared session: Rainy Tokyo · KEXP · Seattle · themed rain* with
     **Start listening** and *Start without the setup*.
  2. Nothing is applied or saved until they click. That click is also the gesture audio
     needs.
- **Share menu:** a new *Copy session link* sits next to the station link. The image card
  shows the atmosphere name when one is active.
- **Link previews:** `stationPage` adds the atmosphere name to the description, e.g.
  "Rainy Tokyo with KEXP, live from Seattle".

### Resume and saved setups
- **Last session:** `captureSetup` runs when a station starts playing, and debounced (5 s)
  after any setup change. It's persisted as `lastSession` with `savedAt`.
- **Resume on the first screen:** `Resume · KEXP, Seattle · themed rain · yesterday`. It
  restores the station, view, weather, mix and atmosphere. A timer is offered, never
  auto-started.
- **Saved setups:**
  - *Save setup…* on the station display asks for a name;
  - setups are stored in `library.setups` (up to 30) and persisted with favorites;
  - the Stations drawer's Favorites tab gains a **Saved setups** section above starred
    stations: play, rename, share (session link) and delete.
- **Persistence:** the merge rules in `useRadioStore` validate every field. A saved setup
  whose station no longer resolves offers the nearest working station instead (Phase 4
  recovery).

### Tests
- **Setup:** capture / apply round trip.
- **Session links:** encode / decode round trip, clamping, partial and garbage parameters,
  volume never included.
- **Atmospheres:**
  - each resolves with the directory down (curated fallback);
  - themed weather flags.
- **Persistence:** `lastSession` and `setups`, including malformed saved data.
- **Shared link:** applies nothing before the click.

---

## Phase 4: First visit, journeys, playback recovery, readability

New work, folding in what was left of the original Phase 6 ("positioning").

### First visit: choose an experience
- **The power screen becomes "Choose how to listen":**
  - **Resume** (when there's a last session);
  - the three **atmosphere** cards;
  - **Just the radio** (today's behaviour);
  - a link to **Journeys**.
- **One line of intro:** "Settle into a real radio station somewhere in the world." This
  replaces the feature list. The shortcut hint shrinks to "Press ? for shortcuts".
- **Shared links take over the screen as they do now:** station, session and invite.
- **Progressive disclosure:**
  - the compact deck stays the default;
  - mixer, synth (pad), static and filter knobs, CRT and sky controls stay behind *All
    controls*;
  - the compact deck gains one *Atmospheres* button so people can change the mood without
    opening the full deck.
- **Kept from the original Phase 6:**
  - the live line under the headline (`raining in Tokyo · 412 listening now`; the listener
    count needs Phase 5);
  - the invite-first empty Friends state (done in Phase 2).

### Journeys (`src/session/journeys.ts`)
Small curated routes, each with a one-line description per stop.
- **Jazz Around the World:** TSF Jazz (Paris) → Jazz FM (London) → Radio Swiss Jazz → WBGO
  (Newark) → Jazz24 (Seattle) → ABC Jazz (Sydney).
- **Independent College Radio:** WXYC (Chapel Hill) → WMBR (MIT) → WREK (Atlanta) → KALX
  (Berkeley) → KXLU (Los Angeles) → CiTR (Vancouver).
- (Room for a third, e.g. *Ambient After Dark*.)

**How stops work:**
- Each stop is `{ query, country, note }`, resolved by Radio Browser name search when you
  reach it. A stop that can't be found or won't play is skipped with a note ("WMBR is off the
  air right now · skipping").
- **On the display:** `JOURNEY · Jazz Around the World · 2/6 · Next stop ▸`. The map flies
  to each stop.
- **Where:** a *Journeys* tab in the Stations drawer lists them with descriptions.

### Playback recovery you can understand
- **The controller tracks what you asked for:** `RadioController` keeps the *requested*
  station next to the *playing* one. When `lockOn` settles on a different station it sets
  `fallback: { requested, reason }`. Reasons: no answer, blocked format, stream ended.
- **The notice under the display:** "KEXP isn't responding. Playing Radio Paradise ·
  Mellow from Paradise, California instead." It has two buttons:
  - **Retry KEXP**;
  - **Another nearby station** (the next working neighbour of the *requested* station, not
    of the fallback).
- **The location line always shows the actual station:** in city mode the city becomes
  context ("TOKYO preset · playing from Osaka").
- **Total failure** keeps today's Retry and adds the same "Another nearby station" button.
- Atmospheres, journeys, resume and shared links all go through this path.

### Readability and presentation
- **A readable face for station text:** station names, songs, locations, drawer rows and
  notices use a bundled humanist monospace (IBM Plex Mono through `@fontsource`, already the
  pattern used for VT323) at 16 px or more.
- **Pixel fonts stay where they're brand:** the logo, frequency, clock, map labels and
  buttons. Check contrast on the LCD green.
- **Social preview:** add `public/og-image.png` (1200×630, drawn with the share-card
  renderer from a map view). Session links get the atmosphere-aware description from
  Phase 3.

### Tests
- **Controller:** the fallback notice for a requested station that fails; "another
  nearby" uses the requested station's neighbours; retrying the requested one.
- **Journeys:** stop resolution and skipping (directory down, station missing).
- **First screen:** choosing an atmosphere powers on and applies it in one click.

---

## Phase 5: Public world (everyone online, friends highlighted)

**Status:** the server, protocol and client feed are written and tested (99 tests) on the
local branch `wip/public-world`, which isn't pushed yet. Still to build: map tiers, crowd
badges, edge arrows for off-screen friends, the Everyone / Friends-only filter, the
"Around the world" list and the privacy control. The shelved work also includes the snapshot
telling each client its own `pid`.

**Fit with the cozy direction:** the public layer stays quiet. Strangers are dimmed, unnamed
and never louder than friends. *Friends only* is one click away. Journey stops and atmosphere
stations (Phases 3–4) are natural places for crowds to form.

The biggest change. Today the hub sends presence only to friends. The public world adds a
second, aggregated feed that everyone gets.

### Privacy model (decide before building; recommendation in bold)
| Setting (`social.publicMode`) | What strangers see |
|---|---|
| **`anonymous` (default)** | Your avatar walking to your station, labelled "listener" |
| `named` | The same, plus your nickname |
| `hidden` | Nothing (friends still see you, unless *Appear offline* is on) |

- *Share listening* off or *Appear offline* on means you're hidden from the public world too.
- Strangers never get your `userId` or friend code. Each socket gets a random **`pid`**,
  which only your friends can link back to you (see below).
- **Guests:** people without a profile can watch the world and appear as anonymous walkers.
  This matters most for the cold start, since the first visit should never show an empty
  world. Recommended: yes.

### Protocol (`src/social/protocol.ts`)
```ts
// client → server
| { type: 'guest'; v: number; public: boolean }      // connect without a profile
| { type: 'world'; mode: 'anonymous' | 'named' | 'hidden' }

// server → client (v >= 2 only)
| { type: 'worldSnapshot'; walkers: PublicWalker[]; crowds: Crowd[]; online: number }
| { type: 'worldDelta'; upsert: PublicWalker[]; remove: string[]; crowds: Crowd[]; online: number }

interface PublicWalker {
  pid: string                // random per socket, 10 chars
  name: string | null        // only in 'named' mode
  avatar: Avatar
  station: { id: string; name: string; song: string | null; lat: number; lon: number }
  focus: 'focus' | 'break' | null
}
interface Crowd { stationId: string; name: string; lat: number; lon: number; count: number }
```
- `Presence` sent to friends gains `pid`, so the client can tell that public walker
  `pid=x` is the friend "Maya" and draw them once, as a friend.
- `hello` gains `v` and `public`. `welcome` gains `pid` and `online`.
- Every new field is sanitized on both sides, with the same rules as `sanitizeStation` and
  `sanitizeAvatar`.

### Server (`worker/src/core.ts`)
- `Session` gains `pid`, `publicMode` and `version`. Guests have `userId: null` but
  `guest: true`.
- **Fan-out runs on a tick, not on each change.** A presence change marks the world dirty
  and calls `scheduleTick()`. `alarm()` runs at most every **3 s**:
  1. It collects all visible public sessions from the socket attachments, so it stays correct
     after hibernation with no in-memory cache.
  2. It picks **up to 300 walkers**: at most 8 per station (the most recently updated first),
     then fills by recency. Everyone else counts toward that station's `Crowd`.
  3. It sends `worldDelta` (walkers whose `updatedAt` is after the last tick, plus `pid`s that
     left) to every `v >= 2` socket. Departures are recorded in `close()` in a small storage
     list that the tick drains.
  4. New sockets get one `worldSnapshot` right after `welcome` or `guest`.
- **Limits:**
  - presence messages: at most 1 per second per socket; extras are dropped silently;
  - guests: at most 3 sockets per IP;
  - names shown publicly go through a small blocklist in `normalizePublicName`, and fall back
    to "listener" on a match.
- **Cost check:** about 300 × 120 B = 36 KB per snapshot. A delta is usually under 2 KB.
  With 2,000 sockets that's about 4 MB every 3 s at peak, and zero when nothing changes.
  Beyond a few thousand concurrent users, move to one `WorldHub` DO per region with a coarse
  global crowd summary. Note this in the README and don't build it now.

### Client
- **Store** (`useRadioStore`):
  - `world: { status, walkers: Record<pid, PublicWalker>, crowds: Crowd[], online: number }`;
  - `social.publicMode` and `social.mapFilter: 'everyone' | 'friends'` (both persisted).
- **`PresenceClient`:**
  - opens a socket for guests too (`guest` frame);
  - applies snapshots and deltas;
  - sends `world` when `publicMode` changes;
  - upgrades from guest to `hello` after sign-up on the same socket.
- **`PixelCanvas`:** walker targets come in three tiers. They're drawn back to front, so
  friends and you are never hidden behind strangers.

| Tier | Look | Name tag | Click |
|---|---|---|---|
| Public | Sprite at 55% alpha, desaturated toward the palette (new cached sprite variant) | None; hover shows "LISTENER · ♪ KEXP" or the shared nickname | Tune in |
| Friend | Full colour, 1 px `FRIEND_COLOR` outline, small ▼ marker above | Shown from zoom 2 (today: 3) | Tune in (as now) |
| You | As now | "YOU" | — |

- **Crowds:** when more than 3 public walkers share a station, draw the first 3 and a pixel
  badge "+12". This uses the same `clusterSprite` style as station markers, tinted neutral so
  it isn't confused with friend colour. When a station has a `Crowd` beyond the 300-walker
  cap, the badge includes it.
- **Friends off-screen:** when a friend's station is outside the viewport, draw a small arrow
  in `FRIEND_COLOR` at the screen edge pointing toward them, with their initial. Clicking it
  flies the camera there (`flyTo`). Show at most 6, nearest first.
- **Map filter:** a two-state button in the map button column (`Users` icon): **Everyone** /
  **Friends only**. The `V` shortcut toggles it.
- `AvatarWalker` already handles any number of ids. Prune walkers more than 40 px off-screen
  before `drawAvatars`, so 300 walkers stay cheap.

- **Friends panel** (`FriendsPanel.tsx`) gets two sections:
  1. **Friends:** as now, with a "Show on map" crosshair (exists) and, when on the same
     station, a "with you" chip.
  2. **Around the world:** the top 10 stations by listeners, e.g.
     `KEXP · Seattle · 14 listening · 2 friends`. Click tunes in.
- **Header badge:** `3 friends · 412 online`. Friends stay first and highlighted; the world
  count is the secondary number.
- **Privacy UI** in the Friends panel: the three-way public-mode control, with one sentence
  on what strangers see.

### Tests
- `tests/presence-hub.test.mjs`:
  - guest connect;
  - per-station cap and crowd counts;
  - delta contents after a change;
  - removals after close;
  - hidden and invisible users excluded;
  - `pid` never equals `userId`;
  - v1 sockets never get world frames;
  - presence rate limit.
- `tests/presence-protocol.test.mjs`: sanitizing `PublicWalker`, `Crowd` and the new `hello`
  fields.
- `tests/presence-client.test.mjs`: snapshot then delta merge, de-duplicating friends by
  `pid`, and the guest-to-hello upgrade.
- Renderer: a pure `walkerTiers(friends, world, self, filter)` function that returns ordered
  marks, unit-tested. Drawing stays untested, as it is today.

---

## Phase 6: Listening and focus rooms

Friends share **one station** and optionally **one timer**. Live radio makes listening
together free: there's no playback position to sync. This merges the original focus rooms
with the newer brief: **opt-in rooms, joined by invitation, with the host choosing the
station.**

### What changed from the first draft
- **Opt-in, by invitation:**
  - you're only ever in a room you created or accepted;
  - the host invites friends from the Friends panel ("Invite to room"), and each friend
    gets a card with *Join* / *Not now*;
  - a room link (`/r/<code>`) still works for people who aren't friends yet.
- **Host-controlled station:**
  - only the host changes the room station;
  - members with *Follow room station* on (the default) tune with them;
  - a member who tunes elsewhere stays in the room but shows as "listening elsewhere";
  - the host can hand over the role; if the host leaves, the longest-present member takes
    over.
- **The timer stays shared:** any member can start, pause or skip, as decided earlier.
- Rooms can be *listening only* (no timer) or *study* (timer on). Both use the same room
  type.

### Behaviour
- Create a room from the Focus module ("Study together"). This gives a code like
  `ROOM-K7Q3` and a link `/r/K7Q3`. Friends see "Maya is in a study room · Join" in their
  list.
- Up to **12 members**. Any member can start, pause, resume, skip or stop, and a toast shows
  "Maya paused the timer". Settings (work, short, long, longEvery) belong to the room.
- **Room station:** set by the host (see above). At each break, the room can switch to a
  "break station" the host picked.
- A room can start from an atmosphere or a saved setup (Phase 3). Members are offered the
  host's weather and mix as well as the station; each member accepts or keeps their own.
- On the map, room members stand together at the room station under one tag:
  `STUDY ROOM · 4`.
- Leaving the room returns you to your solo timer (idle).

### Protocol
```ts
// client → server
| { type: 'createRoom'; settings: RoomSettings; listenTogether: boolean }
| { type: 'joinRoom'; code: string }
| { type: 'leaveRoom' }
| { type: 'roomTimer'; action: 'start' | 'pause' | 'resume' | 'skip' | 'stop' }
| { type: 'roomStation'; station: SharedStation | null }   // host only
| { type: 'roomInvite'; userId: string }                    // host → a friend
| { type: 'roomHost'; userId: string }                      // hand over the host role

// server → client
| { type: 'room'; room: RoomInfo }   // full state, sent on every change (it's small)
| { type: 'roomLeft'; reason: 'left' | 'closed' | 'full' | 'not-found' }
| { type: 'roomInvited'; code: string; from: { userId: string; name: string }; station: SharedStation | null }

interface RoomInfo {
  code: string
  host: string                                   // userId
  members: { userId: string; name: string; avatar: Avatar; following: boolean }[]
  timer: { phase: 'idle' | 'focus' | 'break'; remainingMs: number; paused: boolean; cycle: number; longBreak: boolean }
  settings: RoomSettings
  station: SharedStation | null
  listenTogether: boolean
  lastAction: { by: string; action: string } | null
}
```
Rooms need a profile, because members are shown by nickname. Guests are prompted to pick one.

### Server
- New SQLite table `rooms(code PRIMARY KEY, settings, phase, ends_at, paused_remaining, cycle,
  long_break, station, listen_together, created_at, updated_at)`. A room must survive
  hibernation, so it can't live only in memory. Membership is `Session.roomCode`, an
  attachment.
- **The server owns the timer:** `ends_at` uses the server clock and is sent as
  `remainingMs`, exactly as `storePresence` and `wirePresence` do for focus today. When a
  phase ends, the `alarm()` from Phase 5 advances it (focus → break → focus, long break every
  N) and broadcasts.
- Empty rooms are deleted by the tick after 1 hour.
- Codes: 4 Crockford characters, from the existing `generateCode` alphabet. Joins are
  rate-limited like `addFriend`.

### Client
- `FocusController` gains a "room-driven" mode. While `focus.room` is set, local start, pause
  and skip send `roomTimer` instead of changing state. Incoming `room` frames set
  `phase`, `endsAt = now + remainingMs` and `pausedRemaining`. Chime, ducking and
  notifications keep working because they react to `phase` changes in the store.
- `FocusModule` gets a room strip: the code, member avatars, Copy link and Leave.
- `presenceOf` gains `room: { code, size } | null` for friends, so the Friends panel can offer
  **Join**.

### Tests
- Hub tests:
  - create and join;
  - the 12-member cap;
  - timer transitions driven by `tick(now)` with a fake clock;
  - pause and resume keeping `remainingMs`;
  - leave, empty, then sweep;
  - the room station broadcast.
- `tests/focus-controller.test.mjs`: room-driven mode applies server state and sends actions
  instead of changing local state.

---

## Phase 7: Progress (streaks, passport, avatar unlocks)

All local-first, in persisted store state. No account is needed.

### Focus history and streaks
- `focus.history: Record<YYYY-MM-DD, { minutes: number; together: number }>`. Keep the last
  400 days and trim on write.
  - `minutes` counts completed focus phases.
  - `together` counts minutes completed while in a room with others, or while at least one
    friend was also in a focus phase (checked against presence when the phase ends).
- **Streak:** consecutive local days, up to today or yesterday, with at least one completed
  session.
- **Shown:**
  - the Focus module: `🔥 6 days · 4h 20m this week · 1h 50m with friends`;
  - friends, through presence (`stats: { streak, weekMinutes }`, sanitized), as a small chip
    in their row.

### Passport
- `passport: { countries: Record<CC, { firstAt, minutes }>, stations: Record<id, { name, country, firstAt, minutes }> }`.
  Capped at 500 stations, keeping the most-listened.
- A **stamp** is earned after 2 minutes of continuous `playing` on a station (a new
  `src/progress/passport.ts`, driven by a store subscription and a 15 s tick).
- **Passport** drawer tab (`P`): a grid of pixel stamps per country. The stamp art is
  generated from the country code and a seeded palette, so no assets are needed. Header:
  `23 countries · 61 stations · 41h listened`. Clicking a stamp flies to that country's
  most-played station.
- **Later:** tint visited countries on the map (the terrain already has the country shapes
  from `world-atlas`).

### Avatar unlocks
- Add about 12 new parts (hats, shirts, shoes) to `src/avatar/parts.ts`, each with
  `unlock?: { kind: 'focusHours' | 'streak' | 'countries' | 'together'; n: number }`. Examples:
  - headphones: 5 focus hours;
  - beret: 10 countries;
  - flame shirt: 7-day streak;
  - matching scarf: 3 hours focused with friends.
- `AvatarEditor` shows locked parts dimmed with "Focus 5h to unlock". A toast celebrates each
  new unlock.
- Unlocks are cosmetic and checked on the client only. Server-side checks aren't worth the
  code. Phase 0's per-slot clamping keeps older clients rendering new parts as defaults.
- `PART_COUNTS` is imported by the Worker, so **redeploy the Worker in the same release**.
  Otherwise new parts are clamped to defaults server-side. That's harmless but looks wrong.

### Tests
- Streak across month and DST boundaries.
- History trimming.
- The `together` attribution rule.
- Passport stamp timing (2-minute threshold, pause and resume).
- Unlock evaluation.
- Persisted-state merge (extend `tests/library.test.mjs` style).

---

## Cross-cutting

- **Shortcuts:** `Y` atmospheres and journeys, `V` map filter, `P` passport, all in
  `src/constants/shortcuts.ts` and `ShortcutsHelp`.
- **Calm and focus mode:** public walkers stop animating and crowds show only badges. Friend
  edge arrows, atmosphere chips and fallback notices stay.
- **Accessibility:** every map affordance has a non-canvas equivalent: lists, chips, notices
  and room controls are labelled buttons. Notices use `role="status"`.
- **Deploy order** for phases that touch the friends Worker (5, 6):
  1. `npm run worker:deploy`;
  2. then merge the site.

  Phases 3 and 4 are site-only: the site Worker deploys with the site.
- **Verification for every phase:**
  - `npm test`, `npm run lint`, `npm run build`, `npm run typecheck:worker`;
  - Playwright runs at **desktop (1280×860) and mobile (390×844)** covering:
    - choosing an atmosphere;
    - opening station, session and invite links (audio starts only on click);
    - resume after reload;
    - an **unavailable station** (stream 404 / timeout), with the fallback notice and both
      buttons;
    - the station directory being down;
  - two browser profiles for friend and room flows.

## Decisions (settled)

1. **Public default:** people appear to strangers as anonymous avatars unless they choose
   `named` or `hidden`.
2. **Guests:** people without a profile can watch the world and appear as anonymous walkers.
3. **Room timer:** any member can start, pause, skip or stop it.
4. **Room station:** the host chooses it; members follow by default and can opt out. Rooms are
   opt-in, joined by invitation or room link.
5. **Weather:** pixelradios.com is non-commercial, so it uses Open-Meteo's free API.
6. **Order:** Phases 3 and 4 (atmospheres, sessions, resume, first visit, journeys,
   recovery, readability) come before the public world and rooms.

---

## Later additions (October 2026)

Built: About/Privacy/Terms/Contact pages, an installable app (manifest, icons, service
worker, media keys), *Music only*, Discover (vibe search, filters, more like this,
trending, stream quality), *Surprise me*, a sleep timer, scheduled moods, listening
history, saved songs with search links, CSV/M3U export and an optional Spotify playlist.

Not yet: a paid tier or sponsored journeys; Apple Music playlist export (needs a MusicKit
developer token signed on a server); in-app account deletion (app stores require it, so it
comes before a store listing); identifying songs on stations that don't announce them.
