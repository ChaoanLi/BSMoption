export enum OptionType {
  Call = 'Call',
  Put = 'Put'
}

export enum ModelType {
  European = 'European',
  American = 'American'
}

export interface OptionParams {
  underlyingPrice: number; // S
  strikePrice: number;     // K
  timeToExpiry: number;    // T (in years)
  volatility: number;      // σ (sigma, as decimal)
  riskFreeRate: number;    // r (as decimal)
  dividendYield?: number;  // q (as decimal, optional)
}

export interface Greeks {
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  rho: number;
}

export interface PricingResult {
  price: number;
  greeks: Greeks;
}