import type { Station } from '../types'

/** A station's tags as lower-case phrases ("news talk", "80s"). */
export const tagList = (tags: string): string[] =>
  [...new Set(tags.toLowerCase().split(/[,;/|]+/).map((t) => t.trim().replace(/\s+/g, ' ')).filter(Boolean))]

/** Tags that say the station is mostly speech; strong ones count double. */
const STRONG_TALK = new Set([
  'talk', 'talk radio', 'news talk', 'newstalk', 'news/talk', 'speech', 'spoken word', 'spoken', 'sermon', 'sermons',
  'preaching', 'bible', 'bible teaching', 'christian talk', 'audiobook', 'audiobooks', 'audio drama', 'radio drama',
  'podcast', 'podcasts', 'call-in', 'scanner', 'police', 'air traffic control', 'atc', 'quran', 'koran', 'talk & speech',
])
const TALK = new Set([
  'news', 'noticias', 'nachrichten', 'actualités', 'nieuws', 'notizie', 'sports', 'sport', 'football', 'soccer',
  'information', 'info', 'informação', 'información', 'politics', 'current affairs', 'business', 'finance', 'weather',
  'traffic', 'comedy', 'education', 'educational', 'religion', 'religious', 'catholic', 'islam', 'islamic',
  'public radio', 'culture', 'talk show', 'interviews', 'debate', 'npr',
])
/** Tags that say there's music, which outweigh a passing "news". */
const MUSIC = new Set([
  'music', 'hits', 'top 40', 'top40', 'charts', 'pop', 'rock', 'jazz', 'classical', 'dance', 'electronic', 'edm', 'house',
  'techno', 'trance', 'hip hop', 'hiphop', 'hip-hop', 'rap', 'rnb', 'r&b', 'soul', 'funk', 'disco', 'blues', 'country',
  'oldies', 'reggae', 'lofi', 'lo-fi', 'chillout', 'chill', 'ambient', 'lounge', 'metal', 'indie', 'alternative', 'folk',
  'latin', 'salsa', 'cumbia', 'reggaeton', 'bossa nova', 'world music', 'schlager', 'k-pop', 'kpop', 'j-pop', 'jpop',
  'anime', 'gospel', 'worship', 'ccm', 'christian music', 'christian rock', 'adult contemporary', 'easy listening',
  'smooth jazz', 'synthwave', 'punk', 'soundtrack', 'instrumental', 'piano', 'opera', 'baroque', 'hawaiian', 'tropical',
  '50s', '60s', '70s', '80s', '90s', '00s', '2000s',
])
/** Names that give a speech station away even with no tags. */
const TALK_NAME = new RegExp(
  [
    '\\bnews\\b', '\\btalk\\b', '\\bsports?\\b', '\\bnachrichten\\b', '\\bnoticias\\b', '\\bnot[ií]cias\\b', '\\bnieuws\\b',
    'radio maria', 'bbc radio [45]', 'world service', '\\bnpr\\b', '\\bespn\\b', 'talksport', '\\blbc\\b', '\\bcnn\\b',
    'c-span', 'bloomberg', 'deutschlandfunk', 'france ?info', 'france culture', 'radio vaticana', 'vatican news',
    '\\bsermons?\\b', '\\bbible\\b', '\\bquran\\b', '\\bscanner\\b', '\\bpolice\\b', '\\batc\\b',
  ].join('|'),
  'i',
)

const cache = new WeakMap<Station, boolean>()

/**
 * Whether a station is mostly people talking (news, talk, sports, sermons), judged from
 * its tags and name. Stations with music tags stay music even with some news; untagged
 * stations count as music unless their name says otherwise.
 */
export function isTalk(station: Station): boolean {
  const known = cache.get(station)
  if (known !== undefined) return known
  let talk = 0
  let music = 0
  for (const tag of tagList(station.tags)) {
    if (STRONG_TALK.has(tag)) talk += 2
    else if (TALK.has(tag)) talk += 1
    else if (MUSIC.has(tag)) music += 1
  }
  if (TALK_NAME.test(station.name)) talk += 2
  const result = station.source !== 'curated' && talk > music
  cache.set(station, result)
  return result
}

/** Keep-predicate for the "Music only" switch. */
export const isMusic = (station: Station) => !isTalk(station)
