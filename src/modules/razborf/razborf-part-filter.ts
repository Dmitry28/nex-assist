/**
 * Which of the model's categories are worth a request: the parts the owner shops for, for both
 * cars (the yard has a single "Atlas restailing 2" model, 2023-2026, that covers both).
 * Mirrors the bamper.by feeds — rear: bumper, tailgate, windshield, rear-left door molding;
 * front: bumper, hood, left headlight, radiator support ("телевизор").
 *
 * Matched on the category title shown in the model's part index. Character classes are spelled
 * out because JavaScript's `\b`/`\w` are ASCII-only and useless on Cyrillic.
 */
const WANTED_PARTS: RegExp[] = [
  /бампер\s+(?:задний|передний)/i,
  /(?:крышка|дверь)\s+багажника/i,
  /^лобово[а-яё]*\s+стекл|^стекл[а-яё]*\s+лобово/i,
  /молдинг.*двери\s+задней\s+левой|молдинг.*задней\s+левой\s+двери/i,
  /^капот/i,
  /^фара\s+(?:передняя\s+)?левая/i,
  /панель\s+крепления\s+облицовки|телевизор/i,
];

/** True when the category name is one of the parts the owner is shopping for. */
export const isWantedPart = (name: string): boolean => WANTED_PARTS.some(re => re.test(name));
