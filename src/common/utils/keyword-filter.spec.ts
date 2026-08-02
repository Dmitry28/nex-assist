import { matchesKeywords, TOWNHOUSE_KEYWORDS } from './keyword-filter';

describe('matchesKeywords', () => {
  it('matches case-insensitively', () => {
    expect(matchesKeywords('ТАУНХАУС в центре', ['таунхаус'])).toBe(true);
  });

  it('matches a substring inside a longer word', () => {
    // "блокирован" must match the declined forms sellers actually write.
    expect(matchesKeywords('Квартира в блокированном доме', ['блокирован'])).toBe(true);
  });

  it('does not match unrelated text', () => {
    expect(matchesKeywords('2-комнатная квартира с ремонтом', TOWNHOUSE_KEYWORDS)).toBe(false);
  });

  it('returns false for an empty keyword list', () => {
    expect(matchesKeywords('таунхаус', [])).toBe(false);
  });
});

describe('TOWNHOUSE_KEYWORDS', () => {
  // Real listing titles found in the Grodno zone.
  it.each([
    'Квартира в блокированном доме',
    'Квартира в блокированном жилом доме с отдельным входом',
    'Таунхаус премиум-класса ЖК "Белые Росы"',
    'Блокированный дом (квадрохаус)',
    'ПРОДАЖА ТАУНХАУСОВ В ГРОДНО РАЙОН ЮЖНЫЙ',
  ])('matches %s', title => {
    expect(matchesKeywords(title, TOWNHOUSE_KEYWORDS)).toBe(true);
  });

  it.each(['2-комнатная квартира, Девятовка', 'Дом с участком у реки', 'Дача СТ Магистраль'])(
    'does not match %s',
    title => {
      expect(matchesKeywords(title, TOWNHOUSE_KEYWORDS)).toBe(false);
    },
  );
});
