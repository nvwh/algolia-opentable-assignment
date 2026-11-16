// Preview only: a stand-in search client serving ~55 committed sample records so the design can be reviewed
// before the index exists. Deliberately naive: substring match, one-letter typo fallback, no sorting by replica.
import records from './sample-records.json';

const NEW_YORK = '40.7580,-73.9855'; // stands in for IP geolocation, which a stub cannot do
const SEARCHED = ['name', 'cuisine_group', 'food_type', 'neighborhood', 'city'];

function metres(from, { lat, lng }) {
  const [lat1, lng1] = from.split(',').map(Number);
  const rad = Math.PI / 180;
  const h = Math.sin(((lat - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat * rad) * Math.sin(((lng - lng1) * rad) / 2) ** 2;
  return Math.round(12_742_000 * Math.asin(Math.sqrt(h)));
}

// facetFilters are an AND of strings or OR-groups; numericFilters here are only "stars_count>=4".
const facetMatch = (r, f) => (Array.isArray(f) ? f.some((g) => facetMatch(r, g)) : [].concat(r[f.split(':')[0]]).includes(f.slice(f.indexOf(':') + 1)));
const numericMatch = (r, f) => { const [, key, value] = f.match(/^(\w+)>=([\d.]+)$/) ?? []; return !key || r[key] >= Number(value); };

function run({ params: p, type, facet }) {
  const words = (p.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const mark = (text) => words.reduce((s, w) => s.replace(new RegExp(`(${w.replace(/\W/g, '\\$&')})`, 'gi'), `${p.highlightPreTag}$1${p.highlightPostTag}`), text);
  // One-letter typo tolerance, crudely: if nothing matches exactly, allow one extra letter per word ("ruthh").
  const loose = (w, text) => text.includes(w) || (w.length > 3 && [...w].some((_, i) => text.includes(w.slice(0, i) + w.slice(i + 1))));
  const filter = (has) => records.filter((r) =>
    words.every((w) => SEARCHED.some((a) => has(w, r[a].toLowerCase()))) &&
    (p.facetFilters ?? []).every((f) => facetMatch(r, f)) &&
    (p.numericFilters ?? []).every((f) => numericMatch(r, f)));
  let matched = filter((w, text) => text.includes(w));
  const nbTypos = matched.length ? 0 : 1;
  if (nbTypos) matched = filter(loose);

  const counts = (attr) => matched.reduce((c, r) => ([].concat(r[attr]).forEach((v) => (c[v] = (c[v] ?? 0) + 1)), c), {});
  if (type === 'facet') {
    const q = p.facetQuery.toLowerCase();
    const facetHits = Object.entries(counts(facet)).filter(([v]) => v.toLowerCase().includes(q)).map(([value, count]) => ({ value, count, highlighted: value }));
    return { facetHits, exhaustiveFacetsCount: true, processingTimeMS: 1 };
  }

  const origin = p.aroundLatLng ?? (p.aroundLatLngViaIP ? NEW_YORK : null);
  const hits = matched.map((r) => ({
    ...r,
    _highlightResult: Object.fromEntries(SEARCHED.map((a) => {
      const found = words.filter((w) => r[a].toLowerCase().includes(w));
      return [a, { value: mark(r[a]), matchLevel: !found.length ? 'none' : found.length === words.length ? 'full' : 'partial', matchedWords: found }];
    })),
    _rankingInfo: { nbTypos, ...(origin && { matchedGeoLocation: { distance: metres(origin, r._geoloc) } }) },
  }));
  // Empty query in the real index ranks by distance, then popularity; mimic that so browse looks right.
  hits.sort((a, b) => (origin && !words.length ? a._rankingInfo.matchedGeoLocation.distance - b._rankingInfo.matchedGeoLocation.distance : b.popularity_score - a.popularity_score));

  const page = p.page ?? 0;
  const hitsPerPage = p.hitsPerPage ?? 20;
  const facets = Object.fromEntries([].concat(p.facets ?? []).map((a) => [a, counts(a)]));
  return {
    hits: hits.slice(page * hitsPerPage, (page + 1) * hitsPerPage),
    nbHits: hits.length, page, hitsPerPage, nbPages: Math.ceil(hits.length / hitsPerPage),
    facets, query: p.query ?? '', params: '', exhaustiveNbHits: true, processingTimeMS: 1,
  };
}

export const stubClient = {
  search: async (requests) => ({ results: requests.map(run) }),
};
