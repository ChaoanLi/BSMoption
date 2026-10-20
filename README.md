# BSMoption · Option Pricing Calculator

A React and TypeScript application for exploring European and American option prices.

[Deployed application](https://bsm-option-calculator.vercel.app)

## Features

- European call and put pricing using the Black–Scholes–Merton model.
- An American-option pricing implementation.
- Inputs for the underlying price, strike, volatility, and evaluation and maturity dates.
- Market-data requests through Vercel functions for expiries, strikes, options, and Treasury yields.
- English and Chinese interface text.

## Local development

Install Node.js and npm, then run:

```sh
git clone https://github.com/ChaoanLi/BSMoption.git
cd BSMoption
npm ci
npm run dev
```

Open the local URL printed by Vite.

```sh
npm run build
npm run preview
```

Vite serves the frontend locally. The `/api/*` endpoints are Vercel functions and require a compatible serverless runtime to run locally; the frontend development server alone does not run them. The app includes fallback yield-curve values when live yields are unavailable.

## Repository structure

| Location | Purpose |
| --- | --- |
| `App.tsx` | Application state, pricing flow, and market-data requests |
| `components/` | Input controls and shared interface |
| `utils/bsm.ts` | European option pricing |
| `utils/american.ts` | American option pricing |
| `utils/i18n.ts` | English and Chinese interface text |
| `api/` | Serverless market-data endpoints |
| `vercel.json` | Vercel routing configuration |

## Deployment

The repository includes a Vercel configuration. Deploy the frontend and `api/` functions together so market-data requests reach the corresponding serverless endpoints.

Prices depend on the model inputs and the availability of external market data.

## Supported inputs

The interface requires finite inputs, a positive underlying price and strike,
and strictly positive volatility. Invalid or incomplete inputs clear the displayed
price and Greeks. The zero-volatility deterministic limit is not implemented in
the low-level pricing functions; do not call those helpers with zero volatility.

The frontend build and TypeScript check were verified on 2026-10-20. Numerical
smoke checks covered a standard call/put example, put-call parity, an implied-
volatility round trip, expiry payoff, and the American/European comparison for
positive volatility. Live market-data endpoints were not verified by those checks.
