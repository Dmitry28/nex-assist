import { dedupeKey } from '../mosty-jobs-dedupe';

describe('dedupeKey', () => {
  it('matches the same vacancy across sources despite a trailing parenthetical', () => {
    const gsz = { title: 'Контролер-кассир', employer: 'ООО "Санта Ритейл"' };
    const joblab = { title: 'Контролер-кассир (г. Мосты)', employer: 'ООО «Санта Ритейл»' };
    expect(dedupeKey(gsz)).toBe(dedupeKey(joblab));
  });

  it('is case- and whitespace-insensitive', () => {
    expect(dedupeKey({ title: 'Водитель  Автомобиля', employer: 'ОАО "Мостовдрев"' })).toBe(
      dedupeKey({ title: 'водитель автомобиля', employer: 'ОАО Мостовдрев' }),
    );
  });

  it('distinguishes different employers with the same title', () => {
    expect(dedupeKey({ title: 'Продавец', employer: 'Санта' })).not.toBe(
      dedupeKey({ title: 'Продавец', employer: 'Копеечка' }),
    );
  });

  it('ignores the employer legal form prefix', () => {
    expect(dedupeKey({ title: 'Кассир', employer: 'Евроопт' })).toBe(
      dedupeKey({ title: 'Кассир', employer: 'ООО «Евроопт»' }),
    );
  });

  it('treats missing employer as empty', () => {
    expect(dedupeKey({ title: 'Продавец' })).toBe(dedupeKey({ title: 'Продавец', employer: '' }));
  });
});
