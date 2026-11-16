import instantsearch from 'instantsearch.js';
import { liteClient } from 'algoliasearch/lite';
import {
  index, configure, searchBox, infiniteHits, refinementList, numericMenu,
  sortBy, stats, currentRefinements, clearRefinements,
} from 'instantsearch.js/es/widgets';
import { connectRefinementList } from 'instantsearch.js/es/connectors';
// Index and replica names come from the frozen contract, so the UI cannot drift from the index.
import { index as INDEX, replicas } from '../../search-config/contract.json';
import { card, distance, SHOW_PHOTOS } from './card.js';
import { locationWidget, locationMode, setLocationMode, renderLocation } from './location.js';
import { enhanceSearchBox } from './searchbox.js';
import './styles.css';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const NEARBY_METRES = 100_000;
const DEFAULT_METRO = 'New York / Tri-State Area';
const LABELS = { cuisine_group: 'Cuisine', price_label: 'Price', stars_count: 'Rating', dining_style: 'Style', area: 'Metro', city: 'City', tags: 'Collection' };
const TILES = { favourites: 'Crowd favourite', gems: 'Hidden gem', occasion: 'Special occasion' };
const TILE_TITLES = { 'Crowd favourite': 'Crowd favourites', 'Hidden gem': 'Hidden gems', 'Special occasion': 'Special occasions' };

const { VITE_ALGOLIA_APP_ID: appId, VITE_ALGOLIA_SEARCH_KEY: apiKey } = import.meta.env;
const preview = !appId || !apiKey;
// No keys yet: serve committed sample records so the design can be reviewed. Dynamic import keeps the stub out of the live bundle path.
const searchClient = preview ? (await import('./preview/stub-client.js')).stubClient : liteClient(appId, apiKey);
$('.preview-badge').hidden = !preview;

const filters = $('#filters');
const search = instantsearch({ searchClient, routing: true, future: { preserveSharedStateOnUnmount: true } });
const setMain = (patch) => search.setUiState((ui) => ({ ...ui, [INDEX]: patch(ui[INDEX] ?? {}) }));

const clear = (container) => clearRefinements({ container, templates: { resetLabel: 'Clear all' } });
const facet = (container, attribute, options = {}) => refinementList({ container, attribute, ...options });
const searchableFacet = (container, attribute, noun) =>
  facet(container, attribute, { searchable: true, searchablePlaceholder: `Search ${noun}`, showMore: true, showMoreLimit: 60 });
const rating = (container) => numericMenu({
  container,
  attribute: 'stars_count',
  items: [{ label: 'Any rating' }, { label: '4.5 and up', start: 4.5 }, { label: '4 and up', start: 4 }],
});

// Tiles: one sibling index per tag, one hit each (the top pick). They cost three queries, so they are mounted only while browsing.
const tileWidget = (id) => ({
  $$type: 'opentable.tile',
  render({ results }) {
    if (!results) return;
    const hit = results.hits[0];
    const media = $(`#tile-${id}`);
    media.closest('.tile').querySelector('.tile-pick').textContent = hit ? `Top pick: ${hit.name}` : '';
    $('.tiles').classList.add('is-ready');
    if (!SHOW_PHOTOS || !hit || media.dataset.id === hit.objectID) return;
    media.dataset.id = hit.objectID;
    // A broken photo is removed, not replaced: CSS hides the empty thumbnail and the colour card stands alone.
    media.innerHTML = '<img alt="" />';
    const img = media.firstChild;
    img.onerror = () => media.replaceChildren();
    img.onload = () => media.classList.add('is-loaded'); // show the square only once a photo is really there
    img.src = hit.image_url;
  },
  // No dispose on purpose: the last picks stay in the DOM, so the no-results state can show them without a query.
});
// Inside a chosen metro the tiles carry it as a facetFilter, so the top pick matches the metro. The tile indices are
// siblings of the main one (they must not inherit its refinements), so the area cannot reach them through the UI state:
// rebuilding the three small indices when the metro changes is the least machinery.
const tileIndices = (area) => Object.entries(TILES).map(([id, tag]) =>
  index({ indexName: INDEX, indexId: `tile-${id}` }).addWidgets([
    configure({ facetFilters: [`tags:${tag}`, ...(area ? [`area:${area}`] : [])], hitsPerPage: 1 }), tileWidget(id),
  ]));
let tiles; // mounted tile indices, undefined while unmounted
let tilesArea; // the metro they were built for
let metroArea; // the metro being browsed now (only set while the far-away picker's metro is active)
let refined = false; // any refinement beyond that metro: results posture, no tiles
// Tiles only exist while browsing. Decided from the query being sent, not the last response: InstantSearch re-renders stale results while widgets change.
const wantTiles = (query) => !query && !refined;
function mountTiles(on) {
  if (on === Boolean(tiles) && (!on || tilesArea === metroArea)) return;
  if (tiles) search.removeWidgets(tiles);
  tiles = on ? tileIndices((tilesArea = metroArea)) : undefined;
  if (tiles) search.addWidgets(tiles);
}

// The posture is read from Algolia's own response: an empty query is browsing, a typed query is finding.
let hadArea = false;
let lastSig;
const posture = {
  $$type: 'opentable.posture',
  render({ results, state }) {
    if (!results) return;
    // The typed query, not query: a Rule may rewrite the query sent to Algolia ("romantic" -> filter), and the posture must follow what the user typed.
    const query = state.query || '';
    const area = state.disjunctiveFacetsRefinements.area?.[0];
    const tag = state.disjunctiveFacetsRefinements.tags?.[0];
    const top = results.hits[0];
    // Any refinement leads to results, like typing does; only the metro picked from the far-away notice is still browsing.
    const metro = locationMode() === 'metro';
    const refinements = results.getRefinements().filter((r) => !(metro && r.attributeName === 'area'));
    refined = refinements.length > 0;
    metroArea = metro ? area : undefined;
    const next = results.nbHits === 0 ? 'empty' : query || refined ? 'find' : 'browse';
    const sig = refinements.map((r) => r.attributeName + r.name).join();
    // Geo only ranks, so the nearest hit always exists; if it is far away, the visitor is outside the dataset.
    const far = !query && !area && top?._rankingInfo?.matchedGeoLocation?.distance > NEARBY_METRES;
    const place = (value) => value.split(' / ')[0];

    if (document.body.dataset.posture !== next) settle(next);
    else {
      // Same posture, new refinements: show the results from their start (the docked bar is sticky, so the top is the first card).
      if (next !== 'browse' && sig !== lastSig) toTop(true);
      if (results.page === 0) fade();
    }
    lastSig = sig;
    $('#far').hidden = !far || next !== 'browse'; // the docked bar has no room for the notice
    if (far && !$('#metro').options.length) fillMetros(results);
    queueMicrotask(() => mountTiles(wantTiles(state.query)));

    const near = !query && !area && top && !far ? place(top.area) : undefined;
    const where = area ? `in ${place(area)}` : far ? 'closest to you' : `near ${near ?? 'you'}`;
    $('.tiles-title').textContent = metroArea ? `Popular in ${place(metroArea)}` : far ? 'Popular in the demo cities' : 'Popular near you';
    $('#search-pill-text').textContent = query || 'Search restaurants';
    $('#lead-title').textContent = next === 'find' ? 'Results' : tag ? `${TILE_TITLES[tag]} ${where}` : where[0].toUpperCase() + where.slice(1);
    $('#empty-query').textContent = query;
    $('#filter-count').textContent = results.getRefinements().length || '';

    // Pills show how many values each one has applied, so the closed bar still tells the story.
    const applied = results.getRefinements().reduce((n, r) => ({ ...n, [r.attributeName]: (n[r.attributeName] ?? 0) + 1 }), {});
    $$('.pill[data-attr]').forEach((pill) => {
      pill.querySelector('.count').textContent = applied[pill.dataset.attr] || '';
      pill.toggleAttribute('data-active', Boolean(applied[pill.dataset.attr]));
    });

    // Tile counts follow the current filters; skip while a query is typed or nothing matches, so the empty state keeps the browse numbers.
    if (!query && next !== 'empty') {
      const counts = Object.fromEntries((results.getFacetValues('tags') ?? []).map((v) => [v.name, v.count]));
      $$('.tile').forEach((tile) => {
        const n = counts[tile.dataset.tag] ?? 0;
        tile.querySelector('.tile-count').textContent = `${n.toLocaleString('en-US')} ${n === 1 ? 'restaurant' : 'restaurants'}`;
        tile.setAttribute('aria-pressed', tile.dataset.tag === tag);
      });
    }

    // A name search (full name match, or the query sits inside the top hit's name/brand) compares branches: rows.
    // Anything else (cuisine, city, broad) is browsing photos: cards. CSS switches on this attribute.
    // Algolia says which attribute matched: if the words hit the cuisine ("steak"), it is browsing even when a name also contains them.
    const hl = top?._highlightResult ?? {};
    const byCuisine = [hl.cuisine_group, hl.food_type].some((h) => h && h.matchLevel !== 'none');
    const byName = query && !byCuisine && hl.name?.matchLevel && hl.name.matchLevel !== 'none';
    document.body.dataset.results = next === 'find' ? (byName ? 'list' : 'cards') : '';

    // The relevance badge explains the engine without jargon: typo tolerance and geo, straight from the ranking info.
    // Distance only when it is a local result (under 80 km, about 50 mi); a far top match is a name search, not a nearby one.
    const info = next === 'find' && query ? top?._rankingInfo : null;
    $('#badge').textContent = info
      ? [info.nbTypos > 0 && 'Typo forgiven', info.matchedGeoLocation?.distance > 0 && info.matchedGeoLocation.distance < 80_000 && `Within ${distance(info.matchedGeoLocation.distance)}`].filter(Boolean).join(' · ')
      : '';

    // Clearing the metro chosen from the notice brings back ranking by the visitor's location.
    if (locationMode() === 'metro' && hadArea && !area) setLocationMode('ip');
    hadArea = Boolean(area);
    renderLocation(area, near, far);
  },
};

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
// A scroll asked for while the filter sheet is open waits for it to close, so "Show N restaurants" lands on the results.
let pendingTop = false;
function toTop(smooth) {
  if (filters.open) return (pendingTop = true);
  scrollTo({ top: 0, behavior: smooth && !reduceMotion.matches ? 'smooth' : 'auto' });
}
filters.addEventListener('close', () => pendingTop && ((pendingTop = false), toTop(true)));
function settle(next) {
  document.body.dataset.posture = next;
  toTop(); // each posture starts at the top: the results below the docked bar, or the landing again
  if (!reduceMotion.matches) {
    $('.panel').animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 250, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }
}
// Results update in place: a short fade says "new answer" without moving the layout.
const fade = () => reduceMotion.matches || $('#hits').animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' });

function fillMetros(results) {
  const areas = results.getFacetValues('area', { sortBy: ['name:asc'] });
  $('#metro').append(...areas.map(({ name, count }) => new Option(`${name} (${count})`, name, false, name === DEFAULT_METRO)));
}

const main = index({ indexName: INDEX, indexId: INDEX }).addWidgets([
  searchBox({
    container: '#searchbox',
    placeholder: 'Type to search',
    showLoadingIndicator: false,
    showSubmit: false,
    // Swap the tiles in or out before the query goes out, so typing costs one query instead of four.
    queryHook: (query, refine) => { mountTiles(wantTiles(query)); refine(query); },
  }),
  configure({ hitsPerPage: 12 }),
  infiniteHits({
    container: '#hits',
    templates: { item: card, empty: () => '', showMoreText: 'Show more restaurants' },
  }),
  // Headless: the tiles refine this attribute, but have no list of their own.
  connectRefinementList(() => {})({ attribute: 'tags' }),
  searchableFacet('#p-cuisine', 'cuisine_group', 'cuisines'),
  facet('#p-price', 'price_label', { sortBy: ['name:asc'] }),
  rating('#p-rating'),
  facet('#p-style', 'dining_style'),
  searchableFacet('#p-area', 'area', 'metros'),
  searchableFacet('#f-cuisine', 'cuisine_group', 'cuisines'),
  facet('#f-price', 'price_label', { sortBy: ['name:asc'] }),
  rating('#f-rating'),
  facet('#f-style', 'dining_style'),
  searchableFacet('#f-area', 'area', 'metros'),
  searchableFacet('#f-city', 'city', 'cities'),
  sortBy({
    container: '#sort',
    items: [{ label: 'Best match', value: INDEX }, ...Object.entries(replicas).map(([value, about]) => ({ value, label: about.split(':')[0] }))],
  }),
  stats({ container: '#stats', templates: { text: ({ nbHits, processingTimeMS }) => `${nbHits.toLocaleString('en-US')} restaurants · ${processingTimeMS} ms` } }),
  stats({ container: '#f-apply', templates: { text: ({ nbHits }) => `Show ${nbHits.toLocaleString('en-US')} restaurants` } }),
  currentRefinements({
    container: '#refinements',
    transformItems: (items) => items.map((item) => ({ ...item, label: LABELS[item.attribute] ?? item.label })),
  }),
  clear('#clear'),
  clear('#f-clear'),
  clear('#empty-clear'),
  posture,
]);

search.addWidgets([locationWidget, main]);
// Dim results only when the network is slow ("stalled"), not on every keystroke.
search.on('render', () => document.body.toggleAttribute('data-stalled', search.status === 'stalled'));
search.start();
// Mount the tiles with the first request when the page opens on the landing, instead of a second round trip.
const first = search.getUiState()[INDEX] ?? {};
refined = Object.values({ ...first.refinementList, ...first.numericMenu }).some((v) => v?.length);
mountTiles(wantTiles(first.query));
enhanceSearchBox();

$('#open-filters').addEventListener('click', () => filters.showModal());

// <details> has no light dismiss: close the open pill on Escape (focus back on it) and on a click elsewhere.
document.addEventListener('keydown', (event) => {
  const open = $('.pill[open]');
  if (event.key !== 'Escape' || !open) return;
  open.open = false;
  open.querySelector('summary').focus();
});
document.addEventListener('click', (event) => {
  $$('.pill[open]').forEach((pill) => pill.contains(event.target) || (pill.open = false));
});

// A tile is a toggle on the tags refinement (the posture rule then scrolls to the results); from the no-results state it also clears the dead-end query.
$$('.tile').forEach((tile) => tile.addEventListener('click', () => {
  const on = tile.getAttribute('aria-pressed') !== 'true';
  setMain((ui) => ({ ...ui, query: '', page: undefined, refinementList: { ...ui.refinementList, tags: on ? [tile.dataset.tag] : [] } }));
}));

$('#metro-form').addEventListener('submit', (event) => {
  event.preventDefault();
  setLocationMode('metro');
  setMain((ui) => ({ ...ui, refinementList: { ...ui.refinementList, area: [$('#metro').value] } }));
});

$('#clear-query').addEventListener('click', () => {
  setMain((ui) => ({ ...ui, query: '' }));
  $('#searchbox input').focus();
});

// The header offers search once the field has scrolled under it. The sticky header covers the top of the viewport, so it is cut off the observed area.
const input = $('#searchbox input');
const stageHidden = () => document.body.hasAttribute('data-stage-hidden') && document.body.dataset.posture === 'browse'; // docked bar: always in view
new IntersectionObserver(([entry]) => document.body.toggleAttribute('data-stage-hidden', !entry.isIntersecting), { rootMargin: `-${$('.top').offsetHeight}px 0px 0px 0px` }).observe($('.field'));
// Every way into the box (pill, "/", type anywhere) goes through focus: bring the field back first, so it is never typed into off screen.
let glide = false;
input.addEventListener('focus', () => stageHidden() && toTop(glide));
$('#search-pill').addEventListener('click', () => { glide = true; input.focus({ preventScroll: true }); glide = false; });
