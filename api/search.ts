const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export default async function handler(req: any, res: any) {
  const { q } = req.query;
  if (!q || (q as string).trim().length < 1) return res.status(200).json([]);

  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), 4000);

    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q as string)}&quotesCount=8&newsCount=0&enableFuzzyQuery=false`;
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(id));

    if (!r.ok) return res.status(200).json([]);

    const data = await r.json();
    const quotes: any[] = data?.quotes ?? [];

    const results = quotes
      .filter((item: any) => item.quoteType === 'EQUITY' || item.quoteType === 'ETF')
      .slice(0, 8)
      .map((item: any) => ({
        symbol: item.symbol as string,
        name: (item.shortname || item.longname || '') as string,
        type: item.quoteType as string,
      }));

    return res.status(200).json(results);
  } catch {
    return res.status(200).json([]);
  }
}
