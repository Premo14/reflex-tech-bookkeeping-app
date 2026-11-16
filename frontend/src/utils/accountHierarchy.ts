import type { ChartAccount } from "../types/models";

export interface SubClassDef {
  id: string;
  name: string;
  min: number;
  max: number;
  prefix: string;
  description: string;
}

export const ACCOUNT_SUBCLASSES: Record<string, SubClassDef[]> = {
  ASSET: [
    {
      id: "CASH",
      name: "Cash & Cash Equivalents",
      min: 1000,
      max: 1099,
      prefix: "10",
      description: "Liquid funds, checking, savings, money market, cash on hand",
    },
    {
      id: "AR",
      name: "Accounts Receivable",
      min: 1100,
      max: 1199,
      prefix: "11",
      description: "Unpaid customer invoices and trade receivables",
    },
    {
      id: "INVENTORY",
      name: "Inventory Assets",
      min: 1200,
      max: 1299,
      prefix: "12",
      description: "Physical merchandise, inventory, and materials held for resale",
    },
    {
      id: "FIXED_ASSET",
      name: "Fixed Assets & Equipment",
      min: 1300,
      max: 1399,
      prefix: "13",
      description: "Machinery, computers, equipment, property, vehicles",
    },
    {
      id: "OTHER_CURRENT_ASSET",
      name: "Other Current Assets",
      min: 1400,
      max: 1499,
      prefix: "14",
      description: "Prepaid expenses, security deposits, short-term advances",
    },
    {
      id: "OTHER_NONCURRENT_ASSET",
      name: "Other Non-Current Assets",
      min: 1500,
      max: 1599,
      prefix: "15",
      description: "Long-term investments, security bonds, intangible assets",
    },
  ],
  LIABILITY: [
    {
      id: "CURRENT_LIABILITY",
      name: "Current Liabilities & Credit Cards",
      min: 2000,
      max: 2099,
      prefix: "20",
      description: "Credit card balances, accounts payable, revolving credit lines",
    },
    {
      id: "PAYROLL_TAX",
      name: "Payroll & Tax Payables",
      min: 2100,
      max: 2199,
      prefix: "21",
      description: "Accrued payroll wages, sales taxes, withholdings",
    },
    {
      id: "SHORT_TERM_PAYABLES",
      name: "Accrued & Other Payables",
      min: 2200,
      max: 2299,
      prefix: "22",
      description: "Short-term notes, accrued liabilities, vendor payables",
    },
    {
      id: "LONG_TERM_DEBT",
      name: "Long-Term Debt & Loans",
      min: 2500,
      max: 2599,
      prefix: "25",
      description: "Bank term loans, mortgages, long-term notes payable",
    },
  ],
  EQUITY: [
    {
      id: "OWNER_EQUITY",
      name: "Owner's Equity & Retained Earnings",
      min: 3000,
      max: 3099,
      prefix: "30",
      description: "Owner investments, retained earnings, initial capital",
    },
    {
      id: "OWNER_DRAWS",
      name: "Draws & Distributions",
      min: 3100,
      max: 3199,
      prefix: "31",
      description: "Partner distributions and owner cash withdrawals",
    },
  ],
  REVENUE: [
    {
      id: "SALES_REVENUE",
      name: "Operating Sales & Service Revenue",
      min: 4000,
      max: 4099,
      prefix: "40",
      description: "Sales of goods, product sales, merchant revenue",
    },
    {
      id: "SERVICE_FEES",
      name: "Professional & Consulting Fees",
      min: 4100,
      max: 4199,
      prefix: "41",
      description: "Consulting fees, advisory billing, service contracts",
    },
    {
      id: "OTHER_INCOME",
      name: "Other Income & Gains",
      min: 4200,
      max: 4299,
      prefix: "42",
      description: "Interest income, cash-back rewards, asset sale gains",
    },
  ],
  EXPENSE: [
    {
      id: "OPERATING_EXPENSES",
      name: "Operating Expenses",
      min: 5000,
      max: 5099,
      prefix: "50",
      description: "Rent, payroll, utilities, supplies, insurance, meals",
    },
    {
      id: "GENERAL_ADMIN",
      name: "General & Administrative",
      min: 5100,
      max: 5199,
      prefix: "51",
      description: "Professional services, legal, accounting, office",
    },
    {
      id: "SOFTWARE_TECH",
      name: "Software & Subscriptions",
      min: 5200,
      max: 5299,
      prefix: "52",
      description: "Software licenses, SaaS subscriptions, cloud hosting",
    },
    {
      id: "MARKETING_SALES",
      name: "Marketing & Advertising",
      min: 5300,
      max: 5399,
      prefix: "53",
      description: "Online ads, campaigns, promotional events",
    },
    {
      id: "FACILITIES_TRAVEL",
      name: "Facilities & Travel",
      min: 5400,
      max: 5499,
      prefix: "54",
      description: "Office rent, maintenance, flights, lodging, meals",
    },
    {
      id: "VEHICLE_TRAVEL",
      name: "Vehicle & Transportation",
      min: 5500,
      max: 5599,
      prefix: "55",
      description: "Auto expenses, mileage reimbursement, gas, parking",
    },
    {
      id: "TAXES_LICENSES",
      name: "Taxes & Licenses",
      min: 5600,
      max: 5699,
      prefix: "56",
      description: "Business taxes, municipal licenses, permits, fees",
    },
    {
      id: "DEPRECIATION",
      name: "Interest & Depreciation",
      min: 5700,
      max: 5799,
      prefix: "57",
      description: "Interest expense, asset depreciation, and Section 179 write-offs",
    },
    {
      id: "MERCHANT_FEES",
      name: "Commissions & Merchant Fees",
      min: 5800,
      max: 5899,
      prefix: "58",
      description: "Payment processor fees, Stripe, Square, PayPal, commissions",
    },
    {
      id: "OTHER_EXPENSES",
      name: "Other Expenses & Bank Fees",
      min: 5900,
      max: 5999,
      prefix: "59",
      description: "Bank fees, interest charges, miscellaneous costs",
    },
  ],
};

export function getSubClassForAccount(type: string, code: string, explicitSubClassId?: string): SubClassDef | undefined {
  const list = ACCOUNT_SUBCLASSES[type] || [];
  if (explicitSubClassId) {
    const matched = list.find(sc => sc.id === explicitSubClassId);
    if (matched) return matched;
  }
  const clean = (code || "").trim();
  if (clean.length >= 2) {
    const prefix2 = clean.slice(0, 2);
    const byPrefix = list.find(sc => sc.prefix === prefix2);
    if (byPrefix) return byPrefix;
  }
  const num = parseInt(clean, 10);
  if (!isNaN(num)) {
    const byRange = list.find(sc => num >= sc.min && num <= sc.max);
    if (byRange) return byRange;
  }
  return undefined;
}

export function getAccountDepth(account: ChartAccount, allAccounts: ChartAccount[]): number {
  let depth = 0;
  let curr: ChartAccount | undefined = account;
  const visited = new Set<number>();

  while (curr?.parentId && !visited.has(curr.parentId)) {
    visited.add(curr.parentId);
    depth++;
    curr = allAccounts.find(a => a.id === curr?.parentId);
  }
  return depth;
}

export interface GroupedAccountOption {
  account: ChartAccount;
  depth: number;
  displayName: string;
}

export interface SubClassGroup {
  subClassId: string;
  name: string;
  label: string;
  options: GroupedAccountOption[];
}

export function getGroupedAccounts(
  accounts: ChartAccount[],
  types: ('ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE')[],
  options?: {
    activeOnly?: boolean;
    currentSelectedId?: number | string | null;
  }
): SubClassGroup[] {
  const activeOnly = options?.activeOnly ?? true;
  const currentId = options?.currentSelectedId ? String(options.currentSelectedId) : null;

  // Filter accounts belonging to allowed types and active status (or currently selected)
  const eligibleAccounts = accounts.filter(acc => {
    if (!types.includes(acc.type)) return false;
    if (activeOnly && !acc.active && String(acc.id) !== currentId) return false;
    return true;
  });

  const groups: SubClassGroup[] = [];
  const assignedAccountIds = new Set<number>();

  // Process each type in order
  for (const type of types) {
    const subClasses = ACCOUNT_SUBCLASSES[type] || [];

    for (const subClass of subClasses) {
      // Find accounts matching this subclass
      const matchingAccounts = eligibleAccounts.filter(acc => {
        if (acc.type !== type) return false;
        const sc = getSubClassForAccount(acc.type, acc.code);
        return sc?.id === subClass.id;
      });

      if (matchingAccounts.length === 0) continue;

      const groupOptions: GroupedAccountOption[] = [];
      const subClassIds = new Set(matchingAccounts.map(a => a.id));

      // Separate top-level accounts within this subclass from children
      const topLevel = matchingAccounts
        .filter(a => !a.parentId || !subClassIds.has(a.parentId))
        .sort((a, b) => a.code.localeCompare(b.code));

      const addAccountTree = (account: ChartAccount, depth: number) => {
        assignedAccountIds.add(account.id);
        const prefix = depth > 0 ? "↳ ".repeat(depth) : "";
        const archivedTag = !account.active ? " (Archived)" : "";
        groupOptions.push({
          account,
          depth,
          displayName: `${prefix}${account.code} — ${account.name}${archivedTag}`,
        });

        // Find direct children within this subclass
        const directChildren = matchingAccounts
          .filter(a => a.parentId === account.id)
          .sort((a, b) => a.code.localeCompare(b.code));

        for (const child of directChildren) {
          addAccountTree(child, depth + 1);
        }
      };

      topLevel.forEach(a => addAccountTree(a, 0));

      // Catch any remaining unvisited accounts in this subclass
      matchingAccounts
        .filter(a => !assignedAccountIds.has(a.id))
        .sort((a, b) => a.code.localeCompare(b.code))
        .forEach(a => addAccountTree(a, 1));

      groups.push({
        subClassId: `${type}_${subClass.id}`,
        name: subClass.name,
        label: `${subClass.min}–${subClass.max} ${subClass.name}`,
        options: groupOptions,
      });
    }
  }

  // Any accounts that didn't match standard subclasses
  const unassigned = eligibleAccounts
    .filter(a => !assignedAccountIds.has(a.id))
    .sort((a, b) => a.code.localeCompare(b.code));

  if (unassigned.length > 0) {
    groups.push({
      subClassId: "OTHER_CUSTOM",
      name: "Other Accounts",
      label: "Other Accounts",
      options: unassigned.map(a => {
        const archivedTag = !a.active ? " (Archived)" : "";
        return {
          account: a,
          depth: 0,
          displayName: `${a.code} — ${a.name}${archivedTag}`,
        };
      }),
    });
  }

  return groups;
}

/** Recursively collects all descendant chart account IDs for cycle-safe parent filtering. */
export function getDescendantIds(rootId: number, allAccounts: ChartAccount[]): Set<number> {
  const descendants = new Set<number>();
  function recurse(parentId: number) {
    for (const a of allAccounts) {
      if (a.parentId === parentId && !descendants.has(a.id)) {
        descendants.add(a.id);
        recurse(a.id);
      }
    }
  }
  recurse(rootId);
  return descendants;
}

/** Suggests the next unused 4-digit account code within a subclass numeric range. */
export function getNextAvailableCodeInRange(min: number, max: number, existingAccounts: ChartAccount[]): string {
  const existingCodes = new Set(existingAccounts.map((a) => parseInt(a.code, 10)).filter((n) => !isNaN(n)));
  for (let candidate = min; candidate <= max; candidate += 10) {
    if (!existingCodes.has(candidate)) {
      return String(candidate);
    }
  }
  for (let candidate = min; candidate <= max; candidate++) {
    if (!existingCodes.has(candidate)) {
      return String(candidate);
    }
  }
  return String(min);
}

/** Standard IRS Form 1040 Schedule C line options for tax mapping in Chart of Accounts. */
export const SCHEDULE_C_OPTIONS = [
  { value: "", label: "-- None / Not Applicable --" },
  { value: "Line 1 - Gross receipts or sales", label: "Line 1 - Gross receipts or sales (Revenue)" },
  { value: "Line 2 - Returns and allowances", label: "Line 2 - Returns & allowances" },
  { value: "Line 4 - Cost of goods sold", label: "Line 4 - Cost of goods sold (COGS)" },
  { value: "Line 6 - Other income", label: "Line 6 - Other income (Interest, refunds)" },
  { value: "Line 8 - Advertising", label: "Line 8 - Advertising & marketing" },
  { value: "Line 9 - Car and truck expenses", label: "Line 9 - Car and truck expenses" },
  { value: "Line 10 - Commissions and fees", label: "Line 10 - Commissions and fees" },
  { value: "Line 11 - Contract labor", label: "Line 11 - Contract labor (1099)" },
  { value: "Line 12 - Depletion", label: "Line 12 - Depletion" },
  { value: "Line 13 - Depreciation and section 179 expense deduction", label: "Line 13 - Depreciation & Sec 179" },
  { value: "Line 13 - Depreciation", label: "Line 13 - Depreciation (Legacy)" },
  { value: "Line 14 - Employee benefit programs", label: "Line 14 - Employee benefits" },
  { value: "Line 15 - Insurance (other than health)", label: "Line 15 - Insurance (liability, business)" },
  { value: "Line 16a - Mortgage interest", label: "Line 16a - Mortgage interest" },
  { value: "Line 16b - Other interest", label: "Line 16b - Other interest (loans, credit card interest)" },
  { value: "Line 17 - Legal and professional services", label: "Line 17 - Legal and professional services" },
  { value: "Line 18 - Office expense", label: "Line 18 - Office expense & supplies" },
  { value: "Line 19 - Pension and profit-sharing", label: "Line 19 - Pension and profit-sharing" },
  { value: "Line 20a - Rent or lease (vehicles, machinery, and equipment)", label: "Line 20a - Rent (vehicles, machinery, equipment)" },
  { value: "Line 20a - Rent (vehicles, machinery)", label: "Line 20a - Rent (vehicles, machinery) (Legacy)" },
  { value: "Line 20b - Rent or lease (other business property)", label: "Line 20b - Rent/lease (office, property)" },
  { value: "Line 21 - Repairs and maintenance", label: "Line 21 - Repairs and maintenance" },
  { value: "Line 22 - Supplies", label: "Line 22 - Supplies & materials" },
  { value: "Line 23 - Taxes and licenses", label: "Line 23 - Taxes and licenses" },
  { value: "Line 24a - Travel", label: "Line 24a - Travel & lodging" },
  { value: "Line 24b - Deductible meals (50%)", label: "Line 24b - Deductible meals (50% IRS limit)" },
  { value: "Line 25 - Utilities", label: "Line 25 - Utilities (electric, internet, phone)" },
  { value: "Line 26 - Wages", label: "Line 26 - Wages & salaries" },
  { value: "Line 27a - Other expenses", label: "Line 27a - Other expenses" },
  { value: "Line 27a - Other expenses (Software & online services)", label: "Line 27a - Other expenses (Software & SaaS)" },
  { value: "Line 27a - Other expenses (Bank & merchant fees)", label: "Line 27a - Other expenses (Bank fees)" },
  { value: "Line 30 - Expenses for business use of your home", label: "Line 30 - Business use of home (IRC § 280A / Home Office)" },
];
