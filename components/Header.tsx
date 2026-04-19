import React, { useState, useEffect, useRef } from 'react';
import { Lang, Translations } from '../utils/i18n';

interface Suggestion { symbol: string; name: string; type: string }

interface HeaderProps {
  ticker: string;
  setTicker: (val: string) => void;
  strike: string;
  setStrike: (val: string) => void;
  maturityDate: string;
  setMaturityDate: (val: string) => void;
  availableExpiries: string[];
  loadingExpiries: boolean;
  availableStrikes: number[];
  loadingStrikes: boolean;
  underlyingPrice: string;
  optionSymbol: string;
  marketPrice: string;
  priceChange: number;
  percentChange: number;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Translations;
}

export const Header: React.FC<HeaderProps> = ({
  ticker, setTicker,
  strike, setStrike,
  maturityDate, setMaturityDate,
  availableExpiries, loadingExpiries,
  availableStrikes, loadingStrikes,
  underlyingPrice,
  optionSymbol, marketPrice, priceChange, percentChange,
  lang, setLang, t,
}) => {
  const [inputVal, setInputVal] = useState(ticker);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSugg, setShowSugg] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync inputVal when ticker changes externally
  useEffect(() => { setInputVal(ticker); }, [ticker]);

  // Debounced search
  useEffect(() => {
    const q = inputVal.trim();
    if (q.length < 1) { setSuggestions([]); return; }
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (res.ok) setSuggestions(await res.json());
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(id);
  }, [inputVal]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSugg(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectSuggestion = (s: Suggestion) => {
    setInputVal(s.symbol);
    setTicker(s.symbol);
    setSuggestions([]);
    setShowSugg(false);
  };

  const handleInputChange = (val: string) => {
    const upper = val.toUpperCase();
    setInputVal(upper);
    setShowSugg(true);
  };

  const handleBlur = () => {
    // commit whatever is typed as the ticker
    const v = inputVal.trim();
    if (v) setTicker(v);
  };

  const spotPrice = parseFloat(underlyingPrice) || 0;
  const below = availableStrikes.filter(s => s <= spotPrice);
  const above = availableStrikes.filter(s => s > spotPrice);
  const strikeNum = parseFloat(strike) || 0;

  return (
    <div className="bg-white pb-2 sticky top-0 z-[200] border-b border-gray-100">
      <div className="px-4 py-3 space-y-3">
        <div className="grid grid-cols-3 gap-3 items-end">

          {/* Ticker with autocomplete */}
          <div className="flex flex-col relative" ref={containerRef}>
            <label className="text-[10px] uppercase text-gray-400 font-bold tracking-wider">{t.ticker}</label>
            <input
              type="text"
              value={inputVal}
              onChange={(e) => handleInputChange(e.target.value)}
              onFocus={() => setShowSugg(true)}
              onBlur={handleBlur}
              className="w-full font-bold text-gray-900 border-b border-gray-200 focus:border-blue-500 outline-none py-1 text-sm"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {showSugg && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-2xl z-[300] overflow-hidden">
                {suggestions.map((s) => (
                  <button
                    key={s.symbol}
                    onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s); }}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-blue-50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-bold text-gray-900 text-sm shrink-0">{s.symbol}</span>
                      <span className="text-gray-400 text-xs truncate">{s.name}</span>
                    </div>
                    <span className="text-[9px] font-bold text-gray-300 uppercase shrink-0 ml-1">{s.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Strike */}
          <div className="flex flex-col">
            <label className="text-[10px] uppercase text-gray-400 font-bold tracking-wider">{t.strike}</label>
            {loadingStrikes ? (
              <span className="text-sm text-gray-400 py-1 border-b border-gray-200">{t.loadingExpiries}</span>
            ) : availableStrikes.length > 0 ? (
              <div className="relative">
                <select
                  value={strikeNum}
                  onChange={(e) => setStrike(e.target.value)}
                  className="w-full font-bold text-gray-900 border-b border-gray-200 focus:border-blue-500 outline-none py-1 text-sm bg-transparent appearance-none cursor-pointer"
                >
                  {below.length > 0 && (
                    <optgroup label={`≤ ${spotPrice.toFixed(0)}`}>
                      {below.map(s => <option key={s} value={s}>{s}</option>)}
                    </optgroup>
                  )}
                  {above.length > 0 && (
                    <optgroup label={`> ${spotPrice.toFixed(0)}`}>
                      {above.map(s => <option key={s} value={s}>{s}</option>)}
                    </optgroup>
                  )}
                  {!availableStrikes.includes(strikeNum) && (
                    <option value={strikeNum}>{strikeNum}</option>
                  )}
                </select>
                <span className={`absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full pointer-events-none ${
                  strikeNum <= spotPrice ? 'bg-green-400' : 'bg-gray-300'
                }`} />
              </div>
            ) : (
              <input
                type="number"
                value={strike}
                onChange={(e) => setStrike(e.target.value)}
                className="w-full font-bold text-gray-900 border-b border-gray-200 focus:border-blue-500 outline-none py-1 text-sm"
              />
            )}
          </div>

          {/* Expiry */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase text-gray-400 font-bold tracking-wider">{t.expiry}</label>
              <button
                onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
                className="text-[10px] font-bold text-blue-500 hover:text-blue-700 transition-colors ml-1 leading-none"
              >
                {lang === 'en' ? '中文' : 'EN'}
              </button>
            </div>
            {loadingExpiries ? (
              <span className="text-sm text-gray-400 py-1 border-b border-gray-200">{t.loadingExpiries}</span>
            ) : availableExpiries.length > 0 ? (
              <select
                value={maturityDate}
                onChange={(e) => setMaturityDate(e.target.value)}
                className="w-full font-bold text-gray-900 border-b border-gray-200 focus:border-blue-500 outline-none py-1 text-sm bg-transparent appearance-none cursor-pointer"
              >
                {!availableExpiries.includes(maturityDate) && (
                  <option value={maturityDate}>{maturityDate}</option>
                )}
                {availableExpiries.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            ) : (
              <input
                type="date"
                value={maturityDate}
                onChange={(e) => setMaturityDate(e.target.value)}
                className="w-full font-bold text-gray-900 border-b border-gray-200 focus:border-blue-500 outline-none py-1 text-sm bg-transparent p-0"
              />
            )}
          </div>
        </div>

        {/* Display Row */}
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">{optionSymbol}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-gray-900 font-bold text-lg">{marketPrice}</span>
            <span className={`text-sm font-medium ${priceChange >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {priceChange > 0 ? '↑' : '↓'} {priceChange > 0 ? '+' : ''}{priceChange.toFixed(2)}
            </span>
            <span className={`text-sm font-medium ${percentChange >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              {percentChange > 0 ? '+' : ''}{percentChange.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
