import type { ChartAccount } from "../../types/models";
import type { CreateAndLinkInput } from "../../services/api";
import type { ManualExpenseFormState } from "../CreateExpenseForm";
import type { ManualTransactionFormState } from "../CreateTransactionForm";

export type DetailDrawerType = "transaction" | "receipt" | "invoice";
export type LinkTargetMode = "tx" | "expense" | "invoice";

export interface ActionTarget {
  type: "transaction" | "expense";
  id: number;
  linkedChoice?: "ONLY_THIS" | "ALL_LINKED";
}

export interface ActionChoiceState {
  action: "EXCLUDE" | "IGNORE";
  targetType: "transaction" | "expense";
  targetId: number;
}

export interface AllowConfirmState {
  type: "transaction" | "expense";
  id: number;
  date: string;
}

export type CreateFormState = ManualExpenseFormState & ManualTransactionFormState;

export type CreateAndLinkPayload = Omit<CreateAndLinkInput, "targetId" | "type"> & {
  type?: CreateAndLinkInput["type"];
  targetId?: number;
  timestamp?: string;
  transactionType?: string;
  taxAmount?: number | string;
  currencyCode?: string;
  tender?: string;
};

export type ConflictCategoryRef = Pick<ChartAccount, "id" | "code" | "name" | "active">;

export type ConflictModalState =
  | {
      isCreateMode: true;
      createPayload: CreateAndLinkPayload;
      txCategory: ConflictCategoryRef;
      expCategory: ConflictCategoryRef;
    }
  | {
      isCreateMode?: false;
      expenseId: number;
      transactionId: number;
      txCategory: ConflictCategoryRef;
      expCategory: ConflictCategoryRef;
    };

export type OverAllocatedModalState =
  | {
      isCreateMode: true;
      createPayload: CreateAndLinkPayload;
      overrideChartAccountId?: number;
      message: string;
    }
  | {
      isCreateMode?: false;
      expenseId: number;
      transactionId: number;
      overrideChartAccountId?: number;
      message: string;
    };

export interface ReplaceOrAddModalState {
  isSuggested?: boolean;
  isCreateMode?: boolean;
  selectedLinkId?: number;
  suggestedExpId?: number;
  suggestedTxId?: number;
  createPayload?: CreateAndLinkPayload;
}

export interface ExpenseEditFormState {
  timestamp: string;
  vendor: string;
  description: string;
  amount: number;
  taxAmount: number;
  currencyCode: string;
  tender: string;
  notes: string;
  chartAccountId: number | string;
}

export interface TxEditFormState {
  date: string;
  description: string;
  amount: number;
  notes: string;
  chartAccountId: number | string;
  categoryAccountId: number | string;
}
