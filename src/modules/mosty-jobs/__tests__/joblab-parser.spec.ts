import { parseJoblabRss } from '../joblab-parser.service';
import { JOBLAB_RSS_XML } from './fixtures/joblab-rss';

describe('parseJoblabRss', () => {
  const vacancies = parseJoblabRss(JOBLAB_RSS_XML);

  it('parses all feed items', () => {
    expect(vacancies).toHaveLength(3);
  });

  it('extracts title, url and source', () => {
    expect(vacancies?.[0]).toMatchObject({
      url: 'https://joblab.by/vacancy/578582',
      source: 'joblab',
      title: 'Контролер-кассир (г. Мосты)',
    });
  });

  it('extracts employer, address and salary from the description meta line', () => {
    expect(vacancies?.[0].employer).toBe('ООО "Санта Ритейл"');
    expect(vacancies?.[0].address).toBe('Мосты');
    expect(vacancies?.[0].salary).toBe('от 1 340 руб.');
  });

  it('returns an empty list for a valid feed without items', () => {
    expect(parseJoblabRss('<rss version="2.0"><channel></channel></rss>')).toEqual([]);
  });

  it('returns null for a non-RSS payload (block page / layout change)', () => {
    expect(parseJoblabRss('<html><body>error</body></html>')).toBeNull();
  });

  it('deduplicates items with the same link', () => {
    const doubled = JOBLAB_RSS_XML.replace('</channel>', '') + '</channel></rss>';
    const fromDoubled = parseJoblabRss(doubled + JOBLAB_RSS_XML);
    expect(fromDoubled?.length).toBe(3);
  });
});
