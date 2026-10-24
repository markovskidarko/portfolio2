/**
 * Transaction categorization utility
 * Categorizes transactions from XML into appropriate database tables
 */
import type { ProcessedCashTransaction } from './types';

export interface CategorizedTransaction {
  category: 'deposit' | 'withdrawal' | 'dividend' | 'interest' | 'fee' | 'tax' | 'transfer' | 'other';
  amount: number;
  date: Date;
  description: string;
  symbol?: string;
  currency: string;
  fxRateToBase: number;
  transactionId?: string;
  feeType?: string; // For fees: 'commission', 'fee', etc.
  taxType?: string; // For taxes: 'withholding', etc.
}

/**
 * Categorize a cash transaction into its appropriate category
 */
export function categorizeTransaction(
  tx: ProcessedCashTransaction,
  accountId: string,
  transfers: Array<{ type: string; transactionID?: string }> = []
): CategorizedTransaction | null {
  const type = (tx.type || '').toLowerCase().trim();
  const description = (tx.description || '').toLowerCase().trim();
  const amount = tx.amount;
  
  // Check if this transaction is already represented in transfers table
  const isInTransfers = tx.transactionID && transfers.some(
    t => t.transactionID === tx.transactionID
  );
  
  // Skip if already in transfers (to avoid double-counting)
  if (isInTransfers) {
    return null;
  }
  
  // Dividends
  if (type.includes('dividend') || description.includes('dividend')) {
    return {
      category: 'dividend',
      amount: Math.abs(amount),
      date: tx.date,
      description: tx.description || '',
      symbol: tx.symbol || undefined,
      currency: tx.currency || 'USD',
      fxRateToBase: tx.fxRateToBase || 1.0,
      transactionId: tx.transactionID,
    };
  }
  
  // Interest
  if (type.includes('interest') || description.includes('interest')) {
    return {
      category: 'interest',
      amount: Math.abs(amount),
      date: tx.date,
      description: tx.description || '',
      currency: tx.currency || 'USD',
      fxRateToBase: tx.fxRateToBase || 1.0,
      transactionId: tx.transactionID,
    };
  }
  
  // Fees and Commissions
  if (type.includes('commission') || type.includes('fee') || 
      description.includes('commission') || description.includes('fee')) {
    let feeType = 'fee';
    if (type.includes('commission') || description.includes('commission')) {
      feeType = 'commission';
    }
    
    return {
      category: 'fee',
      amount: Math.abs(amount),
      date: tx.date,
      description: tx.description || '',
      currency: tx.currency || 'USD',
      fxRateToBase: tx.fxRateToBase || 1.0,
      transactionId: tx.transactionID,
      feeType,
    };
  }
  
  // Taxes (withholding tax, etc.)
  if (type.includes('withholding') || type.includes('tax') || 
      (description.includes('tax') && !description.includes('deposit'))) {
    let taxType = 'tax';
    if (type.includes('withholding') || description.includes('withholding')) {
      taxType = 'withholding';
    }
    
    return {
      category: 'tax',
      amount: Math.abs(amount),
      date: tx.date,
      description: tx.description || '',
      currency: tx.currency || 'USD',
      fxRateToBase: tx.fxRateToBase || 1.0,
      transactionId: tx.transactionID,
      taxType,
    };
  }
  
  // Transfers (EXTERNAL transfers - internal are already in Transfers table)
  const isTransfer = type.includes('transfer') && 
                     !type.includes('deposit') && 
                     !type.includes('withdrawal');
  const isInternal = type.includes('internal') || description.includes('internal');
  
  if (isTransfer && !isInternal) {
    // External transfers will be handled separately
    return {
      category: 'transfer',
      amount: Math.abs(amount),
      date: tx.date,
      description: tx.description || '',
      currency: tx.currency || 'USD',
      fxRateToBase: tx.fxRateToBase || 1.0,
      transactionId: tx.transactionID,
    };
  }
  
  // Deposits and Withdrawals (EXTERNAL only - internal transfers excluded)
  const isDepositsWithdrawalsType = type === 'deposits/withdrawals' || 
                                    type === 'deposits/withdrawal' ||
                                    type.includes('deposits/withdrawals');
  
  // Check for explicit deposit keywords (CASH RECEIPTS = deposits)
  const isCashReceipt = description.includes('cash receipt') || 
                        (description.includes('receipt') && !description.includes('disbursement'));
  
  const isExplicitDeposit = (type.includes('deposit') && 
                             !type.includes('dividend') && 
                             !type.includes('interest') &&
                             !type.includes('credit')) ||
                            (description.includes('deposit') && 
                             !description.includes('dividend')) ||
                            isCashReceipt; // "CASH RECEIPTS" = deposits
  
  const isExplicitWithdrawal = (type.includes('withdrawal') || 
                                type.includes('withdraw') ||
                                type.includes('disbursement') ||
                                description.includes('disbursement')) &&
                               !description.includes('dividend') &&
                               !description.includes('receipt'); // "CASH RECEIPTS" should not be withdrawals
  
  // Only count EXTERNAL deposits/withdrawals (exclude internal)
  if ((isDepositsWithdrawalsType || isExplicitDeposit || isExplicitWithdrawal) && !isInternal) {
    // CRITICAL: Check for withdrawal keywords FIRST (disbursement, withdrawal, etc.)
    // Disbursements are ALWAYS withdrawals, regardless of amount sign
    // This must come BEFORE deposit checks to prevent disbursements from being misclassified
    if (isExplicitWithdrawal) {
      // Withdrawal (including disbursements)
      return {
        category: 'withdrawal',
        amount: Math.abs(amount),
        date: tx.date,
        description: tx.description || '',
        currency: tx.currency || 'USD',
        fxRateToBase: tx.fxRateToBase || 1.0,
        transactionId: tx.transactionID,
      };
    }
    
    // For "Deposits/Withdrawals" type transactions with negative amounts = withdrawal
    if (isDepositsWithdrawalsType && amount < 0) {
      // Negative amount = withdrawal
      return {
        category: 'withdrawal',
        amount: Math.abs(amount),
        date: tx.date,
        description: tx.description || '',
        currency: tx.currency || 'USD',
        fxRateToBase: tx.fxRateToBase || 1.0,
        transactionId: tx.transactionID,
      };
    }
    
    // Check for explicit deposit keywords (CASH RECEIPTS = deposits)
    if (isExplicitDeposit || (isDepositsWithdrawalsType && isCashReceipt)) {
      // Deposit (including "CASH RECEIPTS")
      return {
        category: 'deposit',
        amount: Math.abs(amount),
        date: tx.date,
        description: tx.description || '',
        currency: tx.currency || 'USD',
        fxRateToBase: tx.fxRateToBase || 1.0,
        transactionId: tx.transactionID,
      };
    }
    
    // For generic "Deposits/Withdrawals" with positive amounts (not disbursements, not receipts)
    if (isDepositsWithdrawalsType && amount > 0) {
      // Positive amount = deposit
      return {
        category: 'deposit',
        amount: Math.abs(amount),
        date: tx.date,
        description: tx.description || '',
        currency: tx.currency || 'USD',
        fxRateToBase: tx.fxRateToBase || 1.0,
        transactionId: tx.transactionID,
      };
    }
  }
  
  // Other (adjustments, credits, etc.) - exclude from net contributions
  return null;
}

/**
 * Deduplicate withdrawals that are likely the same transaction recorded twice
 * This handles cases where the same disbursement appears on consecutive days
 */
export function deduplicateWithdrawals<T extends { amount: number; date: string; description: string }>(
  withdrawals: Array<T>
): Array<T> {
  if (withdrawals.length <= 1) {
    return withdrawals;
  }

  // Group withdrawals by similar amount and description
  const groups = new Map<string, Array<T>>();
  
  for (const withdrawal of withdrawals) {
    // Create a key based on amount and description pattern
    const amountKey = Math.round(withdrawal.amount).toString();
    const descKey = withdrawal.description?.toLowerCase().includes('disbursement') ? 'disbursement' : 'other';
    const key = `${amountKey}_${descKey}`;
    
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(withdrawal);
  }
  
  const deduplicated: Array<T> = [];
  
  for (const [key, group] of groups.entries()) {
    if (group.length === 1) {
      // Single withdrawal, keep as is
      deduplicated.push(group[0]);
    } else {
      // Multiple withdrawals with same amount
      // If they're disbursements and on consecutive days, keep only the first one
      const sorted = group.sort((a, b) => a.date.localeCompare(b.date));
      const first = sorted[0];
      const allDisbursements = sorted.every(w => w.description?.toLowerCase().includes('disbursement'));
      const allSameAmount = sorted.every(w => Math.abs(w.amount - first.amount) < 0.01);
      
      // Check if dates are within 2 days of each other
      let datesClose = true;
      for (let i = 1; i < sorted.length; i++) {
        const prevDate = new Date(sorted[i - 1].date);
        const currDate = new Date(sorted[i].date);
        const diffDays = Math.abs((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays > 2) {
          datesClose = false;
          break;
        }
      }
      
      if (allDisbursements && allSameAmount && datesClose) {
        // These are duplicate disbursements - keep only the first one (earliest date)
        console.log(`[CATEGORIZER] Deduplicating ${group.length} duplicate disbursements of $${first.amount.toFixed(2)}: keeping only ${first.date}`);
        deduplicated.push(first);
      } else {
        // Not duplicates, keep all
        deduplicated.push(...sorted);
      }
    }
  }
  
  return deduplicated;
}

