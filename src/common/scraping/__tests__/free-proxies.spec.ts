import { parseProxyList } from '../free-proxies';

describe('parseProxyList', () => {
  it('keeps public IPv4 HTTP proxies as ip:port', () => {
    expect(parseProxyList('http://93.84.1.2:8080\r\nhttps://178.124.9.9:3128\n')).toEqual([
      '93.84.1.2:8080',
      '178.124.9.9:3128',
    ]);
  });

  it('drops private, loopback, link-local and malformed entries', () => {
    const list = [
      'http://10.0.0.1:80',
      'http://127.0.0.1:80',
      'http://169.254.169.254:80',
      'http://192.168.1.1:80',
      'http://100.64.0.1:80',
      'http://proxy.example.com:80',
      'socks5://93.84.1.2:1080',
      'http://93.84.1.2:0',
      'http://93.84.1.2:70000',
      'http://999.1.1.1:80',
    ].join('\n');
    expect(parseProxyList(list)).toEqual([]);
  });
});
