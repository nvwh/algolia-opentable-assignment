// Photos "load" but are all the same storefront, so the typographic fallback leads. Flip to bring photos back (cards and collection tiles).
export const SHOW_PHOTOS = true; // OpenTable serves a generic storefront image for these legacy IDs; it still reads as "photo goes here". Set false to show the cuisine tile instead.
// Cool brand neutrals for the no-photo tile, picked per cuisine so a grid of fallbacks still has rhythm.
const TINTS = ['#FCE8EA', '#EEF0F3', '#F1F2F4', '#E9EEF1'];
const tint = (text) => TINTS[[...text].reduce((sum, c) => sum + c.charCodeAt(0), 0) % TINTS.length];
const TAGS = ['Crowd favourite', 'Hidden gem', 'Special occasion'];

// The dataset is US-only, but the interviewers or a visitor abroad read km.
const UNIT = (() => {
  let region = 'US';
  try { region = new Intl.Locale(navigator.language).maximize().region; } catch {}
  return ['US', 'GB', 'LR', 'MM'].includes(region) ? 'mile' : 'kilometer';
})();
const METRES_PER = UNIT === 'mile' ? 1609.344 : 1000;
export const distance = (metres) => {
  const value = metres / METRES_PER;
  return new Intl.NumberFormat(undefined, { style: 'unit', unit: UNIT, unitDisplay: 'short', maximumFractionDigits: value < 10 ? 1 : 0 }).format(value);
};

// "Ruth's Chris Steak House - Indianapolis Northside" -> brand + branch, keeping the search highlights.
// InstantSearch has already escaped the highlighted value and turned its tags into <mark>, so it is safe as HTML.
function splitChain(hit) {
  if (hit.brand_location_count < 2 || !hit.name.startsWith(hit.brand) || hit.name === hit.brand) return null;
  const separator = hit.name.slice(hit.brand.length).match(/^\s*[-–—@(]\s*/)?.[0];
  const highlighted = hit._highlightResult?.name?.value ?? hit.name;
  const at = separator ? highlighted.indexOf(separator) : -1;
  if (at < 0) return null;
  return {
    brand: highlighted.slice(0, at),
    branch: highlighted.slice(at + separator.length).replace(/\)$/, ''),
  };
}

export function card(hit, { html, components }) {
  const { Highlight } = components;
  const chain = splitChain(hit);
  // A full name match on the first hit means the user typed a restaurant's name: give it a lead row.
  const lead = hit.__position === 1 && hit._highlightResult?.name?.matchLevel === 'full';
  const metres = hit._rankingInfo?.matchedGeoLocation?.distance; // metres; geoDistance is a precision bucket, not a distance
  const tag = hit.tags?.find((t) => TAGS.includes(t));
  const markup = (value) => ({ __html: value });

  return html`<article class=${['card', lead && 'card--lead', chain && 'card--chain'].filter(Boolean).join(' ')}>
    <div class="card-media" style=${`--tint:${tint(hit.cuisine_group)}`} aria-hidden="true">
      <span class="card-fallback">${hit.cuisine_group}</span>
      ${SHOW_PHOTOS && html`<img src=${hit.image_url} alt="" loading="lazy" onError=${(e) => (e.currentTarget.hidden = true)} />`}
      ${tag && html`<span class="card-tag">${tag}</span>`}
      ${metres > 0 && html`<span class="card-dist">${distance(metres)}</span>`}
    </div>
    <div class="card-body">
      <h3 class="card-name">
        ${chain
          ? html`<span class="card-brand"><span dangerouslySetInnerHTML=${markup(chain.brand)} /><small> · ${hit.brand_location_count} locations</small></span>
              <span class="card-branch" dangerouslySetInnerHTML=${markup(chain.branch)} />`
          : html`<${Highlight} hit=${hit} attribute="name" />`}
      </h3>
      <p class="card-where">
        <span class="card-hood"><${Highlight} hit=${hit} attribute="neighborhood" /></span>
        <span>
          <${Highlight} hit=${hit} attribute="cuisine_group" /><span class=${hit.neighborhood === hit.city ? 'card-city--dup' : ''}> · <${Highlight} hit=${hit} attribute="city" /></span>
        </span>
      </p>
      <p class="card-facts">
        <span class="card-rating">
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="m6 .8 1.6 3.4 3.7.4-2.8 2.5.8 3.7L6 8.9 2.7 10.8l.8-3.7L.7 4.6l3.7-.4Z" fill="currentColor"/></svg>
          <b>${hit.stars_count.toFixed(1)}</b><span class="sr-only"> out of 5,</span> (${hit.reviews_count.toLocaleString('en-US')})
        </span>
        <span class="card-price">${hit.price_label}<span aria-hidden="true">${'$'.repeat(4 - hit.price)}</span></span>
        ${metres > 0 && html`<span class="card-mi">${distance(metres)}</span>`}
      </p>
    </div>
    <a class="reserve" href=${hit.reserve_url} target="_blank" rel="noopener">
      ${lead ? 'Reserve a table' : 'Reserve'}<span class="sr-only"> at ${hit.name}</span>
    </a>
  </article>`;
}
