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
  const { ticker, expiry } = req.query;
  if (!ticker || !expiry) return res.status(400).json({ error: 'Missing parameters' });

  const [y, m, d] = (expiry as string).split('-').map(Number);
  const targetTs = Math.floor(new Date(y, m - 1, d, 16, 0, 0).getTime() / 1000);

  try {
    const { cookieStr, crumb } = await getSession();
    const headers = { 'User-Agent': UA, Cookie: cookieStr };
    const cpQ = crumb ? `?crumb=${encodeURIComponent(crumb)}` : '';
    const cpA = crumb ? `&crumb=${encodeURIComponent(crumb)}` : '';

    const metaRes = await ft(
      `https://query2.finance.yahoo.com/v7/finance/options/${ticker}${cpQ}`,
      { headers }, 5000
    );
    if (!metaRes.ok) return res.status(502).json({ error: `Yahoo Finance ${metaRes.status}` });

    const metaData = await metaRes.json();
    const root = metaData?.optionChain?.result?.[0];
    if (!root) return res.status(404).json({ error: 'Ticker not found' });

    const underlyingPrice: number = root.quote?.regularMarketPrice ?? 0;
    const expirationDates: number[] = root.expirationDates ?? [];

    const closestTs = expirationDates.reduce((best: number, ts: number) =>
      Math.abs(ts - targetTs) < Math.abs(best - targetTs) ? ts : best
    );

    let chain = root.options?.[0];
    if (chain?.expirationDate !== closestTs) {
      const optRes = await ft(
        `https://query2.finance.yahoo.com/v7/finance/options/${ticker}?date=${closestTs}${cpA}`,
        { headers }, 5000
      );
      if (!optRes.ok) return res.status(502).json({ error: `Yahoo Finance ${optRes.status}` });
      const optData = await optRes.json();
      chain = optData?.optionChain?.result?.[0]?.options?.[0];
    }

    const callStrikes: number[] = (chain?.calls ?? []).map((c: any) => c.strike);
    const putStrikes: number[] = (chain?.puts ?? []).map((p: any) => p.strike);
    const strikes = [...new Set([...callStrikes, ...putStrikes])].sort((a, b) => a - b);

    return res.status(200).json({ strikes, underlyingPrice });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ error: `Server error: ${msg}` });
  }
}
