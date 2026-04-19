import { OptionType, OptionParams, PricingResult } from '../types';

const N = 200; // binomial steps — accuracy ~0.1%, runtime < 2ms

/**
 * CRR binomial tree price for an American option.
 * At each node: V = max(hold value, intrinsic / early-exercise value).
 */
function binomialPrice(
  type: OptionType,
  S: number, K: number, T: number,
  sigma: number, r: number, q: number,
): number {
  if (T <= 0) return type === OptionType.Call ? Math.max(S - K, 0) : Math.max(K - S, 0);

  const dt   = T / N;
  const u    = Math.exp(sigma * Math.sqrt(dt));
  const d    = 1 / u;
  const dd   = d * d;                                   // multiply to move one node down
  const p    = (Math.exp((r - q) * dt) - d) / (u - d); // risk-neutral up probability
  const disc = Math.exp(-r * dt);
  const isCall = type === OptionType.Call;

  // Terminal payoffs: node j (j down-moves) price = S * u^N * (d²)^j
  const V = new Float64Array(N + 1);
  let Sj = S * Math.pow(u, N);
  for (let j = 0; j <= N; j++) {
    V[j] = isCall ? Math.max(Sj - K, 0) : Math.max(K - Sj, 0);
    Sj *= dd;
  }

  // Backward induction with early-exercise check
  let topS = S * Math.pow(u, N - 1); // top node price at step i = N-1
  for (let i = N - 1; i >= 0; i--) {
    Sj = topS;
    for (let j = 0; j <= i; j++) {
      const hold     = disc * (p * V[j] + (1 - p) * V[j + 1]);
      const exercise = isCall ? Math.max(Sj - K, 0) : Math.max(K - Sj, 0);
      V[j] = Math.max(hold, exercise);
      Sj *= dd;
    }
    topS *= d;
  }

  return V[0];
}

export function calculateAmericanOption(
  type: OptionType,
  params: OptionParams,
): PricingResult {
  const { underlyingPrice: S, strikePrice: K, timeToExpiry: T,
          volatility: sigma, riskFreeRate: r, dividendYield: q = 0 } = params;

  if (T <= 0) {
    const intrinsic = type === OptionType.Call ? Math.max(0, S - K) : Math.max(0, K - S);
    return {
      price: intrinsic,
      greeks: { delta: intrinsic > 0 ? (type === OptionType.Call ? 1 : -1) : 0, gamma: 0, vega: 0, theta: 0, rho: 0 },
    };
  }

  const price = binomialPrice(type, S, K, T, sigma, r, q);

  // Greeks via finite differences (bump-and-reprice)
  const dS   = S * 0.01;
  const vU   = binomialPrice(type, S + dS, K, T, sigma, r, q);
  const vD   = binomialPrice(type, S - dS, K, T, sigma, r, q);
  const delta = (vU - vD) / (2 * dS);
  const gamma = (vU - 2 * price + vD) / (dS * dS);
  const vega  = binomialPrice(type, S, K, T, sigma + 0.01, r, q) - price; // per 1% vol
  const theta = T > 1 / 365
    ? binomialPrice(type, S, K, T - 1 / 365, sigma, r, q) - price         // per calendar day
    : 0;
  const rho   = binomialPrice(type, S, K, T, sigma, r + 0.01, q) - price; // per 1% rate

  return { price, greeks: { delta, gamma, vega, theta, rho } };
}
