import React, { useState, useEffect, useMemo } from 'react';
import { Header } from './components/Header';
import { CalculatorInput } from './components/CalculatorInput';
import { calculateBSM } from './utils/bsm';
import { calculateAmericanOption } from './utils/american';
import { OptionType, ModelType, PricingResult } from './types';
import { Lang, translations } from './utils/i18n';
import { RefreshCw, Calendar, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';

// Fallback yield curve used when /api/yields is unavailable (local dev)
const FALLBACK_YIELD_CURVE = [
  { t: 1/12, r: 4.3 },
  { t: 0.25, r: 4.3 },
  { t: 0.5,  r: 4.2 },
  { t: 1.0,  r: 4.1 },
  { t: 2.0,  r: 4.1 },
  { t: 5.0,  r: 4.3 },
  { t: 10.0, r: 4.5 },
  { t: 30.0, r: 4.7 },
];

type YieldPoint = { t: number; r: number };

const buildCurve = (live: Record<string, number> | null): YieldPoint[] => {
  if (!live) return FALLBACK_YIELD_CURVE;
  return [
    { t: 1/12, r: live['1m'] || 4.3 },
    { t: 0.25, r: live['3m'] || 4.3 },
    { t: 0.5,  r: live['6m'] || 4.2 },
    { t: 1.0,  r: live['1y'] || 4.1 },
    { t: 2.0,  r: live['2y'] || 4.1 },
    { t: 5.0,  r: live['5y'] || 4.3 },
    { t: 10.0, r: live['10y'] || 4.5 },
    { t: 30.0, r: live['30y'] || 4.7 },
  ];
};

const getRiskFreeRate = (T: number, curve: YieldPoint[]): number => {
  if (T <= curve[0].t) return curve[0].r;
  const last = curve[curve.length - 1];
  if (T >= last.t) return last.r;
  for (let i = 0; i < curve.length - 1; i++) {
    const p1 = curve[i], p2 = curve[i + 1];
    if (T >= p1.t && T < p2.t) {
      return p1.r + (p2.r - p1.r) * ((T - p1.t) / (p2.t - p1.t));
    }
  }
  return last.r;
};

const getNYParts = (date: Date = new Date()) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {} as Record<string, string>);

const getNYDateStr = () => {
  const p = getNYParts();
  return `${p.year}-${p.month}-${p.day}`;
};

// --- API helpers (call Vercel serverless functions) ---

interface MarketDataError   { status: 'error'; message: string }
interface MarketDataSuccess {
  status: 'success';
  underlyingPrice: number;
  marketOptionPrice: number;
  iv: number;
  contractSymbol: string;
  change: number;
  percentChange: number;
}
type MarketDataResult = MarketDataError | MarketDataSuccess;

const fetchOptionData = async (
  ticker: string,
  maturityDate: string,
  optionType: OptionType,
  strikePrice: string,
): Promise<MarketDataResult> => {
  try {
    const params = new URLSearchParams({
      ticker,
      expiry: maturityDate,
      strike: strikePrice,
      type: optionType === OptionType.Call ? 'call' : 'put',
    });
    const res = await fetch(`/api/options?${params}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { status: 'error', message: (data as any).error ?? `HTTP ${res.status}` };
    return { status: 'success', ...data };
  } catch {
    return { status: 'error', message: 'Network Error' };
  }
};

const fetchStrikes = async (ticker: string, expiry: string): Promise<{ strikes: number[]; underlyingPrice: number } | null> => {
  try {
    const res = await fetch(`/api/strikes?ticker=${encodeURIComponent(ticker)}&expiry=${encodeURIComponent(expiry)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

const fetchExpiries = async (ticker: string): Promise<string[]> => {
  try {
    const res = await fetch(`/api/expiries?ticker=${encodeURIComponent(ticker)}`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
};

const fetchTreasuryYields = async (): Promise<Record<string, number> | null> => {
  try {
    const res = await fetch('/api/yields');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

// --- App ---

const App: React.FC = () => {
  const [lang, setLang] = useState<Lang>('en');
  const t = translations[lang];

  const [ticker, setTicker] = useState('NVDA');
  const [optionType, setOptionType] = useState<OptionType>(OptionType.Call);
  const [modelType, setModelType] = useState<ModelType>(ModelType.European);

  const [availableExpiries, setAvailableExpiries] = useState<string[]>([]);
  const [loadingExpiries, setLoadingExpiries] = useState(false);
  const [availableStrikes, setAvailableStrikes] = useState<number[]>([]);
  const [loadingStrikes, setLoadingStrikes] = useState(false);

  const todayNYStr = useMemo(() => getNYDateStr(), []);

  const [maturityDate, setMaturityDate] = useState('2026-06-20');
  const [evaluationDate, setEvaluationDate] = useState(todayNYStr);

  const [strikePrice, setStrikePrice] = useState('140.00');
  const [underlyingPrice, setUnderlyingPrice] = useState('135.50');
  const [volatility, setVolatility] = useState('45.00');
  const [riskFreeRate, setRiskFreeRate] = useState('4.10');

  const [marketOptionPrice, setMarketOptionPrice] = useState('---');
  const [marketInfo, setMarketInfo] = useState({ change: 0, percent: 0 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<PricingResult | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [liveYields, setLiveYields] = useState<Record<string, number> | null>(null);

  // Fetch Treasury yields once on mount
  useEffect(() => {
    fetchTreasuryYields().then(yields => {
      if (yields) setLiveYields(yields);
    });
  }, []);

  // Fetch available expiry dates when ticker changes
  useEffect(() => {
    if (!ticker) return;
    const id = setTimeout(async () => {
      setLoadingExpiries(true);
      const expiries = await fetchExpiries(ticker);
      setAvailableExpiries(expiries);
      if (expiries.length > 0 && !expiries.includes(maturityDate)) {
        setMaturityDate(expiries[0]);
      }
      setLoadingExpiries(false);
    }, 600);
    return () => clearTimeout(id);
  }, [ticker]);

  // Fetch available strikes when ticker or expiry changes
  useEffect(() => {
    if (!ticker || !maturityDate) return;
    const id = setTimeout(async () => {
      setLoadingStrikes(true);
      const data = await fetchStrikes(ticker, maturityDate);
      if (data) {
        setAvailableStrikes(data.strikes);
        if (data.underlyingPrice > 0) {
          setUnderlyingPrice(data.underlyingPrice.toFixed(2));
          // Auto-select the strike closest to current underlying price
          const closest = data.strikes.reduce((best, s) =>
            Math.abs(s - data.underlyingPrice) < Math.abs(best - data.underlyingPrice) ? s : best
          );
          setStrikePrice(closest.toFixed(2));
        }
      }
      setLoadingStrikes(false);
    }, 800);
    return () => clearTimeout(id);
  }, [ticker, maturityDate]);

  // Time calculation
  const { timeToExpiry, evalTimestamp, matTimestamp, todayTimestamp } = useMemo(() => {
    const nowParts = getNYParts();
    const nowNY = new Date(+nowParts.year, +nowParts.month - 1, +nowParts.day, 12, 0, 0);
    const [mY, mM, mD] = maturityDate.split('-').map(Number);
    const matNY = new Date(mY, mM - 1, mD, 16, 0, 0);

    let evalNY: Date;
    if (evaluationDate === `${nowParts.year}-${nowParts.month}-${nowParts.day}`) {
      evalNY = nowNY;
    } else {
      const [eY, eM, eD] = evaluationDate.split('-').map(Number);
      evalNY = new Date(eY, eM - 1, eD, 16, 0, 0);
    }

    const T = Math.max(0, (matNY.getTime() - evalNY.getTime()) / (1000 * 60 * 60 * 24 * 365));
    return { timeToExpiry: T, evalTimestamp: evalNY.getTime(), matTimestamp: matNY.getTime(), todayTimestamp: nowNY.getTime() };
  }, [evaluationDate, maturityDate]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const d = new Date(parseInt(e.target.value));
    setEvaluationDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
  };

  // Local BSM calculation (instant, no API needed)
  useEffect(() => {
    const S = parseFloat(underlyingPrice);
    const K = parseFloat(strikePrice);
    const v = parseFloat(volatility) / 100;
    const r = parseFloat(riskFreeRate) / 100;
    if (!isNaN(S) && !isNaN(K) && !isNaN(v) && !isNaN(r)) {
      const p = { underlyingPrice: S, strikePrice: K, timeToExpiry, volatility: v, riskFreeRate: r, dividendYield: 0 };
      setResult(modelType === ModelType.American ? calculateAmericanOption(optionType, p) : calculateBSM(optionType, p));
    }
  }, [underlyingPrice, strikePrice, volatility, riskFreeRate, timeToExpiry, optionType, modelType]);

  const handleFetchData = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setDataSource('');

    // Update risk-free rate from live or fallback yield curve
    const curve = buildCurve(liveYields);
    setRiskFreeRate(getRiskFreeRate(timeToExpiry, curve).toFixed(2));

    const marketData = await fetchOptionData(ticker, maturityDate, optionType, strikePrice);

    if (marketData.status === 'error') {
      setErrorMsg(marketData.message);
    } else {
      setMarketOptionPrice(marketData.marketOptionPrice.toFixed(2));
      setMarketInfo({ change: marketData.change, percent: marketData.percentChange });
      if (marketData.underlyingPrice > 0) setUnderlyingPrice(marketData.underlyingPrice.toFixed(2));
      if (marketData.iv > 0) setVolatility(marketData.iv.toFixed(2));
      setDataSource('Yahoo Finance (15min delay)');
      setLastUpdated(new Date());
    }

    setIsLoading(false);
  };

  // Auto-refresh when contract params change
  useEffect(() => {
    const id = setTimeout(handleFetchData, 800);
    return () => clearTimeout(id);
  }, [ticker, strikePrice, maturityDate, optionType]);

  const priceDeviation = useMemo(() => {
    if (!result || marketOptionPrice === '---') return null;
    const mp = parseFloat(marketOptionPrice);
    if (isNaN(mp) || mp === 0) return null;
    return ((result.price - mp) / mp) * 100;
  }, [result, marketOptionPrice]);

  return (
    <div className="min-h-screen bg-gray-50 max-w-md mx-auto shadow-2xl relative pb-10">
      <Header
        ticker={ticker} setTicker={setTicker}
        strike={strikePrice} setStrike={setStrikePrice}
        maturityDate={maturityDate} setMaturityDate={setMaturityDate}
        availableExpiries={availableExpiries} loadingExpiries={loadingExpiries}
        availableStrikes={availableStrikes} loadingStrikes={loadingStrikes}
        underlyingPrice={underlyingPrice}
        optionSymbol={errorMsg ? '---' : `${ticker} ${strikePrice} ${optionType === OptionType.Call ? t.call : t.put}`}
        marketPrice={marketOptionPrice}
        priceChange={marketInfo.change}
        percentChange={marketInfo.percent}
        lang={lang} setLang={setLang} t={t}
      />

      {errorMsg && (
        <div className="bg-red-50 px-4 py-2 border-b border-red-100 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-500" />
          <span className="text-xs font-bold text-red-600">{errorMsg}</span>
        </div>
      )}

      <main className="p-4 space-y-4">

        {/* Status bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${isLoading ? 'bg-blue-400 animate-pulse' : errorMsg ? 'bg-red-400' : 'bg-green-500'}`} />
            <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
              {isLoading ? t.fetching : errorMsg ? t.connError : dataSource || t.ready}
</span>
            {liveYields && !isLoading && (
              <span className="text-[10px] text-green-500 font-bold">{t.liveYields}</span>
            )}
          </div>
          <button onClick={handleFetchData} disabled={isLoading}
            className="flex items-center gap-1 text-xs font-bold text-blue-600 active:scale-95 transition-transform">
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
            {t.refresh}
          </button>
        </div>

        {/* Pricing card */}
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 relative overflow-hidden">
          <div className="absolute -top-4 -right-4 text-9xl font-bold text-gray-50 opacity-[0.03] select-none pointer-events-none">{ticker}</div>

          <div className="flex justify-between items-start mb-6 relative z-10">
            <div>
              <p className="text-gray-400 text-[10px] uppercase tracking-wider font-bold mb-1">{t.theoreticalPrice}</p>
              <div className="flex items-baseline gap-2">
                <div className="text-3xl font-bold text-gray-900 font-mono tracking-tight">
                  {result ? result.price.toFixed(3) : '---'}
                </div>
                {priceDeviation !== null && Math.abs(priceDeviation) < 200 && (
                  <div className={`flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    Math.abs(priceDeviation) < 1 ? 'bg-gray-100 text-gray-400'
                    : priceDeviation > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {Math.abs(priceDeviation) < 1 ? t.match : (
                      <>{priceDeviation > 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}{Math.abs(priceDeviation).toFixed(1)}%</>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="text-right">
              <p className="text-gray-400 text-[10px] uppercase tracking-wider font-bold mb-1">{t.daysToExp}</p>
              <div className="text-xl font-bold text-gray-900 font-mono">{(timeToExpiry * 365).toFixed(1)}</div>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-1 text-center relative z-10 divide-x divide-gray-100">
            {[
              { label: 'Delta', val: result?.greeks.delta },
              { label: 'Gamma', val: result?.greeks.gamma },
              { label: 'Vega',  val: result?.greeks.vega },
              { label: 'Theta', val: result?.greeks.theta, color: 'text-red-500' },
              { label: 'Rho',   val: result?.greeks.rho },
            ].map(item => (
              <div key={item.label} className="flex flex-col items-center px-1">
                <span className="text-gray-400 text-[9px] uppercase font-bold mb-1">{item.label}</span>
                <span className={`text-[11px] font-bold font-mono ${item.color || 'text-gray-700'}`}>
                  {item.val !== undefined ? item.val.toFixed(3) : '-'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Model / Call-Put toggles */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white p-1 rounded-xl border border-gray-100 flex shadow-sm">
            {[ModelType.American, ModelType.European].map(m => (
              <button key={m} onClick={() => setModelType(m)}
                className={`flex-1 py-2 text-[10px] uppercase font-bold rounded-lg transition-all ${modelType === m ? 'bg-gray-900 text-white shadow-md' : 'text-gray-400 hover:text-gray-600'}`}>
                {m === ModelType.American ? t.american : t.european}
              </button>
            ))}
          </div>
          <div className="bg-white p-1 rounded-xl border border-gray-100 flex shadow-sm">
            <button onClick={() => setOptionType(OptionType.Call)}
              className={`flex-1 py-2 text-[10px] uppercase font-bold rounded-lg transition-all ${optionType === OptionType.Call ? 'bg-green-500 text-white shadow-md' : 'text-gray-400 hover:text-gray-600'}`}>
              {t.call}
            </button>
            <button onClick={() => setOptionType(OptionType.Put)}
              className={`flex-1 py-2 text-[10px] uppercase font-bold rounded-lg transition-all ${optionType === OptionType.Put ? 'bg-red-500 text-white shadow-md' : 'text-gray-400 hover:text-gray-600'}`}>
              {t.put}
            </button>
          </div>
        </div>

        {/* Evaluation date slider */}
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-blue-50 rounded-md">
                <Calendar className="w-3.5 h-3.5 text-blue-600" />
              </div>
              <span className="text-xs font-bold text-gray-700">{t.evaluationDate}</span>
            </div>
            <input type="date" value={evaluationDate} min={todayNYStr} max={maturityDate}
              onChange={e => setEvaluationDate(e.target.value)}
              className="bg-gray-50 border-0 rounded px-2 py-1 text-xs font-bold text-gray-900 focus:ring-2 focus:ring-blue-100 outline-none" />
          </div>
          <div className="relative px-1">
            <input type="range" min={todayTimestamp} max={matTimestamp} value={evalTimestamp}
              onChange={handleSliderChange}
              className="w-full h-1.5 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-blue-600" />
          </div>
        </div>

        {/* Inputs */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden px-4">
          <CalculatorInput label={t.underlyingPrice} value={underlyingPrice} onChange={setUnderlyingPrice} onAction={handleFetchData} actionLabel={t.reset} />
          <CalculatorInput label={t.impliedVol} value={volatility} onChange={setVolatility} onAction={handleFetchData} actionLabel={t.autoIV} suffix="%" />
          <CalculatorInput label={t.riskFreeRate} value={riskFreeRate} onChange={setRiskFreeRate} onAction={handleFetchData} actionLabel={t.auto} suffix="%" />
        </div>

        <div className="text-center space-y-1">
          <span className="text-[10px] text-gray-400">{t.dataFooter}</span>
          {lastUpdated && (
            <p className="text-[10px] text-gray-300">{t.updated}: {lastUpdated.toLocaleTimeString()}</p>
          )}
        </div>

      </main>
    </div>
  );
};

export default App;
