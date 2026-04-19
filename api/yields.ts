export default async function handler(_req: any, res: any) {
  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

  try {
    const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${yyyymm}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Treasury fetch failed');

    const xml = await response.text();

    // Get last <entry> block = most recent trading day
    const lastEntry = xml.split('<entry>').pop() ?? '';

    const get = (tag: string): number => {
      const match = lastEntry.match(new RegExp(`<d:${tag}[^>]*>([\\d.]+)<`));
      return match ? parseFloat(match[1]) : 0;
    };

    return res.status(200).json({
      '1m':  get('BC_1MONTH'),
      '3m':  get('BC_3MONTH'),
      '6m':  get('BC_6MONTH'),
      '1y':  get('BC_1YEAR'),
      '2y':  get('BC_2YEAR'),
      '5y':  get('BC_5YEAR'),
      '10y': get('BC_10YEAR'),
      '20y': get('BC_20YEAR'),
      '30y': get('BC_30YEAR'),
    });
  } catch {
    return res.status(502).json({ error: 'Could not fetch Treasury yields' });
  }
}
