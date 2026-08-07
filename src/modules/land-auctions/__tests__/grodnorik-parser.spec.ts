import { parseNotices, parseNoticeDate } from '../grodnorik-parser.service';

const PAGE_URL = 'https://grodnorik.gov.by/ru/auctions/';

/** Mirrors the real page: freeform WYSIWYG markup, <hr> separators inside anchors, duplicates. */
const HTML = `
<div class="inner_text clearfix"><hr />
<div style="text-align: center;"><b>2026</b></div>
<div>
  <div><a href="/uploads/files/materialy/aukciony/2026/auktsion-Skidel-selo-7-08-2026.pdf"><hr />Извещение о&nbsp;проведении 7 августа 2026 г. аукциона по продаже в частную собственность
  земельных участков</a></div>
  <div><a href="/uploads/files/materialy/aukciony/2026/auktsion-Dorgun-30-07-2026.pdf">Извещение о проведении 26 августа 2026 года аукциона по продаже пустующего дома</a></div>
  <div><a href="/uploads/files/materialy/aukciony/2026/Izveschenie-o-provedenii-elektronnyx-torgov.pdf">Извещение о проведении повторных электронных торгов</a></div>
</div>
<div><a href="/uploads/files/materialy/aukciony/2025/Informatsija-po-auktsionu-30.06.2025.pdf">ИНФОРМАЦИЯ О ПРОВЕДЕНИИ 30.06.2025 АУКЦИОНА ПО ПРОДАЖЕ ЗЕМЕЛЬНЫХ УЧАСТКОВ</a></div>
<div><a href="/uploads/files/materialy/aukciony/2025/Izveschenie-Rydeli-1S.doc">Извещение о проведении аукциона по продаже земельных участков</a></div>
<div><a href="/ru/economy/">Экономика</a></div>
<div><a href="/uploads/files/materialy/aukciony/2026/auktsion-Dorgun-30-07-2026.pdf"><hr /></a></div>
</div>`;

describe('parseNoticeDate', () => {
  it('parses a spelled-out month', () =>
    expect(parseNoticeDate('Извещение о проведении 7 августа 2026 г. аукциона')).toBe(
      '07.08.2026',
    ));

  it('parses a spelled-out month written in caps', () =>
    expect(parseNoticeDate('АУКЦИОН 27 ИЮНЯ 2025 г.')).toBe('27.06.2025'));

  it('parses "26 августа 2026 года"', () =>
    expect(parseNoticeDate('Извещение о проведении 26 августа 2026 года аукциона')).toBe(
      '26.08.2026',
    ));

  it('parses a numeric date', () =>
    expect(parseNoticeDate('ИНФОРМАЦИЯ О ПРОВЕДЕНИИ 30.06.2025 АУКЦИОНА')).toBe('30.06.2025'));

  it('pads a single-digit numeric date', () =>
    expect(parseNoticeDate('Аукцион 3.04.2026 г.')).toBe('03.04.2026'));

  it('returns undefined when the title carries no date', () =>
    expect(parseNoticeDate('Извещение о проведении аукциона по продаже земельных участков')).toBe(
      undefined,
    ));
});

describe('parseNotices', () => {
  const notices = parseNotices(HTML, PAGE_URL);
  const byPath = (fragment: string) => notices.find(n => n.link.includes(fragment));

  it('picks up every notice file and ignores unrelated links', () => {
    expect(notices).toHaveLength(5);
    expect(notices.every(n => n.link.includes('/materialy/aukciony/'))).toBe(true);
  });

  it('resolves relative hrefs against the page URL', () =>
    expect(byPath('auktsion-Skidel-selo')?.link).toBe(
      'https://grodnorik.gov.by/uploads/files/materialy/aukciony/2026/auktsion-Skidel-selo-7-08-2026.pdf',
    ));

  it('strips inner tags, decodes entities and collapses whitespace in the title', () =>
    expect(byPath('auktsion-Skidel-selo')?.title).toBe(
      'Извещение о проведении 7 августа 2026 г. аукциона по продаже в частную собственность земельных участков',
    ));

  it('parses the auction date out of the title', () =>
    expect(byPath('auktsion-Skidel-selo')?.auctionDate).toBe('07.08.2026'));

  it('leaves auctionDate unset when the title has no date', () =>
    expect(byPath('elektronnyx-torgov')?.auctionDate).toBe(undefined));

  it('deduplicates a file linked twice, keeping the titled anchor', () => {
    const dupes = notices.filter(n => n.link.includes('auktsion-Dorgun'));
    expect(dupes).toHaveLength(1);
    expect(dupes[0].title).toContain('пустующего дома');
  });

  it('tracks .doc notices too, not just .pdf', () =>
    expect(byPath('Izveschenie-Rydeli')).toBeDefined());

  it('falls back to the file name when no anchor carries text', () => {
    const [notice] = parseNotices(
      '<a href="/uploads/files/materialy/aukciony/2026/Auktsion-13-marta-2026.pdf"><hr /></a>',
      PAGE_URL,
    );
    expect(notice.title).toBe('Auktsion-13-marta-2026');
  });

  it('returns an empty array for a page with no notices', () =>
    expect(parseNotices('<div>Архив пуст</div>', PAGE_URL)).toEqual([]));
});
