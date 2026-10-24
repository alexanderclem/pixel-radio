/**
 * Vibe search: everyday words ("island", "upbeat cyberpunk", "rainy coffee") mapped to
 * the genre tags Radio Browser stations carry. The first tags of each vibe are the ones
 * looked up; all of them count when ranking results.
 */
export interface Vibe {
  id: string
  label: string
  /** Words and phrases that call it up */
  words: string[]
  /** Radio Browser tags, most telling first */
  tags: string[]
}

export const VIBES: Vibe[] = [
  { id: 'island', label: 'Island', words: ['island', 'islands', 'hawaiian', 'hawaii', 'aloha', 'tropical', 'tropics', 'beach', 'luau', 'ukulele', 'surf', 'summer'], tags: ['hawaiian', 'tropical', 'reggae', 'island', 'caribbean', 'ukulele', 'surf'] },
  { id: 'caribbean', label: 'Caribbean', words: ['caribbean', 'reggae', 'dancehall', 'soca', 'calypso', 'jamaica', 'jamaican', 'ska', 'dub'], tags: ['reggae', 'dancehall', 'caribbean', 'soca', 'ska', 'dub', 'calypso'] },
  { id: 'cyberpunk', label: 'Cyberpunk', words: ['cyberpunk', 'cyber', 'neon', 'synthwave', 'retrowave', 'outrun', 'blade runner', 'futuristic', 'dystopian', 'hacker', 'vaporwave'], tags: ['synthwave', 'retrowave', 'darksynth', 'cyberpunk', 'vaporwave', 'darkwave', 'ebm', 'industrial'] },
  { id: 'upbeat', label: 'Upbeat', words: ['upbeat', 'energetic', 'energy', 'happy', 'party', 'hype', 'fun', 'feelgood', 'feel good', 'cheerful', 'dancing', 'dance'], tags: ['dance', 'edm', 'house', 'hits', 'disco', 'eurodance', 'pop'] },
  { id: 'chill', label: 'Chill', words: ['chill', 'chilled', 'calm', 'relax', 'relaxing', 'mellow', 'peaceful', 'cozy', 'cosy', 'laid back', 'soft', 'gentle'], tags: ['chillout', 'ambient', 'lounge', 'downtempo', 'lofi', 'easy listening', 'chill'] },
  { id: 'lofi', label: 'Lo-fi', words: ['lofi', 'lo-fi', 'study', 'studying', 'homework', 'beats', 'chillhop'], tags: ['lofi', 'lo-fi', 'chillhop', 'jazzhop', 'study', 'beats'] },
  { id: 'focus', label: 'Focus', words: ['focus', 'concentrate', 'concentration', 'deep work', 'work', 'working', 'coding', 'reading'], tags: ['ambient', 'instrumental', 'classical', 'lofi', 'piano', 'post-rock'] },
  { id: 'sleep', label: 'Sleep', words: ['sleep', 'sleepy', 'bedtime', 'night', 'nighttime', 'dreamy', 'dream', 'lullaby'], tags: ['ambient', 'sleep', 'new age', 'drone', 'meditation', 'relaxation'] },
  { id: 'coffee', label: 'Coffee shop', words: ['coffee', 'cafe', 'café', 'coffeehouse', 'coffee shop', 'brunch', 'sunday', 'morning', 'breakfast'], tags: ['jazz', 'bossa nova', 'acoustic', 'lounge', 'chanson', 'easy listening'] },
  { id: 'rainy', label: 'Rainy day', words: ['rain', 'rainy', 'sad', 'melancholy', 'melancholic', 'moody', 'gloomy', 'cloudy', 'autumn', 'fall'], tags: ['trip-hop', 'indie', 'piano', 'singer-songwriter', 'ambient', 'shoegaze'] },
  { id: 'drive', label: 'Night drive', words: ['night drive', 'driving', 'drive', 'road trip', 'roadtrip', 'highway', 'cruising', 'cruise'], tags: ['synthwave', 'classic rock', 'retrowave', '80s', 'rock', 'new wave'] },
  { id: 'workout', label: 'Workout', words: ['workout', 'gym', 'running', 'run', 'training', 'pump', 'cardio', 'lifting'], tags: ['edm', 'drum and bass', 'hardstyle', 'hip hop', 'techno', 'trap'] },
  { id: 'latin', label: 'Latin', words: ['latin', 'latino', 'latina', 'salsa', 'fiesta', 'reggaeton', 'cumbia', 'bachata', 'mexican', 'spanish'], tags: ['latin', 'salsa', 'reggaeton', 'cumbia', 'bachata', 'merengue', 'latin pop'] },
  { id: 'brazil', label: 'Brazil', words: ['brazil', 'brazilian', 'bossa', 'bossa nova', 'samba', 'rio', 'mpb'], tags: ['bossa nova', 'mpb', 'samba', 'brazilian', 'forro'] },
  { id: 'kpop', label: 'K-pop', words: ['kpop', 'k-pop', 'korean', 'korea', 'seoul'], tags: ['k-pop', 'kpop', 'korean'] },
  { id: 'anime', label: 'Anime & J-pop', words: ['anime', 'japanese', 'japan', 'jpop', 'j-pop', 'city pop', 'tokyo', 'vocaloid', 'otaku'], tags: ['anime', 'j-pop', 'jpop', 'city pop', 'japanese', 'vocaloid'] },
  { id: '80s', label: '80s', words: ['80s', 'eighties', '1980s', 'retro', 'new wave', 'synthpop'], tags: ['80s', 'new wave', 'synthpop', 'synth pop'] },
  { id: '70s', label: '70s & disco', words: ['70s', 'seventies', '1970s', 'disco', 'funky', 'funk', 'groovy', 'groove'], tags: ['70s', 'disco', 'funk', 'soul'] },
  { id: '90s', label: '90s', words: ['90s', 'nineties', '1990s', 'grunge', 'britpop'], tags: ['90s', 'eurodance', 'grunge', 'britpop'] },
  { id: 'oldies', label: 'Oldies', words: ['oldies', '50s', '60s', 'vintage', 'nostalgic', 'nostalgia', 'doo wop', 'rock n roll', 'rockabilly'], tags: ['oldies', '60s', '50s', 'doo wop', 'rock n roll', 'rockabilly'] },
  { id: 'country', label: 'Country', words: ['country', 'cowboy', 'western', 'honky tonk', 'americana', 'southern', 'bluegrass', 'nashville'], tags: ['country', 'americana', 'bluegrass', 'classic country', 'western'] },
  { id: 'classical', label: 'Classical', words: ['classical', 'orchestra', 'orchestral', 'symphony', 'baroque', 'opera', 'mozart', 'bach', 'chamber'], tags: ['classical', 'baroque', 'symphony', 'opera', 'orchestra'] },
  { id: 'piano', label: 'Piano', words: ['piano', 'keys', 'pianist'], tags: ['piano', 'solo piano', 'classical', 'neoclassical'] },
  { id: 'jazz', label: 'Jazz', words: ['jazz', 'jazzy', 'swing', 'bebop', 'smooth', 'speakeasy', 'noir'], tags: ['jazz', 'smooth jazz', 'swing', 'bebop', 'jazz fusion'] },
  { id: 'blues', label: 'Blues', words: ['blues', 'bluesy', 'delta'], tags: ['blues', 'blues rock', 'delta blues'] },
  { id: 'metal', label: 'Heavy', words: ['metal', 'heavy', 'headbang', 'angry', 'aggressive', 'loud', 'brutal'], tags: ['metal', 'heavy metal', 'hard rock', 'metalcore', 'thrash metal'] },
  { id: 'rock', label: 'Rock', words: ['rock', 'guitar', 'guitars', 'riffs'], tags: ['rock', 'classic rock', 'alternative', 'indie rock', 'hard rock'] },
  { id: 'indie', label: 'Indie', words: ['indie', 'alternative', 'alt', 'college', 'underground'], tags: ['indie', 'alternative', 'indie rock', 'indie pop', 'college radio'] },
  { id: 'punk', label: 'Punk', words: ['punk', 'pop punk', 'skate', 'hardcore'], tags: ['punk', 'pop punk', 'punk rock', 'hardcore'] },
  { id: 'hiphop', label: 'Hip hop', words: ['hiphop', 'hip-hop', 'hip hop', 'rap', 'trap', 'boom bap', 'drill', 'beats and rhymes'], tags: ['hip hop', 'hiphop', 'rap', 'trap', 'hip-hop'] },
  { id: 'soul', label: 'Soul & R&B', words: ['soul', 'soulful', 'rnb', 'r&b', 'neo soul', 'motown', 'slow jams'], tags: ['soul', 'rnb', 'r&b', 'neo soul', 'motown'] },
  { id: 'techno', label: 'Club', words: ['techno', 'club', 'rave', 'warehouse', 'berlin', 'house', 'trance', 'underground club'], tags: ['techno', 'house', 'deep house', 'trance', 'minimal'] },
  { id: 'dnb', label: 'Drum & bass', words: ['dnb', 'drum and bass', 'drum & bass', 'jungle', 'breakbeat', 'breaks', 'liquid'], tags: ['drum and bass', 'dnb', 'jungle', 'breakbeat', 'liquid funk'] },
  { id: 'space', label: 'Space', words: ['space', 'cosmic', 'galaxy', 'stars', 'astral', 'spacey', 'interstellar', 'nebula', 'moon'], tags: ['space', 'ambient', 'space music', 'drone', 'psychedelic'] },
  { id: 'fantasy', label: 'Tavern & folk', words: ['medieval', 'fantasy', 'tavern', 'celtic', 'viking', 'irish', 'scottish', 'bard', 'renaissance', 'folk'], tags: ['celtic', 'medieval', 'folk', 'irish', 'fantasy', 'nordic folk'] },
  { id: 'christmas', label: 'Christmas', words: ['christmas', 'xmas', 'holiday', 'holidays', 'festive', 'santa'], tags: ['christmas', 'xmas', 'holiday'] },
  { id: 'afro', label: 'Afrobeats', words: ['african', 'africa', 'afrobeat', 'afrobeats', 'afro', 'highlife', 'amapiano', 'nigerian'], tags: ['afrobeat', 'afrobeats', 'african', 'amapiano', 'highlife'] },
  { id: 'bollywood', label: 'Bollywood', words: ['bollywood', 'indian', 'india', 'desi', 'bhangra', 'hindi'], tags: ['bollywood', 'indian', 'hindi', 'bhangra'] },
  { id: 'arabic', label: 'Arabic', words: ['arabic', 'arab', 'middle eastern', 'oriental', 'khaleeji'], tags: ['arabic', 'oriental', 'khaleeji', 'arabic pop'] },
  { id: 'french', label: 'French', words: ['french', 'chanson', 'paris', 'parisian', 'france'], tags: ['chanson', 'french', 'variété française', 'french pop'] },
  { id: 'psych', label: 'Psychedelic', words: ['trippy', 'psychedelic', 'psych', 'acid', 'stoner', 'hippie'], tags: ['psychedelic', 'psytrance', 'psychedelic rock', 'stoner rock', 'acid'] },
  { id: 'dark', label: 'Dark', words: ['dark', 'goth', 'gothic', 'spooky', 'halloween', 'eerie', 'creepy', 'witchy'], tags: ['gothic', 'darkwave', 'dark ambient', 'post-punk', 'industrial'] },
  { id: 'romantic', label: 'Romantic', words: ['romantic', 'romance', 'love', 'date night', 'sexy', 'sensual'], tags: ['love songs', 'soul', 'rnb', 'smooth jazz', 'ballads'] },
  { id: 'meditation', label: 'Meditation', words: ['meditation', 'meditate', 'zen', 'yoga', 'spa', 'mindful', 'mindfulness', 'healing'], tags: ['meditation', 'new age', 'relaxation', 'spa', 'ambient'] },
  { id: 'games', label: 'Video games', words: ['video game', 'video games', 'gaming', 'game', 'games', 'chiptune', '8bit', '8-bit', 'nintendo', 'pixel'], tags: ['chiptune', 'video game', 'game music', 'vgm', '8bit'] },
  { id: 'cinematic', label: 'Cinematic', words: ['cinematic', 'epic', 'film', 'movie', 'movies', 'soundtrack', 'score', 'trailer'], tags: ['soundtrack', 'film music', 'epic', 'score', 'movie soundtracks'] },
]

export const VIBE_BY_ID: Record<string, Vibe> = Object.fromEntries(VIBES.map((v) => [v.id, v]))

/** Words that say nothing about the music ("some upbeat music please"). */
const FILLER = new Set([
  'a', 'an', 'the', 'and', 'or', 'with', 'for', 'of', 'to', 'in', 'on', 'some', 'something', 'music', 'radio', 'station',
  'stations', 'songs', 'song', 'tunes', 'vibe', 'vibes', 'vibey', 'mood', 'please', 'like', 'kind', 'type', 'style',
  'genre', 'playlist', 'mix', 'me', 'my', 'i', 'want', 'play', 'put', 'that', 'is', 'very', 'really', 'super',
])

export interface ParsedVibe {
  /** Groups of tags; a station matching every group ranks first */
  groups: { label: string; tags: string[] }[]
  /** Whether any group came from the dictionary rather than a bare word */
  known: boolean
}

const normalize = (s: string) => ` ${s.toLowerCase().replace(/[^\p{L}\p{N}&'-]+/gu, ' ').replace(/\s+/g, ' ').trim()} `

/** Every phrase, longest first, so "night drive" wins over "night". */
const PHRASES = VIBES.flatMap((vibe) => vibe.words.map((word) => ({ word: ` ${word} `, vibe }))).sort((a, b) => b.word.length - a.word.length)

/**
 * Read a vibe out of a free-text query. Known words become their vibe's tags; other words
 * of three letters or more are tried as tags themselves ("bossa", "shoegaze").
 */
export function parseVibe(query: string): ParsedVibe {
  let rest = normalize(query)
  const groups: ParsedVibe['groups'] = []
  const seen = new Set<string>()
  for (const { word, vibe } of PHRASES) {
    if (!rest.includes(word)) continue
    rest = rest.split(word).join(' ')
    if (seen.has(vibe.id)) continue
    seen.add(vibe.id)
    groups.push({ label: vibe.label, tags: vibe.tags })
  }
  const known = groups.length > 0
  for (const word of rest.trim().split(' ')) {
    if (word.length < 3 || FILLER.has(word) || seen.has(word)) continue
    seen.add(word)
    groups.push({ label: word, tags: [word] })
  }
  return { groups: groups.slice(0, 4), known }
}

/** Example vibes shown as chips. */
export const VIBE_EXAMPLES = ['island', 'upbeat cyberpunk', 'rainy coffee', 'night drive', 'lofi study', 'tavern', 'space', 'workout']
