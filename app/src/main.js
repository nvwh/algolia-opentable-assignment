import instantsearch from 'instantsearch.js';
import { liteClient } from 'algoliasearch/lite';
import {
  index, configure, searchBox, infiniteHits, refinementList, numericMenu,
  sortBy, stats, currentRefinements, clearRefinements,
} from 'instantsearch.js/es/widgets';
import { connectRefinementList } from 'instantsearch.js/es/connectors';
// Index and replica names come from the frozen contract, so the UI cannot drift from the index.
import { index as INDEX, replicas } from '../../search-config/contract.json';
import { card, miles, SHOW_PHOTOS } from './card.js';
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

const search = instantsearch({ searchClient, routing: true, future: { preserveSharedStateOnUnmount: true } });
const setMain = (patch) => search.setUiState((ui) => ({ ...ui, [INDEX]: patch(ui[INDEX] ?? {}) }));

const clear = (container) => clearRefinements({ container, templates: { resetLabel: 'Clear all' } });
const facet = (container, attribute, options = {}) => refinementList({ container, attribute, ...options });
const searchableFacet = (container, attribute, noun) =>
  facet(container, attribute, { searchable: true, searchablePlaceholder: `Search ${noun}`, showMore: true, showMoreLimit: 60 });
const rating = (container) => numericMenu({
  container,
  attribute: 'stars_count',
  items: [{ label: 'Any rating' }, { label: '4.5 and up', start: 4.5 }, { label: '4 and up', start: 4 }, { label: '3.5 and up', start: 3.5 }],
});

// Tiles: one sibling index per tag, one hit each. They cost three queries, so they are mounted only while browsing.
const tileWidget = (id) => ({
  $$type: 'opentable.tile',
  render({ results }) {
    const hit = results?.hits[0];
    const media = $(`#tile-${id}`);
    if (!hit || media.dataset.id === hit.objectID) return;
    media.dataset.id = hit.objectID;
    media.innerHTML = `<span class="tile-fallback"><small>Top pick near you</small><span></span></span>${SHOW_PHOTOS ? '<img alt="" />' : ''}`;
    media.querySelector('.tile-fallback span').textContent = hit.name;
    const img = media.querySelector('img');
    if (img) {
      img.onerror = () => (img.hidden = true);
      img.src = hit.image_url;
    }
    $('.tiles').classList.add('is-ready');
  },
  // No dispose on purpose: the last photos stay in the DOM, so the no-results state can show them without a query.
});
const tiles = Object.entries(TILES).map(([id, tag]) =>
  index({ indexName: INDEX, indexId: `tile-${id}` }).addWidgets([configure({ facetFilters: [`tags:${tag}`], hitsPerPage: 1 }), tileWidget(id)]));
let tilesOn = false;
// Results posture = a query or any refinement, so a filter docks the bar exactly like typing does.
// The one exception is the metro picked from the far-away notice: the visitor is still browsing that metro.
const hasValue = (v) => (Array.isArray(v) ? v.length > 0 : Object.values(v ?? {}).some(hasValue));
const isFind = (state, query = state.query) => {
  const { area, ...facets } = state.disjunctiveFacetsRefinements;
  return Boolean(query) || hasValue({ ...facets, ...state.facetsRefinements, ...state.numericRefinements, area: locationMode() === 'metro' ? [] : area });
};
// Decided from the state being sent, not the last response: InstantSearch re-renders stale results while widgets change.
const wantTiles = (query, state = main.getHelper().state) => !isFind(state, query) && !document.body.hasAttribute('data-far') && locationMode() !== 'metro';
function mountTiles(on) {
  if (on === tilesOn) return;
  tilesOn = on;
  on ? search.addWidgets(tiles) : search.removeWidgets(tiles);
}

// The posture is read from Algolia's own response: an empty query is browsing, a typed query is finding.
let hadArea = false;
let lastRefinements;
const posture = {
  $$type: 'opentable.posture',
  render({ results, state }) {
    if (!results) return;
    const area = state.disjunctiveFacetsRefinements.area?.[0];
    const tag = state.disjunctiveFacetsRefinements.tags?.[0];
    const top = results.hits[0];
    const next = results.nbHits === 0 ? 'empty' : isFind(state) ? 'find' : 'browse';
    // Geo only ranks, so the nearest hit always exists; if it is far away, the visitor is outside the dataset.
    const far = next === 'browse' && !area && top?._rankingInfo?.matchedGeoLocation?.distance > NEARBY_METRES;
    const place = (value) => value.split(' / ')[0];

    // Back to the top when the answer changes shape (landing <-> results) or the refinements change; never per keystroke.
    const refinements = JSON.stringify(results.getRefinements());
    const reshaped = (document.body.dataset.posture === 'browse') !== (next === 'browse');
    const refined = refinements !== (lastRefinements ??= refinements) && next !== 'browse';
    lastRefinements = refinements;
    if (document.body.dataset.posture !== next) settle(next);
    else if (results.page === 0) fade();
    if (reshaped || refined) toTop();
    document.body.toggleAttribute('data-far', far);
    $('#far').hidden = !far;
    if (far && !$('#metro').options.length) fillMetros(results);
    queueMicrotask(() => mountTiles(wantTiles(state.query, state)));

    const near = next === 'browse' && !area && top && !far ? place(top.area) : undefined;
    const where = area ? `in ${place(area)}` : far ? 'closest to you' : `near ${near ?? 'you'}`;
    $('#lead-title').textContent = next === 'find' ? 'Results' : tag ? `${TILE_TITLES[tag]} ${where}` : where[0].toUpperCase() + where.slice(1);
    $('#empty-query').textContent = results.query || 'these filters';
    $('#clear-query').hidden = !results.query;
    $('#filter-count').textContent = results.getRefinements().length || '';

    // Pills show how many values each one has applied, so the closed bar still tells the story.
    const applied = results.getRefinements().reduce((n, r) => ({ ...n, [r.attributeName]: (n[r.attributeName] ?? 0) + 1 }), {});
    $$('.pill[data-attr]').forEach((pill) => {
      pill.querySelector('.count').textContent = applied[pill.dataset.attr] || '';
      pill.toggleAttribute('data-active', Boolean(applied[pill.dataset.attr]));
    });

    // Tile counts follow the current filters; only the landing updates them so the empty state keeps the browse numbers.
    const counts = Object.fromEntries((results.getFacetValues('tags') ?? []).map((v) => [v.name, v.count]));
    $$('.tile').forEach((tile) => {
      if (next === 'browse') {
        const n = counts[tile.dataset.tag] ?? 0;
        tile.querySelector('.tile-count').textContent = `${n.toLocaleString('en-US')} ${n === 1 ? 'restaurant' : 'restaurants'}`;
      }
      tile.setAttribute('aria-pressed', tile.dataset.tag === tag); // always, so a tile in the empty state can still toggle off
    });

    // The relevance badge explains the engine without jargon: typo tolerance and geo, straight from the ranking info.
    // Distance only when it is a local result (under 50 mi); a far top match is a name search, not a nearby one.
    const info = next === 'find' ? top?._rankingInfo : null;
    $('#badge').textContent = info
      ? [info.nbTypos > 0 && 'Typo forgiven', info.matchedGeoLocation?.distance > 0 && info.matchedGeoLocation.distance < 80_000 && `Within ${miles(info.matchedGeoLocation.distance)}`].filter(Boolean).join(' · ')
      : '';

    // Clearing the metro chosen from the notice brings back ranking by the visitor's location.
    if (locationMode() === 'metro' && hadArea && !area) setLocationMode('ip');
    hadArea = Boolean(area);
    renderLocation(area, near, far);
  },
};

const filters = $('#filters');
let pendingTop = false;
// While the filter sheet is open the scroll waits for its close, so the page does not jump behind the dialog.
function toTop() {
  if (filters.open) pendingTop = true;
  else if (scrollY > 0) scrollTo({ top: 0 });
}
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
function settle(next) {
  document.body.dataset.posture = next;
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
    placeholder: 'Name, cuisine, city',
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
mountTiles(wantTiles(search.getUiState()[INDEX]?.query));
enhanceSearchBox();

$('#open-filters').addEventListener('click', () => filters.showModal());
filters.addEventListener('close', () => { // "Show N restaurants" closes the dialog first, then the results come into view
  if (pendingTop) toTop();
  pendingTop = false;
});

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

// A tile is a toggle on the tags refinement; from the no-results state it also clears the dead-end query.
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
