import React from 'react';

interface CalculatorInputProps {
  label: string;
  value: string | number;
  onChange: (val: string) => void;
  onAction?: () => void;
  actionLabel?: string;
  suffix?: string;
  type?: 'number' | 'date';
}

export const CalculatorInput: React.FC<CalculatorInputProps> = ({
  label,
  value,
  onChange,
  onAction,
  actionLabel,
  suffix,
  type = 'number'
}) => {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
      <label className="text-gray-500 text-sm font-medium w-1/3">{label}</label>
      
      <div className="flex flex-1 items-center justify-end gap-2">
        <div className={`relative flex items-center bg-gray-100 rounded-lg px-3 py-2 w-full max-w-[180px] ${type === 'date' ? 'justify-center' : 'justify-end'}`}>
          <input
            type={type}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`bg-transparent outline-none w-full text-gray-900 font-semibold text-right ${type === 'date' ? 'text-center' : ''}`}
            placeholder="0.00"
          />
        </div>
        
        {suffix && (
          <span className="text-gray-400 text-sm font-medium w-6 text-center">{suffix}</span>
        )}

        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="ml-2 px-3 py-1.5 rounded-full border border-gray-300 text-xs font-medium text-gray-600 whitespace-nowrap active:bg-gray-100 transition-colors"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
};