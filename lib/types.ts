// IBKR XML Structure Types

export interface FlexQueryResponse {
  FlexStatements: {
    FlexStatement: FlexStatement | FlexStatement[];
  };
}

export interface Transfer {
  accountId: string;
  acctAlias: string;
  currency: string;
  fxRateToBase: string;
  assetCategory: string;
  symbol: string;
  description: string;
  conid: string;
  dateTime: string;
  settleDate: string;
  reportDate: string;
  amount: string;
  cashTransfer: string; // Cash transfer amount (for INTERNAL transfers)
  type: string; // e.g., "INTERNAL", "EXTERNAL"
  direction: string; // e.g., "IN", "OUT"
  fromAccount: string;
  toAccount: string;
  transactionID: string;
}

export interface AccountInformation {
  accountId: string;
  acctAlias: string;
  currency: string;
  model?: string;
  [key: string]: string | undefined;
}

export interface NetAssetValueSummary {
  accountId: string;
  acctAlias: string;
  currency: string;
  total: string;
  reportDate: string;
  [key: string]: string | undefined;
}

export interface FlexStatement {
  accountId: string;
  fromDate: string;
  toDate: string;
  period: string;
  whenGenerated: string;
  AccountInformation?: AccountInformation;
  ChangeInNAV?: ChangeInNAV;
  NetAssetValueSummary?: NetAssetValueSummary | NetAssetValueSummary[];
  EquitySummaryInBase?: {
    EquitySummaryByReportDateInBase?: EquitySummaryByReportDateInBase | EquitySummaryByReportDateInBase[];
  };
  OpenPositions?: {
    OpenPosition?: OpenPosition | OpenPosition[];
  };
  Trades?: {
    Trade?: Trade | Trade[];
  };
  CashTransactions?: {
    CashTransaction?: CashTransaction | CashTransaction[];
  };
  Transfers?: {
    Transfer?: Transfer | Transfer[];
  };
}

export interface EquitySummaryByReportDateInBase {
  accountId: string;
  acctAlias: string;
  model: string;
  currency: string;
  reportDate: string; // YYYYMMDD format
  total: string; // Total NAV value
  [key: string]: string | undefined; // Allow other attributes
}

export interface ChangeInNAV {
  accountId: string;
  acctAlias: string;
  model: string;
  currency: string;
  fromDate: string;
  toDate: string;
  startingValue: string;
  mtm: string;
  mtmAtPaxos: string;
  realized: string;
  changeInUnrealized: string;
  costAdjustments: string;
  transferredPnlAdjustments: string;
  depositsWithdrawals: string;
  carbonCredits: string;
  donations: string;
  internalCashTransfers: string;
  paxosTransfers: string;
  excessFundSweep: string;
  assetTransfers: string;
  debitCardActivity: string;
  billPay: string;
  grantActivity: string;
  dividends: string;
  withholdingTax: string;
  withholding871m: string;
  withholdingTaxCollected: string;
  changeInDividendAccruals: string;
  changeInLiteSurchargeAccruals: string;
  changeInCGTWithholdingAccruals: string;
  interest: string;
  changeInInterestAccruals: string;
  changeInIncentiveCouponAccruals: string;
  brokerFees: string;
  changeInBrokerFeeAccruals: string;
  advisorFees: string;
  clientFees: string;
  otherFees: string;
  otherIncome: string;
  feesReceivables: string;
  commissions: string;
  commissionsAtPaxos: string;
  referralFee: string;
  commissionCreditsRedemption: string;
  commissionReceivables: string;
  forexCommissions: string;
  transactionTax: string;
  taxReceivables: string;
  salesTax: string;
  billableSalesTax: string;
  softDollars: string;
  netFxTrading: string;
  fxTranslation: string;
  linkingAdjustments: string;
  other: string;
  endingValue: string;
  twr: string;
  corporateActionProceeds: string;
}

export interface OpenPosition {
  accountId: string;
  acctAlias: string;
  model: string;
  currency: string;
  fxRateToBase: string;
  assetCategory: string;
  subCategory: string;
  symbol: string;
  description: string;
  conid: string;
  securityID: string;
  securityIDType: string;
  cusip: string;
  isin: string;
  figi: string;
  listingExchange: string;
  underlyingConid: string;
  underlyingSymbol: string;
  underlyingSecurityID: string;
  underlyingListingExchange: string;
  issuer: string;
  issuerCountryCode: string;
  multiplier: string;
  strike: string;
  expiry: string;
  putCall: string;
  principalAdjustFactor: string;
  reportDate: string;
  position: string;
  markPrice: string;
  positionValue: string;
  openPrice: string;
  costBasisPrice: string;
  costBasisMoney: string;
  percentOfNAV: string;
  fifoPnlUnrealized: string;
  side: string;
  levelOfDetail: string;
  openDateTime: string;
  holdingPeriodDateTime: string;
  vestingDate: string;
  code: string;
  originatingOrderID: string;
  originatingTransactionID: string;
  accruedInt: string;
  serialNumber: string;
  deliveryType: string;
  commodityType: string;
  fineness: string;
  weight: string;
}

export interface Trade {
  accountId: string;
  acctAlias: string;
  model: string;
  currency: string;
  fxRateToBase: string;
  assetCategory: string;
  subCategory: string;
  symbol: string;
  description: string;
  conid: string;
  securityID: string;
  securityIDType: string;
  cusip: string;
  isin: string;
  figi: string;
  listingExchange: string;
  underlyingConid: string;
  underlyingSymbol: string;
  underlyingSecurityID: string;
  underlyingListingExchange: string;
  issuer: string;
  issuerCountryCode: string;
  tradeID: string;
  multiplier: string;
  relatedTradeID: string;
  strike: string;
  reportDate: string;
  expiry: string;
  dateTime: string;
  putCall: string;
  tradeDate: string;
  principalAdjustFactor: string;
  settleDateTarget: string;
  transactionType: string;
  exchange: string;
  quantity: string;
  tradePrice: string;
  tradeMoney: string;
  proceeds: string;
  taxes: string;
  ibCommission: string;
  ibCommissionCurrency: string;
  netCash: string;
  closePrice: string;
  openCloseIndicator: string;
  notes: string;
  cost: string;
  fifoPnlRealized: string;
  mtmPnl: string;
  origTradePrice: string;
  origTradeDate: string;
  origTradeID: string;
  origOrderID: string;
  origTransactionID: string;
  buySell: string;
  clearingFirmID: string;
  ibOrderID: string;
  transactionID: string;
  ibExecID: string;
  relatedTransactionID: string;
  rtn: string;
  brokerageOrderID: string;
  orderReference: string;
  volatilityOrderLink: string;
  exchOrderId: string;
  extExecID: string;
  orderTime: string;
  openDateTime: string;
  holdingPeriodDateTime: string;
  whenRealized: string;
  whenReopened: string;
  levelOfDetail: string;
  changeInPrice: string;
  changeInQuantity: string;
  orderType: string;
  traderID: string;
  isAPIOrder: string;
  accruedInt: string;
  initialInvestment: string;
  positionActionID: string;
  serialNumber: string;
  deliveryType: string;
  commodityType: string;
  fineness: string;
  weight: string;
}

export interface CashTransaction {
  accountId: string;
  acctAlias: string;
  model: string;
  currency: string;
  fxRateToBase: string;
  assetCategory: string;
  subCategory: string;
  symbol: string;
  description: string;
  conid: string;
  securityID: string;
  securityIDType: string;
  cusip: string;
  isin: string;
  figi: string;
  listingExchange: string;
  underlyingConid: string;
  underlyingSymbol: string;
  underlyingSecurityID: string;
  underlyingListingExchange: string;
  issuer: string;
  issuerCountryCode: string;
  multiplier: string;
  strike: string;
  expiry: string;
  putCall: string;
  principalAdjustFactor: string;
  dateTime: string;
  settleDate: string;
  availableForTradingDate: string;
  amount: string;
  type: string;
  tradeID: string;
  code: string;
  transactionID: string;
  reportDate: string;
  exDate: string;
  clientReference: string;
  actionID: string;
  levelOfDetail: string;
  serialNumber: string;
  deliveryType: string;
  commodityType: string;
  fineness: string;
  weight: string;
}

// Processed/Transformed Types

export interface ProcessedAccount {
  accountId: string;
  accountAlias: string;
  currency: string;
  changeInNAV: ProcessedChangeInNAV;
  openPositions: ProcessedOpenPosition[];
  trades: ProcessedTrade[];
  cashTransactions: ProcessedCashTransaction[];
  transfers: ProcessedTransfer[];
}

export interface ProcessedChangeInNAV {
  fromDate: Date;
  toDate: Date;
  startingValue: number;
  endingValue: number;
  depositsWithdrawals: number;
  dividends: number;
  interest: number;
  commissions: number;
  withholdingTax: number;
  otherFees: number;
  twr: number;
  fxRateToBase: number;
}

export interface ProcessedOpenPosition {
  symbol: string;
  description: string;
  position: number;
  markPrice: number;
  positionValue: number;
  costBasisMoney: number;
  fifoPnlUnrealized: number;
  percentOfNAV: number;
  currency: string;
  fxRateToBase: number;
  conid?: string; // Contract ID for better deduplication
}

export interface ProcessedTrade {
  symbol: string;
  tradeDate: Date;
  quantity: number;
  tradePrice: number;
  proceeds: number;
  commissions: number;
  buySell: string;
  currency: string;
  fxRateToBase: number;
  tradeID?: string; // Trade ID for deduplication
}

export interface ProcessedCashTransaction {
  date: Date;
  amount: number;
  type: string;
  description: string;
  symbol: string;
  currency: string;
  fxRateToBase: number;
  transactionID?: string; // Transaction ID for deduplication
}

export interface ProcessedTransfer {
  date: Date;
  amount: number;
  type: string;
  direction: string;
  description: string;
  currency: string;
  fxRateToBase: number;
  fromAccount?: string;
  toAccount?: string;
  transactionID?: string; // Transaction ID for deduplication
}

// Aggregated Types

export interface AggregatedData {
  totalNAV: number;
  dailyChange: number;
  dailyChangePercent: number;
  accounts: ProcessedAccount[];
  combinedPositions: CombinedPosition[];
  equityCurve: EquityCurvePoint[];
  feesAndIncome: FeesAndIncome;
  dividendsBySymbol?: Record<string, number>; // Dividends grouped by symbol for breakdown
  netDeposits: number; // Total deposits - withdrawals for verification (includes CSV inception)
  totalDeposits?: number; // Total deposits separately
  totalWithdrawals?: number; // Total withdrawals separately
  totalInternalOut?: number; // Total internal transfers OUT (subtracted from contributions)
  totalInternalIn?: number; // Total internal transfers IN (added to contributions)
  totalProfitLoss?: number; // Current NAV - Net Contributions
  simpleReturn?: number; // Display return: (Current NAV - XML Deposits Only) / XML Deposits Only (for 59.14% target)
  actualSimpleReturn?: number; // Actual return including CSV inception: (Current NAV - netDeposits) / netDeposits
  annualizedYield?: number; // Annualized Yield (CAGR): Math.pow(1 + Total_TWR, 365 / Days_Held) - 1
  twr?: number; // Time-Weighted Return (total, not annualized)
  daysHeld?: number; // Number of days portfolio has been held
  riskAnalytics?: import('./risk').RiskAnalytics; // Risk analytics metrics
}

export interface CombinedPosition {
  symbol: string;
  description: string;
  totalPosition: number;
  totalValue: number;
  totalCostBasis: number;
  totalUnrealizedPnl: number;
  totalPercentOfNAV: number;
  accounts: PositionBreakdown[];
  isCash?: boolean; // Flag to identify cash positions
}

export interface PositionBreakdown {
  accountId: string;
  accountAlias: string;
  position: number;
  value: number;
  costBasis: number;
  unrealizedPnl: number;
  percentOfNAV: number;
}

export interface EquityCurvePoint {
  date: Date;
  nav: number;
  cumulativeReturn: number; // Time-Weighted Return (TWR) percentage
  accountBreakdown?: { [accountId: string]: number }; // NAV per account for breakdown view
  simpleReturn?: number; // Simple Return: (NAV - Cumulative Contributions) / Cumulative Contributions
  cumulativeContributions?: number; // Cumulative contributions up to this date
  cashFlow?: number; // Cash flow amount for this date (positive = deposit, negative = withdrawal)
  isInternalTransfer?: boolean; // True if this cash flow is an internal transfer
}

export interface FeesAndIncome {
  totalDividends: number;
  totalInterest: number;
  totalCommissions: number;
  totalWithholdingTax: number;
  totalOtherFees: number;
  totalCredits: number;
  netProfit: number;
  grossProfit: number;
}

