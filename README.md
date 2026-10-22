# Pixel Radio

A pixel world receiver with live internet radio, station search, generated ambience,
weather, and CRT controls. Built with React, TypeScript, Vite, Zustand, Web Audio,
and hls.js. No backend or API keys are required.

## Develop and verify

```sh
npm ci
npm run dev
npm test
npm run lint
npm run build
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

## Cloudflare Pages

Connect the GitHub repository to Cloudflare Pages with the React (Vite) preset,
build command `npm run build`, and output directory `dist`. No application
environment variables are needed. Each push to `main` can then trigger a new
deployment. Use Git integration when you want deploys to follow repository pushes;
Cloudflare does not let a Direct Upload Pages project be converted to a Git-connected
project later.

Cloudflare Workers Static Assets can also serve `dist`, with an assets configuration
pointing to that directory. No deployment is performed by these scripts.

## Verification limits

The regression suite exercises playback lifecycle, mocked HLS failures, tuning
recovery, cancellation, power/volume races, catalogue discovery, and request budgets.
Mocks do not verify audio decoding, audible output, device autoplay policies, or
browser layout. A real-browser HTTPS check, including iOS Safari and mobile reflow,
is still required before a public launch.
