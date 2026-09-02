// Dictionary-result fixtures: the shapes `getDefinition` settles with and
// `buildTooltipContent` renders. Test data only — nothing here mirrors the userscript.

export function datamuseDict(entry) {
  return { status: 'fulfilled', value: [entry], source: 'datamuse' };
}

export function wiktionaryDict(en) {
  return { status: 'fulfilled', value: { en }, source: 'wiktionary' };
}

export function fulfilledMwDict(entry) {
  return { status: 'fulfilled', value: [entry], source: 'mw' };
}

// MW answers an unknown word with a bare array of suggestion strings.
export function mwNotFound(suggestions) {
  return { status: 'fulfilled', value: suggestions, source: 'mw' };
}

// Transient failure — retryable.
export function rejectedDict() {
  return { status: 'rejected', notFound: false };
}

export function erroredDict(errorText, source = 'free') {
  return { status: 'rejected', notFound: false, source, errorText };
}

// Definitive 404 — the word is absent from the dictionary.
export function notFoundDict() {
  return { status: 'rejected', notFound: true };
}

// A Wikipedia REST summary for `pickWikiThumbnail`, with overrides.
export const wikiSummary = (over = {}) => ({
  type: 'standard',
  titles: { canonical: 'Tooth' },
  thumbnail: { source: 'https://upload.wikimedia.org/t/tooth.png' },
  ...over,
});
