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
  const { ticker, expiry, strike, type } = req.query;
  if (!ticker || !expiry || !strike || !type) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  const [y, m, d] = (expiry as string).split('-').map(Number);
  const targetTs = Math.floor(new Date(y, m - 1, d, 16, 0, 0).getTime() / 1000);

  try {
    const { cookieStr, crumb } = await getSession();
    const headers = { 'User-Agent': UA, Cookie: cookieStr };
    const cp = crumb ? `&crumb=${encodeURIComponent(crumb)}` : '';

    const metaRes = await ft(
      `https://query2.finance.yahoo.com/v7/finance/options/${ticker}${crumb ? `?crumb=${encodeURIComponent(crumb)}` : ''}`,
      { headers }, 5000
    );
    if (!metaRes.ok) return res.status(502).json({ error: `Yahoo Finance ${metaRes.status}` });

    const metaData = await metaRes.json();
    const root = metaData?.optionChain?.result?.[0];
    if (!root) return res.status(404).json({ error: 'Ticker not found' });

    const expirationDates: number[] = root.expirationDates ?? [];
    if (!expirationDates.length) return res.status(404).json({ error: 'No options available' });

    const closestTs = expirationDates.reduce((best: number, ts: number) =>
      Math.abs(ts - targetTs) < Math.abs(best - targetTs) ? ts : best
    );

    let chain = root.options?.[0];
    if (chain?.expirationDate !== closestTs) {
      const optRes = await ft(
        `https://query2.finance.yahoo.com/v7/finance/options/${ticker}?date=${closestTs}${cp}`,
        { headers }, 5000
      );
      if (!optRes.ok) return res.status(502).json({ error: `Yahoo Finance ${optRes.status}` });
      const optData = await optRes.json();
      chain = optData?.optionChain?.result?.[0]?.options?.[0];
    }

    const contracts: any[] = type === 'call' ? (chain?.calls ?? []) : (chain?.puts ?? []);
    if (!contracts.length) return res.status(404).json({ error: 'No contracts found' });

    const strikeNum = parseFloat(strike as string);
    const contract = contracts.reduce((best: any, opt: any) =>
      Math.abs(opt.strike - strikeNum) < Math.abs(best.strike - strikeNum) ? opt : best
    );

    const bid: number = contract.bid ?? 0;
    const ask: number = contract.ask ?? 0;
    const marketOptionPrice = bid > 0 && ask > 0 ? (bid + ask) / 2 : (contract.lastPrice ?? 0);

    return res.status(200).json({
      underlyingPrice: root.quote?.regularMarketPrice ?? 0,
      marketOptionPrice,
      iv: (contract.impliedVolatility ?? 0) * 100,
      contractSymbol: contract.contractSymbol ?? '',
      change: contract.change ?? 0,
      percentChange: contract.percentChange ?? 0,
      actualExpiry: new Date(closestTs * 1000).toISOString().slice(0, 10),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ error: `Server error: ${msg}` });
  }
}
