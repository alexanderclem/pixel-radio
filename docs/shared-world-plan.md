# Plan: Pixel Radio as a shared world

**Pitch:** *Radio Garden with your friends in it. A small shared world for studying together
while listening to real radio from real places.*

Every part of this plan supports that pitch. Pixel Radio won't try to beat Radio Garden on
catalogue size, Noisli on its mixer or Forest on timer features. It wins because the place is
real and the people are real.

| # | Feature | Why it matters | Size |
|---|---------|----------------|------|
| 0 | Groundwork (protocol, SPA routing, forward-compatible avatars) **(done)** | Unblocks the rest | S |
| 1 | Live weather at the place you're listening to **(done)** | "It's actually raining in Tokyo right now" | S–M |
| 2 | Deep links, invite links and share cards | Gives people a way to share the app | M |
| 3 | Public world: everyone online, with friends highlighted | Solves the empty-world problem | L |
| 4 | Focus rooms (shared timer and shared station) | Studying *together*, not side by side | L |
| 5 | Progress: streaks, passport, avatar unlocks | A reason to come back | M |
| 6 | Positioning: copy, first run, empty states | Makes the pitch obvious in 10 seconds | S |

Each phase ships on its own and keeps the app working when the friends Worker is old or
missing. The suggested order is 0 → 1 → 2 → 3 → 4 → 5, with 6 alongside 3.

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
- the hub `alarm()` / `scheduleTick()` plumbing goes to Phase 3.

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

## Phase 2: Deep links, invite links, share cards

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

## Phase 3: Public world (everyone online, friends highlighted)

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

## Phase 4: Focus rooms

Friends (or anyone with the link) share **one timer** and optionally **one station**. Live
radio makes listening together free: there's no playback position to sync.

### Behaviour
- Create a room from the Focus module ("Study together"). This gives a code like
  `ROOM-K7Q3` and a link `/r/K7Q3`. Friends see "Maya is in a study room · Join" in their
  list.
- Up to **12 members**. Any member can start, pause, resume, skip or stop, and a toast shows
  "Maya paused the timer". Settings (work, short, long, longEvery) belong to the room.
- **Room station (optional):** the creator can turn on *Listen together*. Then whoever tunes
  a new station sets the room station, and members with *Follow room station* on (the
  default) get `requestStation`. At each break, the room can switch to a "break station"
  picked by the creator.
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
| { type: 'roomStation'; station: SharedStation | null }

// server → client
| { type: 'room'; room: RoomInfo }   // full state, sent on every change (it's small)
| { type: 'roomLeft'; reason: 'left' | 'closed' | 'full' | 'not-found' }

interface RoomInfo {
  code: string
  members: { userId: string; name: string; avatar: Avatar }[]
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
  phase ends, the `alarm()` from Phase 3 advances it (focus → break → focus, long break every
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

## Phase 5: Progress (streaks, passport, avatar unlocks)

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

## Phase 6: Positioning in the product

- **PowerOnScreen:** headline "Real radio from real places, with your friends in it", with
  a live line under it: `412 listening now · raining in Tokyo`. The world snapshot (guest
  socket) and the weather cache provide the data.
- **First run:** after power-on, if the world has walkers, fly to the busiest crowd instead of
  the generic home view. Show a one-time tip over the Friends button: "These are real people
  listening right now. Add a friend to see them highlighted."
- **Empty friends list:** "Invite a friend" with the link from Phase 2, not just the code.
- Update the README, and add `<meta name="description">` and default OG copy that match the
  pitch (none exist today).

---

## Cross-cutting

- **Shortcuts:** `V` map filter, `P` passport, `R` focus room panel. Add them to
  `src/constants/shortcuts.ts` and `ShortcutsHelp`.
- **Calm and focus mode:** public walkers stop animating (they stand) and crowds show only
  badges. Friend edge arrows stay, because they're the point.
- **Accessibility:** every new map affordance has a non-canvas equivalent: the Friends and
  World lists, Share buttons and room controls are normal buttons with labels.
- **Deploy order** for each phase that touches the Worker:
  1. `npm run worker:deploy`;
  2. then merge the site.

  The `v` gating and the sanitize changes in Phase 0 make either order safe, but this order
  avoids a window where nothing shows.
- **Verification for every phase:** `npm test`, `npm run lint`, `npm run build`,
  `npm run typecheck:worker`, plus a manual check with `npm run worker:dev` and two browser
  profiles (one friend, one stranger, one guest).

## Decisions (settled)

1. **Public default:** people appear to strangers as anonymous avatars unless they choose
   `named` or `hidden`.
2. **Guests:** people without a profile can watch the world and appear as anonymous walkers.
3. **Room control:** any member can start, pause, skip or stop the room timer.
4. **Weather:** pixelradios.com is non-commercial, so it uses Open-Meteo's free API.
