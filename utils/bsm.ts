import { OptionType, OptionParams, PricingResult } from '../types';

/**
 * TypeScript implementation of the BSM model.
 * Updated to include Risk-Free Rate (r) in calculations.
 */
export class BSM {

  /**
   * Approximation of the error function erf(x)
   */
  private erf(x: number): number {
    const a1 =  0.254829592;
    const a2 = -0.284496736;
    const a3 =  1.421413741;
    const a4 = -1.453152027;
    const a5 =  1.061405429;
    const p  =  0.3275911;

    let sign = 1;
    if (x < 0) {
        sign = -1;
    }
    x = Math.abs(x);

    // A&S formula 7.1.26
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return sign * y;
  }

  pdf(x: number): number {
    return Math.exp(-Math.pow(x, 2) / 2) / Math.sqrt(2 * Math.PI);
  }

  cdf(x: number): number {
    return (1 + this.erf(x / Math.sqrt(2))) / 2;
  }

  // Updated to include r
  d1(S: number, K: number, V: number, T: number, r: number): number {
    if (T <= 0 || V === 0) return 0;
    return (Math.log(S / K) + (r + Math.pow(V, 2) / 2) * T) / (V * Math.sqrt(T));
  }

  // d2 = d1 - V*sqrt(T)
  d2(S: number, K: number, V: number, T: number, r: number): number {
    return this.d1(S, K, V, T, r) - (V * Math.sqrt(T));
  }

  // Updated theo to include discounting: K * exp(-rT)
  theo(S: number, K: number, V: number, T: number, dT: 'C' | 'P', r: number): number {
    const _d1 = this.d1(S, K, V, T, r);
    const _d2 = this.d2(S, K, V, T, r);
    
    if (dT === 'C') {
      return S * this.cdf(_d1) - K * Math.exp(-r * T) * this.cdf(_d2);
    } else {
      return K * Math.exp(-r * T) * this.cdf(-_d2) - S * this.cdf(-_d1);
    }
  }

  // Delta approximation (usually exp(-qT) * N(d1), assuming q=0 here as per original python)
  delta(S: number, K: number, V: number, T: number, dT: 'C' | 'P', r: number): number {
    const _d1 = this.d1(S, K, V, T, r);
    if (dT === 'C') {
      return this.cdf(_d1);
    } else if (dT === 'P') {
      return this.cdf(_d1) - 1;
    } else {
      return 1;
    }
  }

  // Vega (technically S * sqrt(T) * N'(d1) * exp(-qT))
  vega(S: number, K: number, V: number, T: number, r: number): number {
    const _d1 = this.d1(S, K, V, T, r);
    return (S * Math.sqrt(T) * this.pdf(_d1)) / 100; // Divided by 100 to match percentage inputs usually
  }

  // Theta
  theta(S: number, K: number, V: number, T: number, r: number, dT: 'C' | 'P'): number {
    const _d1 = this.d1(S, K, V, T, r);
    const _d2 = this.d2(S, K, V, T, r);
    
    const term1 = - (S * V * this.pdf(_d1)) / (2 * Math.sqrt(T));
    const term2 = r * K * Math.exp(-r * T) * this.cdf(dT === 'C' ? _d2 : -_d2);
    
    let thetaVal = 0;
    if (dT === 'C') {
        thetaVal = term1 - term2; 
    } else {
        thetaVal = term1 + term2; 
    }
    
    return thetaVal / 365;
  }

  // Gamma
  gamma(S: number, K: number, V: number, T: number, r: number): number {
    const _d1 = this.d1(S, K, V, T, r);
    return this.pdf(_d1) / (S * V * Math.sqrt(T));
  }
  
  // Rho (sensitivity to interest rate)
  rho(S: number, K: number, V: number, T: number, dT: 'C' | 'P', r: number): number {
      const _d2 = this.d2(S, K, V, T, r);
      if (dT === 'C') {
          return K * T * Math.exp(-r * T) * this.cdf(_d2) / 100;
      } else {
          return -K * T * Math.exp(-r * T) * this.cdf(-_d2) / 100;
      }
  }
}

export class Pricing extends BSM {
    calculateSingle(
        type: OptionType,
        params: OptionParams
    ): PricingResult {
        const S = params.underlyingPrice;
        const K = params.strikePrice;
        const V = params.volatility; 
        const T = params.timeToExpiry;
        const r = params.riskFreeRate; 
        const dT = type === OptionType.Call ? 'C' : 'P';

        if (T <= 0) {
             const intrinsic = type === OptionType.Call ? Math.max(0, S - K) : Math.max(0, K - S);
             return {
                 price: intrinsic,
                 greeks: { delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 }
             };
        }

        const price = this.theo(S, K, V, T, dT, r);
        const delta = this.delta(S, K, V, T, dT, r);
        const gamma = this.gamma(S, K, V, T, r);
        const vega = this.vega(S, K, V, T, r);
        const theta = this.theta(S, K, V, T, r, dT);
        const rho = this.rho(S, K, V, T, dT, r);

        return {
            price,
            greeks: {
                delta,
                gamma,
                vega,
                theta,
                rho
            }
        };
    }
}

const pricingModel = new Pricing();

export const calculateBSM = (
  type: OptionType,
  params: OptionParams
): PricingResult => {
    return pricingModel.calculateSingle(type, params);
};

// Newton-Raphson Solver for Implied Volatility
export const calculateImpliedVolatility = (
  type: OptionType,
  marketPrice: number,
  S: number,
  K: number,
  T: number,
  r: number
): number => {
    if (marketPrice <= 0 || T <= 0) return 0;

    let sigma = 0.5; // Initial guess (50%)
    const maxIter = 20;
    const epsilon = 0.001;
    
    for (let i = 0; i < maxIter; i++) {
        const res = calculateBSM(type, { 
            underlyingPrice: S, 
            strikePrice: K, 
            timeToExpiry: T, 
            volatility: sigma, 
            riskFreeRate: r 
        });
        
        const diff = res.price - marketPrice;
        if (Math.abs(diff) < epsilon) return sigma * 100;
        
        // Vega is returned as change per 1% vol, so we multiply by 100 to get dPrice/dSigma (where sigma is decimal)
        const vega = res.greeks.vega * 100;
        
        if (Math.abs(vega) < 0.00001) break;
        
        const newSigma = sigma - (diff / vega);
        
        // Clamping to reasonable bounds
        if (newSigma <= 0.001) sigma = 0.001;
        else if (newSigma > 5.0) sigma = 5.0; // Max 500%
        else sigma = newSigma;
    }
    
    return sigma * 100;
};