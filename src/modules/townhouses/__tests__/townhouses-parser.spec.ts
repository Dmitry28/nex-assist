import { dedupe, fromKufar, fromRealt } from '../townhouses.service';
import { extractBuildingLinks, parseMoney, parseUnits } from '../townhouses-prometr-parser.service';

// Trimmed from the real prometr.by markup for ЖК Белые Росы.
const UNIT_ROW = `
<div class="flats-in__row">
  <div class="row">
    <div class="flats-in__cell col-md-2">
      <div class="flats-in__label visible-xs-block">Комнат</div>
      <div class="flats-in__value">4</div>
    </div>
    <div class="flats-in__cell col-md-2">
      <div class="flats-in__label visible-xs-block">ПЛОЩАДЬ М2</div>
      <div class="flats-in__value">185.8</div>
    </div>
    <div class="flats-in__cell col-md-3">
      <div class="flats-in__label visible-xs-block">ЦЕНА ЗА М2</div>
      2 814.0 BYN
    </div>
    <div class="flats-in__cell col-md-3">
      <div class="flats-in__label visible-xs-block">ЦЕНА квартиры</div>
      522 937.0 BYN
    </div>
    <div class="col-md-1">
      <a href="/newbuild_belarus/grodno/belye-rosy/taunkhausy-v-zhk-belye-rosy_1420/4-komnatnaya-185-8-38539/"></a>
    </div>
  </div>
</div>`;

describe('parseMoney', () => {
  it.each([
    ['522 937.0 BYN', 522937],
    ['2 814.0 BYN', 2814],
    ['1 250,50 BYN', 1251],
  ])('parses %s', (raw, expected) => {
    expect(parseMoney(raw)).toBe(expected);
  });

  it.each([undefined, '', 'по запросу', '0 BYN'])('returns undefined for %p', raw => {
    expect(parseMoney(raw)).toBeUndefined();
  });
});

describe('parseUnits', () => {
  it('extracts a unit with its area, prices and stable id', () => {
    const [unit] = parseUnits(UNIT_ROW, 'ЖК Белые Росы');
    expect(unit).toMatchObject({
      uid: 'prometr:38539',
      source: 'prometr',
      complex: 'ЖК Белые Росы',
      priceByn: 522937,
      pricePerM2Byn: 2814,
      area: 185.8,
      rooms: 4,
    });
    expect(unit.link).toBe(
      'https://prometr.by/newbuild_belarus/grodno/belye-rosy/taunkhausy-v-zhk-belye-rosy_1420/4-komnatnaya-185-8-38539/',
    );
  });

  it('builds a readable title from complex, rooms and area', () => {
    expect(parseUnits(UNIT_ROW, 'ЖК Белые Росы')[0].title).toBe('ЖК Белые Росы, 4-комн., 185.8 м²');
  });

  it('quotes BYN only — prometr publishes no USD figure', () => {
    expect(parseUnits(UNIT_ROW, 'ЖК Белые Росы')[0].priceUsd).toBeUndefined();
  });

  // The page ships a stylesheet mentioning .flats-in__row; matching the bare class name
  // instead of the opening tag produced phantom rows during development.
  it('ignores CSS rules that mention the row class', () => {
    const css = '<style>.flats-in__row {font-size: 16px;padding: 13px 0;}</style>';
    expect(parseUnits(css, 'ЖК Погораны')).toHaveLength(0);
  });

  it('skips rows without a link, which would have no stable id', () => {
    expect(parseUnits(UNIT_ROW.replace(/<a href="[^"]*"><\/a>/, ''), 'ЖК X')).toHaveLength(0);
  });
});

describe('extractBuildingLinks', () => {
  const html = `
    <a href="/newbuild_belarus/grodno/pogorany/dom-2-1_1303/">Дом 2.1</a>
    <a href="/newbuild_belarus/grodno/pogorany/dom-2-2_1304/">Дом 2.2</a>
    <a href="/newbuild_belarus/grodno/pogorany/dom-2-1_1303/">дубль</a>
    <a href="/newbuild_belarus/grodno/pogorany/">сам комплекс</a>`;

  it('finds each building once', () => {
    expect(
      extractBuildingLinks(html, 'https://prometr.by/newbuild_belarus/grodno/pogorany/'),
    ).toEqual([
      '/newbuild_belarus/grodno/pogorany/dom-2-1_1303/',
      '/newbuild_belarus/grodno/pogorany/dom-2-2_1304/',
    ]);
  });

  it('does not treat the complex page itself as a building', () => {
    const links = extractBuildingLinks(
      html,
      'https://prometr.by/newbuild_belarus/grodno/pogorany/',
    );
    expect(links).not.toContain('/newbuild_belarus/grodno/pogorany/');
  });
});

describe('dedupe', () => {
  // Source is derived from the uid prefix, as it is in real data — dedupe only merges
  // across sources, so a fixture that hardcodes one source cannot exercise it.
  const listing = (uid: string, priceUsd?: number, area?: number) => ({
    uid,
    source: uid.split(':')[0] as 'kufar' | 'realt',
    link: 'l',
    title: 't',
    priceUsd,
    area,
    images: [],
  });

  it('collapses the same property listed on two sites', () => {
    // kufar and realt word titles differently, so price+area is the join key.
    const out = dedupe([listing('kufar:1', 120139, 185.8), listing('realt:2', 120139, 185.8)]);
    expect(out).toHaveLength(1);
    expect(out[0].uid).toBe('kufar:1');
  });

  it('keeps distinct properties', () => {
    expect(
      dedupe([listing('kufar:1', 120139, 185.8), listing('realt:2', 99000, 100)]),
    ).toHaveLength(2);
  });

  it('keeps listings without a price or area rather than merging them', () => {
    expect(dedupe([listing('kufar:1'), listing('realt:2')])).toHaveLength(2);
  });

  it('drops a repeated uid', () => {
    expect(dedupe([listing('kufar:1', 1, 1), listing('kufar:1', 1, 1)])).toHaveLength(1);
  });
});

describe('source mappers', () => {
  it('namespaces kufar ids so they cannot collide with realt', () => {
    const [l] = fromKufar([{ adId: 7, link: 'k', title: 'Таунхаус', priceUsd: 1, images: [] }]);
    expect(l.uid).toBe('kufar:7');
    expect(l.source).toBe('kufar');
  });

  it('namespaces realt ids', () => {
    const [l] = fromRealt([{ adId: 7, link: 'r', title: 'Таунхаус', priceUsd: 1, images: [] }]);
    expect(l.uid).toBe('realt:7');
    expect(l.source).toBe('realt');
  });
});

describe('dedupe — same-source collisions', () => {
  const at = (uid: string, source: 'kufar' | 'realt', priceUsd: number, area: number) => ({
    uid,
    source,
    link: 'l',
    title: 't',
    priceUsd,
    area,
    images: [],
  });

  // Identical layouts in one development share price and area; merging them would hide
  // real listings behind a fingerprint that is not a unique key within a single feed.
  it('keeps two same-source listings that share price and area', () => {
    expect(
      dedupe([at('kufar:1', 'kufar', 120139, 185.8), at('kufar:2', 'kufar', 120139, 185.8)]),
    ).toHaveLength(2);
  });

  it('still merges across sources', () => {
    expect(
      dedupe([at('kufar:1', 'kufar', 120139, 185.8), at('realt:2', 'realt', 120139, 185.8)]),
    ).toHaveLength(1);
  });
});
