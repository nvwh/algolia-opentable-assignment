// Prompts are real queries that return results, so the placeholder doubles as a tour of what search understands.
const PROMPTS = ['Try “ruths chris”', 'Seafood in San Diego', 'Italian in Brooklyn', 'Sushi in Honolulu', 'Steakhouse, Houston'];

export function enhanceSearchBox() {
  const input = document.querySelector('#searchbox input');
  input.setAttribute('aria-label', 'Search restaurants, cuisines or cities');

  // Type anywhere to search, unless the user is already in a field, a dialog, or using a shortcut.
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || document.querySelector('dialog[open]')) return;
    if (event.target.closest('input, textarea, select, [contenteditable]')) return;
    if (event.key === '/') {
      event.preventDefault();
      input.focus();
    } else if (event.key.length === 1 && event.key !== ' ') {
      input.focus(); // focusing during keydown lets this very keystroke land in the box
    }
  });

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let i = 0;
  setInterval(() => (input.placeholder = PROMPTS[i++ % PROMPTS.length]), 3500);
}
