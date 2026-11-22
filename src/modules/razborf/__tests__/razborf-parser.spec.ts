import { readFileSync } from 'fs';
import { join } from 'path';
import { isWantedPart } from '../razborf-part-filter';
import {
  isCategoryPage,
  isModelPage,
  parseRazborfCategories,
  parseRazborfListings,
} from '../razborf-parser.service';

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

const MODEL_URL = 'https://razborf.by/razborka/volkswagen/atlas-restailing-2';

describe('razborf parser', () => {
  it('reads wanted categories from the model part index', () => {
    const html = fixture('model-atlas-restailing-2.html');
    expect(isModelPage(html)).toBe(true);
    const names = parseRazborfCategories(html, MODEL_URL)
      .map(c => c.name)
      .filter(isWantedPart);
    expect(names).toEqual(
      expect.arrayContaining([
        'Бампер задний',
        'Крышка багажника (дверь 3-5)',
        'Фара передняя левая',
      ]),
    );
    expect(names).not.toContain('Амортизатор капота');
    expect(names).not.toContain('Фара передняя правая');
  });

  it('parses listings of a category page', () => {
    const html = fixture('category-bamper-zadniy.html');
    expect(isCategoryPage(html)).toBe(true);
    const listings = parseRazborfListings(html, 'Бампер задний');
    expect(listings).toHaveLength(2);
    expect(listings[0]).toMatchObject({
      id: '120700997',
      url: 'https://razborf.by/razborka/volkswagen/atlas-restailing-2/bamper-zadniy/120700997',
      part: 'Бампер задний',
      year: 2024,
      priceByn: 3887,
      carSpec: '2.0 Бензин, АКПП',
      description: 'Запчасти из США. Состояние как на фото. Дополнительную информацию уточняйте',
    });
    expect(listings[0].photoUrl).toMatch(/^https:\/\/2\.i077\.ru\//);
  });
});

describe('isWantedPart', () => {
  it.each([
    'Бампер задний',
    'Бампер передний',
    'Капот',
    'Стекло лобовое',
    'Фара передняя левая',
    'Молдинг (накладка) двери задней левой',
    'Панель передняя (телевизор)',
  ])('accepts %s', name => expect(isWantedPart(name)).toBe(true));

  it.each([
    'Амортизатор капота',
    'Фара передняя правая',
    'Молдинг (накладка) двери задней правой',
    'Защита заднего бампера',
    'Форсунка омывателя лобового стекла',
  ])('rejects %s', name => expect(isWantedPart(name)).toBe(false));
});
