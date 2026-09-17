import { isWantedPart } from '../idriver-part-filter';

describe('isWantedPart', () => {
  it.each([
    'Бампер задний',
    'Бампер задний в сборе',
    'Задний бампер',
    'Крышка багажника',
    'Дверь багажника',
    'Лобовое стекло',
    'Стекло лобовое (ветровое)',
  ])('keeps %s', part => expect(isWantedPart(part)).toBe(true));

  it.each([
    'Дефлектор обдува салона',
    'Коврик центральной консоли',
    'Антенна',
    'Лямбда-зонд',
    'Дуги на крышу (рейлинги)',
    // Rear-bumper neighbours that are not the bumper: the reinforcement bar and the boot trim.
    'Усилитель заднего бампера',
    'Обшивка багажника',
    // Other glass — the windshield is the only one worth a message.
    'Стекло двери задней левой',
  ])('drops %s', part => expect(isWantedPart(part)).toBe(false));
});
