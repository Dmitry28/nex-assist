/**
 * Decodes the HTML entities a site escapes embedded payloads with.
 *
 * Two separate sources need this, which is why it lives here rather than in one parser:
 *
 * - hh.ru ships its state in a `<template>` that used to hold raw JSON and now holds the same
 *   JSON with every quote written as `&#34;`. `JSON.parse` fails at position 1 on that, which
 *   surfaced as "initial-state JSON not found — captcha or layout change?".
 * - a JSON API read through a browser arrives wrapped in the `<pre>` Chrome renders it into,
 *   with the same escaping applied.
 *
 * Numeric entities are handled as well as named ones: only the numeric form appears in either
 * case today, so handling just `&quot;` would have missed both.
 */
export const decodeHtmlEntities = (input: string): string => {
  const named: Record<string, string> = {
    quot: '"',
    apos: "'",
    lt: '<',
    gt: '>',
    nbsp: '\u00a0',
    amp: '&',
  };
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    const token = entity.toLowerCase();
    if (token.startsWith('#x')) return String.fromCodePoint(parseInt(token.slice(2), 16));
    if (token.startsWith('#')) return String.fromCodePoint(Number(token.slice(1)));
    // `amp` is resolved here like any other entity: decoding is a single pass, so an
    // already-decoded `&` cannot be re-consumed — `&amp;#34;` yields the literal `&#34;`.
    return named[token] ?? match;
  });
};
