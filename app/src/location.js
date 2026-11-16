import { connectConfigure } from 'instantsearch.js/es/connectors';

// Geo ranks, never filters: radius 'all' keeps a known restaurant in another city findable.
// 5 km precision buckets let popularity break ties between places that are about as close.
// Geo ranks, never filters. Precision bands: within 80 km, places 5 km apart tie (popularity decides); beyond that,
// 1,000 km bands, so for a far-away name search text relevance wins over a few hundred km ("nobu" -> Nobu before Nobuo).
const RANK = { aroundRadius: 'all', aroundPrecision: [{ from: 0, value: 5000 }, { from: 80000, value: 1000000 }], getRankingInfo: true };
const PARAMS = {
  ip: () => ({ ...RANK, aroundLatLngViaIP: true }),
  precise: (latLng) => ({ ...RANK, aroundLatLng: latLng }),
  // Inside a chosen metro, distance from a far-away visitor means nothing: rank by popularity alone.
  metro: () => ({ getRankingInfo: true }),
};

let mode = 'ip';
let refine;
let lastArea;
const text = document.querySelector('#location-text');
const note = document.querySelector('#location-note');
const button = document.querySelector('#precise');

// A configure connector whose refine we keep, so location changes are one call and stay out of the URL.
export const locationWidget = connectConfigure(({ refine: r }) => (refine = r))({ searchParameters: PARAMS.ip() });
export const locationMode = () => mode;

export function setLocationMode(next, latLng) {
  mode = next;
  document.body.dataset.location = next;
  refine(PARAMS[next](latLng));
}

// `near` is the metro of the closest restaurant, the friendliest name we have for where the visitor is.
let lastNear;
let lastFar;
export function renderLocation(area, near = lastNear, far = lastFar) {
  [lastArea, lastNear, lastFar] = [area, near, far];
  text.textContent = area ? `In ${area}` : far ? 'Outside the demo cities' : near ? `Near ${near}` : 'Near you';
  button.hidden = mode === 'precise';
}

button.addEventListener('click', () => {
  const fallBack = () => {
    note.textContent = 'Precise location unavailable, still using your network location.';
    button.disabled = false;
  };
  if (!navigator.geolocation) return fallBack();
  button.disabled = true;
  note.textContent = '';
  navigator.geolocation.getCurrentPosition(({ coords }) => {
    button.disabled = false;
    setLocationMode('precise', `${coords.latitude},${coords.longitude}`);
    renderLocation(lastArea);
  }, fallBack, { timeout: 10_000, maximumAge: 600_000 });
});
