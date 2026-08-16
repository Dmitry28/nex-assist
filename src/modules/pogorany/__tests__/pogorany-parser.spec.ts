import type { ConfigService } from '@nestjs/config';
import { PogoranyParserService } from '../pogorany-parser.service';

jest.mock('../../../common/utils/sleep', () => ({ sleep: (): Promise<void> => Promise.resolve() }));

const STORE_API = 'https://store.tildaapi.com/api/getproductslist/?storepartuid=856309636292';

const parserWith = (apiUrl: string): PogoranyParserService =>
  new PogoranyParserService({ getOrThrow: () => apiUrl } as unknown as ConfigService);

/** Answers each requested URL from `bodies`, and records the order they were asked for. */
const serve = (bodies: Record<string, string>): string[] => {
  const seen: string[] = [];
  global.fetch = jest.fn((url: string) => {
    seen.push(url);
    const body = bodies[url];
    return Promise.resolve({
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      headers: { get: (): null => null },
      text: () => Promise.resolve(body ?? ''),
    });
  }) as unknown as typeof fetch;
  return seen;
};

// Tilda moved this account to the .biz root zone around 4 Aug 2026. The old host answers
// `{"redirectto":"biz"}` — valid JSON with no products — so the module reported an empty
// catalog every run instead of a broken endpoint. Tilda's own catalog script follows the hint.
describe('PogoranyParserService — a store that moved root zone', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('follows the redirectto hint to the same host on the new zone', async () => {
    const moved = STORE_API.replace('tildaapi.com', 'tildaapi.biz');
    const product = {
      uid: 369635771192,
      title: 'Квартира 90 м² в таунхаусе',
      url: 'https://pogorany.by/tproduct/369635771192-kvartira',
    };
    const seen = serve({
      [STORE_API]: JSON.stringify({ redirectto: 'biz' }),
      [moved]: JSON.stringify({ products: [product] }),
      [product.url]: '<html></html>',
    });

    const listings = await parserWith(STORE_API).fetch();

    expect(seen.slice(0, 2)).toEqual([STORE_API, moved]);
    expect(listings.map(l => l.uid)).toEqual([product.uid]);
  });

  it('does not hop twice, so a zone that keeps redirecting cannot loop', async () => {
    const seen = serve({
      [STORE_API]: JSON.stringify({ redirectto: 'biz' }),
      [STORE_API.replace('tildaapi.com', 'tildaapi.biz')]: JSON.stringify({ redirectto: 'biz' }),
    });

    expect(await parserWith(STORE_API).fetch()).toEqual([]);
    expect(seen).toHaveLength(2);
  });

  it('reads a normal response without any extra request', async () => {
    const seen = serve({ [STORE_API]: JSON.stringify({ products: [] }) });

    expect(await parserWith(STORE_API).fetch()).toEqual([]);
    expect(seen).toEqual([STORE_API]);
  });
});
