# Portfolio Tracker

A high-end Fintech Portfolio Tracker built with Next.js, Tailwind CSS, and TypeScript. This application aggregates and analyzes data from multiple Interactive Brokers (IBKR) accounts.

## Features

- **Multi-Account Aggregation**: Merge data from multiple IBKR accounts
- **Performance Tracking**: Time-Weighted Return calculation with proper handling of deposits/withdrawals
- **Currency Normalization**: Automatic conversion to USD using exchange rates from XML files
- **Comprehensive Analytics**:
  - Total Wealth tracking
  - Daily change indicators
  - 2-year performance chart
  - Combined holdings view with account breakdown
  - Fees and income analysis (Gross vs Net Profit)

## Tech Stack

- **Next.js 14** - React framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Recharts** - Charting library
- **fast-xml-parser** - XML parsing
- **date-fns** - Date utilities

## Getting Started

### Prerequisites

- Node.js 18+ and npm/yarn/pnpm

### Installation

1. Install dependencies:

```bash
npm install
# or
yarn install
# or
pnpm install
```

2. Place your IBKR XML export files in `data/ibkr_uploads/`

3. Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

## Data Structure

The application expects IBKR Flex Query XML files in the `data/ibkr_uploads/` directory. Each file should contain:

- **ChangeInNAV**: Net Asset Value changes over time
- **CashTransactions**: All cash movements (deposits, withdrawals, dividends, fees, etc.)
- **Trades**: Trade execution history
- **OpenPositions**: Current holdings

## Key Features Explained

### Time-Weighted Return

The performance calculation uses Time-Weighted Return (TWR) logic, which properly handles deposits and withdrawals as capital flows rather than performance gains. This ensures accurate performance measurement regardless of when money is added or removed from accounts.

### Currency Normalization

All values are normalized to USD using the `fxRateToBase` conversion rates provided in the XML files. This allows for accurate aggregation across accounts with different base currencies.

### "Everything" Filter

The application captures all cash transactions including:
- Dividends
- Interest (broker interest received)
- Credits
- Commissions
- Withholding taxes
- ADR fees
- Other fees

This provides a comprehensive view of Gross Profit vs Net Profit.

## Project Structure

```
├── app/
│   ├── api/
│   │   └── portfolio/
│   │       └── route.ts      # API endpoint for portfolio data
│   ├── globals.css            # Global styles
│   ├── layout.tsx             # Root layout
│   └── page.tsx               # Dashboard page
├── lib/
│   ├── aggregator.ts          # Data aggregation and performance calculation
│   ├── parser.ts              # XML parsing utilities
│   ├── types.ts               # TypeScript type definitions
│   └── utils.ts               # Utility functions
├── data/
│   └── ibkr_uploads/          # Place your XML files here
└── package.json
```

## Building for Production

```bash
npm run build
npm start
```

## License

MIT


