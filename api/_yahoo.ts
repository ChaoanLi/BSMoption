export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BASE_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

const timeout = (ms: number) => AbortSignal.timeout(ms);

async function getCookies(): Promise<string> {
  try {
    const r = await fetch('https://fc.yahoo.com', {
      headers: BASE_HEADERS,
      redirect: 'manual',
      signal: timeout(3000),
    });
    const getSetCookie = (r.headers as any).getSetCookie;
    const arr: string[] = typeof getSetCookie === 'function'
      ? getSetCookie.call(r.headers)
      : [];
    if (arr.length > 0) return arr.map(c => c.split(';')[0]).join('; ');
  } catch { /* fall through */ }

  try {
    const r = await fetch('https://finance.yahoo.com', {
      headers: BASE_HEADERS,
      signal: timeout(4000),
    });
    const raw = r.headers.get('set-cookie') ?? '';
    const parts = raw.split(/,(?=[^ ])/).map(c => c.split(';')[0].trim()).filter(Boolean);
    if (parts.length > 0) return parts.join('; ');
  } catch { /* give up on cookies */ }

  return '';
}

async function getCrumb(cookieStr: string): Promise<string> {
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v1/test/getcrumb`, {
        headers: { ...BASE_HEADERS, Cookie: cookieStr },
        signal: timeout(3000),
      });
      if (r.ok) {
        const text = await r.text();
        if (text && text !== 'null' && !text.startsWith('<')) return text;
      }
    } catch { /* try next */ }
  }
  return '';
}

export async function getYahooSession(): Promise<{ cookieStr: string; crumb: string }> {
  const cookieStr = await getCookies();
  const crumb = await getCrumb(cookieStr);
  return { cookieStr, crumb };
}
