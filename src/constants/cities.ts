import type { CityPreset } from '../types'

export const CITIES: CityPreset[] = [
  {
    id: 'tokyo', code: 'TYO', name: 'Tokyo', country: 'Japan', countryCode: 'JP',
    timeZone: 'Asia/Tokyo', lat: 35.68, lon: 139.69, freq: 89.2,
    ambient: { rain: 0.45, wind: 0.15, city: 0.85, fire: 0 },
    weather: { type: 'rain', intensity: 0.55, wind: -0.2 }, mood: 'noir',
  },
  {
    id: 'reykjavik', code: 'REK', name: 'Reykjavik', country: 'Iceland', countryCode: 'IS',
    timeZone: 'Atlantic/Reykjavik', lat: 64.15, lon: -21.94, freq: 91.4,
    ambient: { rain: 0, wind: 0.9, city: 0.1, fire: 0.65 },
    weather: { type: 'snow', intensity: 0.7, wind: 0.6 }, mood: 'dreamy',
  },
  {
    id: 'nyc', code: 'NYC', name: 'New York', country: 'United States', countryCode: 'US',
    timeZone: 'America/New_York', lat: 40.71, lon: -74.01, freq: 93.9,
    ambient: { rain: 0.2, wind: 0.25, city: 1, fire: 0 },
    weather: { type: 'storm', intensity: 0.6, wind: 0.35 }, mood: 'warm',
  },
  {
    id: 'cairo', code: 'CAI', name: 'Cairo', country: 'Egypt', countryCode: 'EG',
    timeZone: 'Africa/Cairo', lat: 30.04, lon: 31.24, freq: 95.1,
    ambient: { rain: 0, wind: 0.7, city: 0.6, fire: 0.2 },
    weather: { type: 'embers', intensity: 0.45, wind: 0.8 }, mood: 'noir',
  },
  {
    id: 'rio', code: 'RIO', name: 'Rio de Janeiro', country: 'Brazil', countryCode: 'BR',
    timeZone: 'America/Sao_Paulo', lat: -22.91, lon: -43.17, freq: 96.7,
    ambient: { rain: 0.6, wind: 0.3, city: 0.55, fire: 0 },
    weather: { type: 'rain', intensity: 0.4, wind: 0.15 }, mood: 'bright',
  },
  {
    id: 'london', code: 'LDN', name: 'London', country: 'United Kingdom', countryCode: 'GB',
    timeZone: 'Europe/London', lat: 51.51, lon: -0.13, freq: 98.3,
    ambient: { rain: 0.9, wind: 0.35, city: 0.6, fire: 0.3 },
    weather: { type: 'rain', intensity: 0.85, wind: 0.3 }, mood: 'warm',
  },
  {
    id: 'paris', code: 'PAR', name: 'Paris', country: 'France', countryCode: 'FR',
    timeZone: 'Europe/Paris', lat: 48.86, lon: 2.35, freq: 99.6,
    ambient: { rain: 0.35, wind: 0.2, city: 0.65, fire: 0.45 },
    weather: { type: 'clear', intensity: 0.2, wind: 0.1 }, mood: 'dreamy',
  },
  {
    id: 'mumbai', code: 'BOM', name: 'Mumbai', country: 'India', countryCode: 'IN',
    timeZone: 'Asia/Kolkata', lat: 19.08, lon: 72.88, freq: 101.2,
    ambient: { rain: 1, wind: 0.4, city: 0.8, fire: 0 },
    weather: { type: 'storm', intensity: 1, wind: -0.45 }, mood: 'bright',
  },
  {
    id: 'mexico', code: 'MEX', name: 'Mexico City', country: 'Mexico', countryCode: 'MX',
    timeZone: 'America/Mexico_City', lat: 19.43, lon: -99.13, freq: 102.5,
    ambient: { rain: 0.15, wind: 0.3, city: 0.75, fire: 0.5 },
    weather: { type: 'embers', intensity: 0.35, wind: -0.1 }, mood: 'warm',
  },
  {
    id: 'nairobi', code: 'NBO', name: 'Nairobi', country: 'Kenya', countryCode: 'KE',
    timeZone: 'Africa/Nairobi', lat: -1.29, lon: 36.82, freq: 104.1,
    ambient: { rain: 0.3, wind: 0.5, city: 0.35, fire: 0.7 },
    weather: { type: 'clear', intensity: 0.3, wind: 0.2 }, mood: 'bright',
  },
  {
    id: 'seoul', code: 'SEL', name: 'Seoul', country: 'South Korea', countryCode: 'KR',
    timeZone: 'Asia/Seoul', lat: 37.57, lon: 126.98, freq: 105.8,
    ambient: { rain: 0.25, wind: 0.35, city: 0.9, fire: 0.1 },
    weather: { type: 'snow', intensity: 0.35, wind: -0.3 }, mood: 'noir',
  },
  {
    id: 'sydney', code: 'SYD', name: 'Sydney', country: 'Australia', countryCode: 'AU',
    timeZone: 'Australia/Sydney', lat: -33.87, lon: 151.21, freq: 107.3,
    ambient: { rain: 0.1, wind: 0.6, city: 0.45, fire: 0.25 },
    weather: { type: 'clear', intensity: 0.25, wind: 0.5 }, mood: 'bright',
  },
]

export const CITY_BY_ID: Record<string, CityPreset> = Object.fromEntries(CITIES.map((c) => [c.id, c]))

export const CITIES_BY_FREQ = [...CITIES].sort((a, b) => a.freq - b.freq)

export const FM_MIN = 87.5
export const FM_MAX = 108.5

/** Ambient bed used when zoomed out to the whole planet. */
export const GLOBAL_AMBIENT = { rain: 0.25, wind: 0.55, city: 0.2, fire: 0.1 }
