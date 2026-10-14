import { BlockList, isIPv4 } from 'node:net';
import type { Logger } from '@nestjs/common';
import { ProxyAgent, fetch } from 'undici';
import { BROWSER_USER_AGENT } from '../utils/scraping';

/**
 * Free rung for geo-fenced sites: public proxies of the site's country, tried before the paid
 * providers. Measured in nexo-assist (2026-10-13): Belarusian proxies open idriver, av.by and
 * bamper, not bid.cars. They live for minutes, so this rung often fails — it only saves credits
 * when it works; the paid chain stays the guarantee.
 */

// Two public lists, re-checked by their maintainers every few minutes. Two because each is thin
// and they disagree.
const LISTS: readonly { url: (country: string) => string; read: (body: string) => string }[] = [
  {
    url: country =>
      `https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/countries/${country.toUpperCase()}/data.txt`,
    read: body => body,
  },
  {
    url: country =>
      `https://proxylist.geonode.com/api/proxy-list?limit=100&page=1&country=${country.toUpperCase()}`,
    // JSON → the same `http://ip:port` lines as the first list, HTTP proxies only.
    read: body => {
      const data: unknown = (JSON.parse(body) as { data?: unknown }).data;
      if (!Array.isArray(data)) return '';
      return data
        .filter(
          (e): e is { ip: unknown; port: unknown; protocols: unknown[] } =>
            typeof e === 'object' &&
            e !== null &&
            Array.isArray((e as { protocols?: unknown }).protocols),
        )
        .filter(e => e.protocols.some(p => p === 'http' || p === 'https'))
        .map(e => `http://${String(e.ip)}:${String(e.port)}`)
        .join('\n');
    },
  },
];
const LIST_TIMEOUT_MS = 5_000;
const MAX_LIST_LENGTH = 1024 * 1024;
/** Proxies tried at once, and the cap on the whole race — the paid rung still needs its time. */
const RACE_SIZE = 3;
const RACE_CAP_MS = 20_000;

// Addresses a list entry must never point us at: loopback, private, link-local (cloud metadata),
// CGNAT, documentation, benchmark, multicast, reserved.
const NOT_PUBLIC = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const) {
  NOT_PUBLIC.addSubnet(net, prefix, 'ipv4');
}

/**
 * Usable list entries as `ip:port`: HTTP proxies on a public IPv4 literal — no host names (no DNS
 * to rebind), no SOCKS (undici's ProxyAgent speaks HTTP CONNECT).
 */
export const parseProxyList = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map(line => /^https?:\/\/(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(line.trim()))
    .filter(match => match !== null)
    .filter(
      ([, ip, port]) => isIPv4(ip) && !NOT_PUBLIC.check(ip, 'ipv4') && +port > 0 && +port < 65536,
    )
    .map(([, ip, port]) => `${ip}:${port}`);

// Per process — one daily run. A proxy that failed leaves the list; the one that worked goes first.
const lists = new Map<string, Promise<string[]>>();
const lastGood = new Map<string, string>();

const loadList = async (country: string): Promise<string[]> => {
  const texts = await Promise.all(
    LISTS.map(async list => {
      try {
        const res = await fetch(list.url(country), {
          signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
        });
        if (!res.ok) return '';
        return list.read((await res.text()).slice(0, MAX_LIST_LENGTH));
      } catch {
        return '';
      }
    }),
  );
  return [...new Set(texts.flatMap(parseProxyList))];
};

export interface FreeProxyOptions {
  logger: Logger;
  label: string;
  /** ISO country code, e.g. `by`. */
  country: string;
  isUsable: (html: string) => boolean;
  timeoutMs: number;
  maxBytes: number;
}

/**
 * Races a few of the country's free proxies; the first to return a usable page wins. Returns
 * null when none did. https only: the proxy then just tunnels TLS, so all a stranger's proxy can
 * do is fail — it cannot read or alter the page.
 */
export const fetchViaFreeProxy = async (
  url: string,
  o: FreeProxyOptions,
): Promise<string | null> => {
  if (!url.startsWith('https://')) return null;

  const listed = lists.get(o.country) ?? loadList(o.country);
  lists.set(o.country, listed);
  const sticky = lastGood.get(o.country);
  const picks = [...(sticky ? [sticky] : []), ...(await listed).filter(p => p !== sticky)].slice(
    0,
    RACE_SIZE,
  );
  if (picks.length === 0) {
    // The lists turn over every few minutes — ask again next time rather than give up for the run.
    lists.delete(o.country);
    o.logger.warn(`${o.label}: no free ${o.country} proxy listed`);
    return null;
  }

  const race = new AbortController();
  const timer = setTimeout(() => race.abort(), Math.min(o.timeoutMs, RACE_CAP_MS));
  const attempt = async (proxy: string): Promise<{ proxy: string; html: string }> => {
    const dispatcher = new ProxyAgent(`http://${proxy}`);
    try {
      const res = await fetch(url, {
        dispatcher,
        signal: race.signal,
        headers: { 'User-Agent': BROWSER_USER_AGENT, 'Accept-Language': 'ru-RU,ru;q=0.9' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      if (html.length > o.maxBytes || !o.isUsable(html)) throw new Error('not the page');
      return { proxy, html };
    } finally {
      await dispatcher.close().catch(() => undefined);
    }
  };

  try {
    const { proxy, html } = await Promise.any(picks.map(attempt));
    lastGood.set(o.country, proxy);
    o.logger.log(`${o.label}: fetched via free ${o.country} proxy ${proxy}`);
    return html;
  } catch {
    // Whatever failed through a stranger's proxy says something about that proxy, not the URL.
    if (sticky && picks.includes(sticky)) lastGood.delete(o.country);
    lists.set(
      o.country,
      listed.then(all => all.filter(p => !picks.includes(p))),
    );
    o.logger.warn(`${o.label}: ${picks.length} free ${o.country} proxies failed`);
    return null;
  } finally {
    clearTimeout(timer);
    // The losers' requests: nobody waits for them.
    race.abort();
  }
};
