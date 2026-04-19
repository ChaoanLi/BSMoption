const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function ft(url: string, opts: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

async function getSession(): Promise<{ cookieStr: string; crumb: string }> {
  let cookieStr = '';
  try {
    const r = await ft('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual' }, 3000);
    const fn = (r.headers as any).getSetCookie;
    const arr: string[] = typeof fn === 'function' ? fn.call(r.headers) : [];
    cookieStr = arr.map((c: string) => c.split(';')[0]).join('; ');
  } catch { /* no cookies */ }

  let crumb = '';
  try {
    const r = await ft('https://query1.finance.yahoo.com/v1/test/getcrumb',
      { headers: { 'User-Agent': UA, Cookie: cookieStr } }, 3000);
    if (r.ok) {
      const t = await r.text();
      if (t && t !== 'null' && !t.startsWith('<')) crumb = t;
    }
  } catch { /* no crumb */ }

  return { cookieStr, crumb };
}

export default async function handler(req: any, res: any) {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' });

  try {
    const { cookieStr, crumb } = await getSession();
    const cp = crumb ? `?crumb=${encodeURIComponent(crumb)}` : '';
    const url = `https://query2.finance.yahoo.com/v7/finance/options/${ticker}${cp}`;

    const response = await ft(url, { headers: { 'User-Agent': UA, Cookie: cookieStr } }, 5000);
    if (!response.ok) return res.status(502).json({ error: `Yahoo Finance ${response.status}` });

    const data = await response.json();
    const timestamps: number[] = data?.optionChain?.result?.[0]?.expirationDates ?? [];
    const dates = timestamps.map((ts: number) => new Date(ts * 1000).toISOString().slice(0, 10));

    return res.status(200).json(dates);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ error: `Server error: ${msg}` });
  }
}
