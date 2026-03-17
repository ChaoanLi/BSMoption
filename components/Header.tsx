import React from 'react';

interface HeaderProps {
  ticker: string;
  setTicker: (val: string) => void;
  strike: string;
  setStrike: (val: string) => void;
  maturityDate: string;
  setMaturityDate: (val: string) => void;
  optionSymbol: string;
  marketPrice: string; // Changed from underlyingPrice to marketPrice
  priceChange: number;
  percentChange: number;
}

export const Header: React.FC<HeaderProps> = ({
  ticker,
  setTicker,
  strike,
  setStrike,
  maturityDate,
  setMaturityDate,
  optionSymbol,
  marketPrice,
  priceChange,
  percentChange
}) => {
  return (
    <div className="bg-white pb-2 sticky top-0 z-10 border-b border-gray-100">
      <div className="px-4 py-3 space-y-3">
        {/* Input Row - Now 3 Columns */}
        <div className="grid grid-cols-3 gap-3">
          {/* Ticker */}
          <div className="flex flex-col">
            <label className="text-[10px] uppercase text-gray-400 font-bold tracking-wider">Ticker</label>
            <input 
              type="text" 
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              className="w-full font-bold text-gray-900 border-b border-gray-200 focus:border-blue-500 outline-none py-1 text-sm"
            />
          </div>
          
          {/* Strike */}
          <div className="flex flex-col">
            <label className="text-[10px] uppercase text-gray-400 font-bold tracking-wider">Strike</label>
             <input 
              type="number" 
              value={strike}
              onChange={(e) => setStrike(e.target.value)}
              className="w-full font-bold text-gray-900 border-b border-gray-200 focus:border-blue-500 outline-none py-1 text-sm"
            />
          </div>

          {/* Maturity Date */}
          <div className="flex flex-col">
            <label className="text-[10px] uppercase text-gray-400 font-bold tracking-wider">Maturity</label>
             <input 
              type="date" 
              value={maturityDate}
              onChange={(e) => setMaturityDate(e.target.value)}
              className="w-full font-bold text-gray-900 border-b border-gray-200 focus:border-blue-500 outline-none py-1 text-sm bg-transparent p-0"
            />
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