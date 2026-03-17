import React, { useState, useEffect, useMemo } from 'react';
import { Header } from './components/Header';
import { CalculatorInput } from './components/CalculatorInput';
import { calculateBSM, calculateImpliedVolatility } from './utils/bsm';
import { OptionType, ModelType, PricingResult } from './types';
import { RefreshCw, Calendar, TrendingUp, TrendingDown, AlertCircle, BadgeInfo } from 'lucide-react';

// ==========================================
// USER CONFIGURATION
// ==========================================
// PASTE YOUR POLYGON.IO API KEY HERE.
// You can get a free key at https://polygon.io/
const POLYGON_API_KEY = "TgW4YChD_BpiBEXa0tAlyTSobmH3DcIl"; 
// ==========================================

// Helper to format Date to OSI Option Symbol format: YYMMDD
const formatDateToOSI = (dateStr: string) => {
  const [y, m, d] = dateStr.split('-');
  return `${y.slice(-2)}${m}${d}`;
};

// Helper to format Strike to OSI format: 00000000
const formatStrikeToOSI = (strike: string | number) => {
  const val = parseFloat(strike.toString()) * 1000;
  return Math.floor(val).toString().padStart(8, '0');
};

// Current US Treasury Yield Curve (Approximation for Late 2024/2025)
const TREASURY_YIELD_CURVE = [
    { t: 1/12, r: 5.3 }, // 1 Month
    { t: 0.25, r: 5.2 }, // 3 Month
    { t: 0.5,  r: 5.0 }, // 6 Month
    { t: 1.0,  r: 4.5 }, // 1 Year
    { t: 2.0,  r: 4.0 }, // 2 Year
    { t: 5.0,  r: 3.9 }, // 5 Year
    { t: 10.0, r: 3.9 }, // 10 Year
    { t: 30.0, r: 4.2 }, // 30 Year
];

const getRiskFreeRate = (T: number): number => {
    if (T <= TREASURY_YIELD_CURVE[0].t) return TREASURY_YIELD_CURVE[0].r;
    const last = TREASURY_YIELD_CURVE[TREASURY_YIELD_CURVE.length - 1];
    if (T >= last.t) return last.r;

    for (let i = 0; i < TREASURY_YIELD_CURVE.length - 1; i++) {
        const p1 = TREASURY_YIELD_CURVE[i];
        const p2 = TREASURY_YIELD_CURVE[i+1];
        if (T >= p1.t && T < p2.t) {
            const fraction = (T - p1.t) / (p2.t - p1.t);
            return p1.r + (p2.r - p1.r) * fraction;
        }
    }
    return last.r;
};

// Helper for NY Time
const getNYParts = (date: Date = new Date()) => {
  return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
  }).formatToParts(date).reduce((acc, part) => {
      if(part.type !== 'literal') acc[part.type] = part.value;
      return acc;
  }, {} as Record<string, string>);
};

const getNYDateStr = () => {
  const parts = getNYParts(new Date());
  return `${parts.year}-${parts.month}-${parts.day}`;
};

interface MarketDataError {
  status: 'error';
  message: string;
  code?: number;
}

interface MarketDataSuccess {
  status: 'success';
  underlyingPrice: number;
  marketOptionPrice: number;
  iv: number;
  priceChange: number;
  percentChange: number;
  contractSymbol: string;
  source: 'Live' | 'Delayed/PrevClose';
}

type MarketDataResult = MarketDataError | MarketDataSuccess;

const fetchRealMarketData = async (
  ticker: string,
  maturityDate: string,
  optionType: OptionType,
  strikePrice: string,
  timeToExpiry: number
): Promise<MarketDataResult> => {
  const cleanKey = POLYGON_API_KEY.trim();
  if (!cleanKey) {
    return { status: 'error', message: "Missing API Key" };
  }

  const formattedDate = formatDateToOSI(maturityDate);
  const formattedStrike = formatStrikeToOSI(strikePrice);
  const typeChar = optionType === OptionType.Call ? 'C' : 'P';
  const optionSymbol = `O:${ticker}${formattedDate}${typeChar}${formattedStrike}`;

  try {
    // -----------------------------------------------------------------
    // ATTEMPT 1: V3 Snapshot (Best Data, usually Paid or Limited)
    // -----------------------------------------------------------------
    const snapshotUrl = `https://api.polygon.io/v3/snapshot?ticker.any_of=${optionSymbol}&apiKey=${cleanKey}`;
    const snapshotRes = await fetch(snapshotUrl);

    if (snapshotRes.ok) {
        const snapJson = await snapshotRes.json();
        const data = snapJson.results?.[0];

        if (!data) {
             return { status: 'error', message: "Contract Not Found" };
        }

        // Price Logic: Mid > Last > Close > PrevClose
        let marketPrice = 0;
        const bid = data.last_quote?.bid || 0;
        const ask = data.last_quote?.ask || 0;
        
        if (bid > 0 && ask > 0) {
            marketPrice = (bid + ask) / 2;
        } else if (data.last_trade?.price) {
            marketPrice = data.last_trade.price;
        } else if (data.day?.close) {
            marketPrice = data.day.close;
        } else if (data.prev_day?.close) {
            marketPrice = data.prev_day.close;
        }

        const underlyingPrice = data.underlying_asset?.price || 0;
        let iv = data.implied_volatility ? data.implied_volatility * 100 : 0;

        // If API returns 0 IV (common for illiquid or free tier), calculate it
        if ((!iv || iv === 0) && marketPrice > 0 && underlyingPrice > 0) {
             const r = getRiskFreeRate(timeToExpiry) / 100;
             iv = calculateImpliedVolatility(optionType, marketPrice, underlyingPrice, parseFloat(strikePrice), timeToExpiry, r);
        }

        return {
          status: 'success',
          contractSymbol: data.ticker,
          underlyingPrice: underlyingPrice,
          marketOptionPrice: marketPrice,
          iv: iv,
          priceChange: data.day?.change || 0,
          percentChange: data.day?.change_percent || 0,
          source: 'Live'
        };
    }
    
    // -----------------------------------------------------------------
    // ERROR HANDLING & FALLBACK (For Free Tier / 403 Forbidden)
    // -----------------------------------------------------------------
    if (snapshotRes.status === 401) {
       return { status: 'error', message: "Invalid API Key" };
    }

    // If 403 (Forbidden) or 404, we try to fall back to 'Previous Close' (Aggs)
    // which is often available on free plans for options.
    if (snapshotRes.status === 403 || snapshotRes.status === 404 || snapshotRes.status === 429) {
        
        // 1. Fetch Option Previous Close
        const prevOptUrl = `https://api.polygon.io/v2/aggs/ticker/${optionSymbol}/prev?adjusted=true&apiKey=${cleanKey}`;
        const prevOptRes = await fetch(prevOptUrl);
        
        // 2. Fetch Underlying Previous Close
        const prevStockUrl = `https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${cleanKey}`;
        const prevStockRes = await fetch(prevStockUrl);

        if (prevOptRes.ok && prevStockRes.ok) {
            const optJson = await prevOptRes.json();
            const stockJson = await prevStockRes.json();

            const optResult = optJson.results?.[0];
            const stockResult = stockJson.results?.[0];

            if (optResult && stockResult) {
                const marketPrice = optResult.c; // Close price
                const underlyingPrice = stockResult.c; // Close price
                
                // Calculate IV since Aggs endpoint doesn't provide it
                const r = getRiskFreeRate(timeToExpiry) / 100;
                const calculatedIV = calculateImpliedVolatility(
                    optionType, 
                    marketPrice, 
                    underlyingPrice, 
                    parseFloat(strikePrice), 
                    timeToExpiry, 
                    r
                );

                return {
                    status: 'success',
                    contractSymbol: optionSymbol.replace("O:", ""),
                    underlyingPrice: underlyingPrice,
                    marketOptionPrice: marketPrice,
                    iv: calculatedIV,
                    priceChange: 0, // Prev close data doesn't have "change" vs itself
                    percentChange: 0,
                    source: 'Delayed/PrevClose'
                };
            }
        }
        
        if (snapshotRes.status === 403) {
            return { status: 'error', message: "Plan Limit: Upgrade Polygon for Real-time" };
        }
    }

    return { status: 'error', message: "Data Unavailable" };

  } catch (err) {
    return { status: 'error', message: "Network Error" };
  }
};

const App: React.FC = () => {
  const [ticker, setTicker] = useState<string>("NVDA");
  const [optionType, setOptionType] = useState<OptionType>(OptionType.Call);
  const [modelType, setModelType] = useState<ModelType>(ModelType.European);
  
  const todayNYStr = useMemo(() => getNYDateStr(), []);
  
  const [maturityDate, setMaturityDate] = useState<string>("2025-06-20");
  const [evaluationDate, setEvaluationDate] = useState<string>(todayNYStr);
  
  const [strikePrice, setStrikePrice] = useState<string>("140.00"); 
  const [underlyingPrice, setUnderlyingPrice] = useState<string>("135.50");
  const [volatility, setVolatility] = useState<string>("45.00");
  const [riskFreeRate, setRiskFreeRate] = useState<string>("4.50");
  
  const [marketOptionPrice, setMarketOptionPrice] = useState<string>("---");
  const [marketInfo, setMarketInfo] = useState({ change: 0.00, percent: 0.00 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<string>("");

  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<PricingResult | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Time Calculation
  const { timeToExpiry, evalTimestamp, matTimestamp, todayTimestamp } = useMemo(() => {
    const nowParts = getNYParts(new Date());
    const nowNY = new Date(Number(nowParts.year), Number(nowParts.month) - 1, Number(nowParts.day), 12, 0, 0);
    const [mY, mM, mD] = maturityDate.split('-').map(Number);
    const matNY = new Date(mY, mM - 1, mD, 16, 0, 0);

    let evalNY: Date;
    if (evaluationDate === `${nowParts.year}-${nowParts.month}-${nowParts.day}`) {
      evalNY = nowNY;
    } else {
      const [eY, eM, eD] = evaluationDate.split('-').map(Number);
      evalNY = new Date(eY, eM - 1, eD, 16, 0, 0);
    }

    const diffMs = matNY.getTime() - evalNY.getTime();
    const T = Math.max(0, diffMs / (1000 * 60 * 60 * 24 * 365));
    return { 
      timeToExpiry: T, 
      evalTimestamp: evalNY.getTime(),
      matTimestamp: matNY.getTime(),
      todayTimestamp: nowNY.getTime()
    };
  }, [evaluationDate, maturityDate]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const timestamp = parseInt(e.target.value);
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    setEvaluationDate(`${year}-${month}-${day}`);
  };

  // Local BSM Calculation (Instant)
  useEffect(() => {
    const S = parseFloat(underlyingPrice);
    const K = parseFloat(strikePrice);
    const v = parseFloat(volatility) / 100;
    const r = parseFloat(riskFreeRate) / 100;

    if (!isNaN(S) && !isNaN(K) && !isNaN(v) && !isNaN(r)) {
      const res = calculateBSM(optionType, {
        underlyingPrice: S,
        strikePrice: K,
        timeToExpiry: timeToExpiry,
        volatility: v,
        riskFreeRate: r,
        dividendYield: 0
      });
      setResult(res);
    }
  }, [underlyingPrice, strikePrice, volatility, riskFreeRate, timeToExpiry, optionType, modelType]);

  // --- MAIN DATA FETCHING LOGIC ---
  const handleFetchData = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setDataSource("");
    
    // Always update Risk Free Rate based on yield curve first
    const rate = getRiskFreeRate(timeToExpiry);
    setRiskFreeRate(rate.toFixed(2));

    try {
      const marketData = await fetchRealMarketData(ticker, maturityDate, optionType, strikePrice, timeToExpiry);
      
      if (marketData.status === 'error') {
         setErrorMsg(marketData.message);
         // Don't wipe inputs on error to keep UI stable
      } else {
         // Success - Update EVERYTHING from API
         setMarketOptionPrice(marketData.marketOptionPrice.toFixed(2));
         setMarketInfo({ change: marketData.priceChange, percent: marketData.percentChange });
         
         if (marketData.underlyingPrice > 0) {
            setUnderlyingPrice(marketData.underlyingPrice.toFixed(2));
         }
         
         if (marketData.iv > 0) {
            setVolatility(marketData.iv.toFixed(2));
         }
         
         setDataSource(marketData.source);
         setLastUpdated(new Date());
      }

    } catch (error) {
      setErrorMsg("Unexpected Error");
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-refresh triggers
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      handleFetchData();
    }, 800); 

    return () => clearTimeout(timeoutId);
  }, [ticker, strikePrice, maturityDate, optionType]);

  // Deviation Calculation
  const priceDeviation = useMemo(() => {
      if (!result || marketOptionPrice === "---") return null;
      const marketP = parseFloat(marketOptionPrice);
      const theoP = result.price;
      if (isNaN(marketP) || marketP === 0) return null;
      return ((theoP - marketP) / marketP) * 100;
  }, [result, marketOptionPrice]);

  return (
    <div className="min-h-screen bg-gray-50 max-w-md mx-auto shadow-2xl relative pb-10">
      <Header 
        ticker={ticker}
        setTicker={setTicker}
        strike={strikePrice}
        setStrike={setStrikePrice}
        maturityDate={maturityDate}
        setMaturityDate={setMaturityDate}
        optionSymbol={errorMsg ? "---" : `O:${ticker}...`}
        marketPrice={marketOptionPrice}
        priceChange={marketInfo.change}
        percentChange={marketInfo.percent}
      />

      {/* Error / Status Bar */}
      {errorMsg && (
        <div className="bg-red-50 px-4 py-2 border-b border-red-100 flex items-center gap-2">
           <AlertCircle className="w-4 h-4 text-red-500" />
           <span className="text-xs font-bold text-red-600">{errorMsg}</span>
        </div>
      )}

      <main className="p-4 space-y-4">
        
        {/* Connection Status / Info Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
             <div className={`w-2 h-2 rounded-full ${isLoading ? 'bg-blue-400 animate-pulse' : (errorMsg ? 'bg-red-400' : 'bg-green-500')}`}></div>
             <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
               {isLoading ? 'Fetching Data...' : (errorMsg ? 'Connection Error' : (dataSource === 'Delayed/PrevClose' ? 'Data: Prev Close (Free Tier)' : 'Data: Real-time'))}
             </span>
          </div>
          <button 
            onClick={handleFetchData}
            disabled={isLoading}
            className="flex items-center gap-1 text-xs font-bold text-blue-600 active:scale-95 transition-transform"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Pricing Card */}
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 relative overflow-hidden">
          {/* Watermark */}
          <div className="absolute -top-4 -right-4 text-9xl font-bold text-gray-50 opacity-[0.03] select-none pointer-events-none">
             {ticker}
          </div>

          <div className="flex justify-between items-start mb-6 relative z-10">
            <div>
              <p className="text-gray-400 text-[10px] uppercase tracking-wider font-bold mb-1">Theoretical Price</p>
              <div className="flex items-baseline gap-2">
                  <div className="text-3xl font-bold text-gray-900 font-mono tracking-tight">
                    {result ? result.price.toFixed(3) : "---"}
                  </div>
                  
                  {priceDeviation !== null && Math.abs(priceDeviation) < 200 && (
                      <div className={`flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full ${Math.abs(priceDeviation) < 1 ? 'bg-gray-100 text-gray-400' : (priceDeviation > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}`}>
                          {Math.abs(priceDeviation) < 1 ? 'Match' : (
                            <>
                              {priceDeviation > 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                              {Math.abs(priceDeviation).toFixed(1)}%
                            </>
                          )}
                      </div>
                  )}
              </div>
            </div>
            <div className="text-right">
                <p className="text-gray-400 text-[10px] uppercase tracking-wider font-bold mb-1">Days to Exp</p>
                <div className="text-xl font-bold text-gray-900 font-mono">
                  {(timeToExpiry * 365).toFixed(1)}
                </div>
            </div>
          </div>

          <div className="grid grid-cols-5 gap-1 text-center relative z-10 divide-x divide-gray-100">
            {[
              { label: 'Delta', val: result?.greeks.delta },
              { label: 'Gamma', val: result?.greeks.gamma },
              { label: 'Vega',  val: result?.greeks.vega },
              { label: 'Theta', val: result?.greeks.theta, color: 'text-red-500' },
              { label: 'Rho',   val: result?.greeks.rho }
            ].map((item) => (
              <div key={item.label} className="flex flex-col items-center px-1">
                <span className="text-gray-400 text-[9px] uppercase font-bold mb-1">{item.label}</span>
                <span className={`text-[11px] font-bold font-mono ${item.color || 'text-gray-700'}`}>
                  {item.val !== undefined ? item.val.toFixed(3) : '-'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Option Type & Model */}
        <div className="grid grid-cols-2 gap-3">
            {/* Model Toggle */}
            <div className="bg-white p-1 rounded-xl border border-gray-100 flex shadow-sm">
              {[ModelType.American, ModelType.European].map(m => (
                <button 
                  key={m}
                  onClick={() => setModelType(m)}
                  className={`flex-1 py-2 text-[10px] uppercase font-bold rounded-lg transition-all ${modelType === m ? 'bg-gray-900 text-white shadow-md' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  {m === ModelType.American ? 'Amer' : 'Euro'}
                </button>
              ))}
            </div>
            
            {/* Call/Put Toggle */}
            <div className="bg-white p-1 rounded-xl border border-gray-100 flex shadow-sm">
               <button 
                  onClick={() => setOptionType(OptionType.Call)}
                  className={`flex-1 py-2 text-[10px] uppercase font-bold rounded-lg transition-all ${optionType === OptionType.Call ? 'bg-green-500 text-white shadow-md' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  Call
                </button>
                <button 
                  onClick={() => setOptionType(OptionType.Put)}
                  className={`flex-1 py-2 text-[10px] uppercase font-bold rounded-lg transition-all ${optionType === OptionType.Put ? 'bg-red-500 text-white shadow-md' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  Put
                </button>
            </div>
        </div>

        {/* Evaluation Date */}
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-50 rounded-md">
                  <Calendar className="w-3.5 h-3.5 text-blue-600" />
                </div>
                <span className="text-xs font-bold text-gray-700">Evaluation Date</span>
              </div>
              <input 
                type="date"
                value={evaluationDate}
                min={todayNYStr}
                max={maturityDate}
                onChange={(e) => setEvaluationDate(e.target.value)}
                className="bg-gray-50 border-0 rounded px-2 py-1 text-xs font-bold text-gray-900 focus:ring-2 focus:ring-blue-100 outline-none"
              />
          </div>
          
          <div className="relative px-1">
              <input 
              type="range" 
              min={todayTimestamp} 
              max={matTimestamp}   
              value={evalTimestamp} 
              onChange={handleSliderChange}
              className="w-full h-1.5 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-blue-600 hover:accent-blue-500"
              />
          </div>
        </div>

        {/* Inputs */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden px-4">
          <CalculatorInput 
            label="Underlying Price"
            value={underlyingPrice}
            onChange={setUnderlyingPrice}
            onAction={handleFetchData}
            actionLabel="Reset"
          />

          <CalculatorInput 
            label="Implied Volatility"
            value={volatility}
            onChange={setVolatility}
            onAction={handleFetchData}
            actionLabel="Auto IV"
            suffix="%"
          />

          <CalculatorInput 
            label="Risk-Free Rate"
            value={riskFreeRate}
            onChange={setRiskFreeRate}
            onAction={handleFetchData}
            actionLabel="Auto"
            suffix="%"
          />
        </div>

        <div className="text-center space-y-2">
             <div className="flex justify-center items-center gap-2">
               <span className="text-[10px] text-gray-400">Data Source: Polygon.io</span>
               {lastUpdated && <span className="text-[10px] text-gray-300">•</span>}
               {lastUpdated && <span className="text-[10px] text-gray-400">Updated: {lastUpdated.toLocaleTimeString()}</span>}
             </div>
             
             {!POLYGON_API_KEY && (
                 <p className="text-[10px] text-red-400 font-bold">
                   API Key is missing in code configuration.
                 </p>
             )}
        </div>
        
      </main>
    </div>
  );
};

export default App;