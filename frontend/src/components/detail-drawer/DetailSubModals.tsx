import React from "react";
import type { ChartAccount } from "../../types/models";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Tooltip } from "../ui/Tooltip";
import CreateExpenseForm from "../CreateExpenseForm";
import CreateTransactionForm from "../CreateTransactionForm";
import type {
  ActionChoiceState,
  ActionTarget,
  AllowConfirmState,
  ConflictModalState,
  CreateFormState,
  DetailDrawerType,
  OverAllocatedModalState,
  ReplaceOrAddModalState,
} from "./types";

export interface DetailSubModalsProps {
  type: DetailDrawerType | null;
  accounts: ChartAccount[];
  isSaving: boolean;
  isAllowing: boolean;
  showCreateModal: boolean;
  createForm: CreateFormState;
  onChangeCreateForm: React.Dispatch<React.SetStateAction<CreateFormState>>;
  onCloseCreateModal: () => void;
  onSubmitCreate: () => void;
  ignoreTarget: ActionTarget | null;
  onCloseIgnoreModal: () => void;
  onConfirmIgnore: (target: ActionTarget) => void;
  actionChoiceModal: ActionChoiceState | null;
  onCloseActionChoice: () => void;
  onSelectActionChoice: (choice: "ONLY_THIS" | "ALL_LINKED", data: ActionChoiceState) => void;
  conflictModalData: ConflictModalState | null;
  onCloseConflictModal: () => void;
  onResolveConflict: (chosenCategoryId: number, data: ConflictModalState) => void;
  replaceOrAddModalData: ReplaceOrAddModalState | null;
  onCloseReplaceOrAddModal: () => void;
  onAddSplitLink: (data: ReplaceOrAddModalState) => void;
  onReplaceLinks: (data: ReplaceOrAddModalState) => void;
  overAllocatedModalData: OverAllocatedModalState | null;
  onCloseOverAllocatedModal: () => void;
  onConfirmOverAllocated: (data: OverAllocatedModalState) => void;
  allowConfirmTarget: AllowConfirmState | null;
  onCloseAllowConfirm: () => void;
  onConfirmAllowClosed: (target: AllowConfirmState) => void;
}

function getReopenTargetDateLabel(dateStr: string): string {
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return dateStr;
  parsed.setDate(parsed.getDate() - 1);
  return parsed.toISOString().split("T")[0];
}

/** Collection of confirmation, conflict-resolution, and create-and-link dialogs for DetailDrawer. */
export function DetailSubModals({
  type,
  accounts,
  isSaving,
  isAllowing,
  showCreateModal,
  createForm,
  onChangeCreateForm,
  onCloseCreateModal,
  onSubmitCreate,
  ignoreTarget,
  onCloseIgnoreModal,
  onConfirmIgnore,
  actionChoiceModal,
  onCloseActionChoice,
  onSelectActionChoice,
  conflictModalData,
  onCloseConflictModal,
  onResolveConflict,
  replaceOrAddModalData,
  onCloseReplaceOrAddModal,
  onAddSplitLink,
  onReplaceLinks,
  overAllocatedModalData,
  onCloseOverAllocatedModal,
  onConfirmOverAllocated,
  allowConfirmTarget,
  onCloseAllowConfirm,
  onConfirmAllowClosed,
}: DetailSubModalsProps) {
  return (
    <>
      <Modal
        isOpen={showCreateModal}
        onClose={onCloseCreateModal}
        maxWidth="md"
        title={`Create & Link ${type === "transaction" ? "Expense" : "Transaction"}`}
        footer={
          <div className="flex gap-3 justify-end w-full">
            <Button variant="ghost" onClick={onCloseCreateModal}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={onSubmitCreate}
              disabled={isSaving}
              isLoading={isSaving}
              className="touch-glow-emerald"
            >
              {isSaving ? "Saving…" : "Create & Link"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {type === "transaction" ? (
            <CreateExpenseForm form={createForm} setForm={onChangeCreateForm} accounts={accounts} />
          ) : (
            <CreateTransactionForm form={createForm} setForm={onChangeCreateForm} accounts={accounts} />
          )}
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(ignoreTarget)}
        onClose={onCloseIgnoreModal}
        maxWidth="lg"
        title="Ignore Warnings"
        footer={
          ignoreTarget && (
            <div className="flex justify-end gap-3 w-full">
              <Button variant="ghost" onClick={onCloseIgnoreModal}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={isSaving}
                isLoading={isSaving}
                className="bg-orange-600! hover:bg-orange-500! text-white border-transparent touch-glow-amber"
                onClick={() => onConfirmIgnore(ignoreTarget)}
              >
                {isSaving ? "Ignoring..." : "Confirm Ignore"}
              </Button>
            </div>
          )
        }
      >
        {ignoreTarget && (
          <div className="space-y-4">
            <div className="p-4 bg-orange-500/10 border border-orange-500/20 rounded-xl text-sm text-orange-200/90 leading-relaxed">
              <p className="font-bold text-orange-400 mb-1">Are you sure?</p>
              This will mark the item as reviewed and ignore any warnings (like missing receipts or rule mismatches).
              The item stays in the books, but no longer requires review.
            </div>
            {ignoreTarget.linkedChoice && (
              <div className="p-4 bg-blue-500/10 border border-blue-500/20 text-blue-300 rounded-xl text-sm font-medium">
                {ignoreTarget.linkedChoice === "ONLY_THIS"
                  ? "You chose to sever the link(s) and only ignore warnings for this specific item."
                  : "You chose to keep the link(s) intact and ignore warnings for all linked items."}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(actionChoiceModal)}
        onClose={onCloseActionChoice}
        maxWidth="md"
        title="Linked Items Detected"
        footer={
          <div className="flex justify-end w-full">
            <Button variant="ghost" onClick={onCloseActionChoice}>
              Cancel
            </Button>
          </div>
        }
      >
        {actionChoiceModal && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400 leading-relaxed">
              This item is currently linked to{" "}
              {actionChoiceModal.targetType === "transaction" ? "one or more expenses" : "a bank transaction"}. How
              would you like to proceed?
            </p>
            <button
              type="button"
              className="w-full p-4 border border-zinc-700 rounded-lg hover:border-blue-500 hover:bg-blue-500/10 text-left transition-colors touch-glow-blue cursor-pointer"
              onClick={() => onSelectActionChoice("ONLY_THIS", actionChoiceModal)}
            >
              <div className="font-medium text-white">
                Unlink & {actionChoiceModal.action === "EXCLUDE" ? "Exclude" : "Ignore"} Only This Item
              </div>
              <div className="text-xs text-zinc-400 mt-1">
                Sever the link(s) and only apply the action to the selected item.
              </div>
            </button>

            <button
              type="button"
              className="w-full p-4 border border-zinc-700 rounded-lg hover:border-red-500 hover:bg-red-500/10 text-left transition-colors touch-glow-red cursor-pointer"
              onClick={() => onSelectActionChoice("ALL_LINKED", actionChoiceModal)}
            >
              <div className="font-medium text-white">
                {actionChoiceModal.action === "EXCLUDE" ? "Exclude" : "Ignore"} All Linked Items
              </div>
              <div className="text-xs text-zinc-400 mt-1">
                Keep the link(s) intact and apply the action to the entire group.
              </div>
            </button>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(conflictModalData)}
        onClose={onCloseConflictModal}
        maxWidth="md"
        title="Category Mismatch"
        footer={
          <div className="flex justify-end w-full">
            <Button variant="ghost" onClick={onCloseConflictModal}>
              Cancel
            </Button>
          </div>
        }
      >
        {conflictModalData && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400 leading-relaxed">
              The items you are trying to link have conflicting categories. Which category should both items use?
            </p>
            <button
              type="button"
              className="w-full p-4 border border-zinc-700 rounded-lg hover:border-blue-500 hover:bg-blue-500/10 text-left transition-colors touch-glow-blue cursor-pointer"
              onClick={() => onResolveConflict(conflictModalData.txCategory.id, conflictModalData)}
            >
              <div className="font-medium text-white flex items-center gap-2">
                <span>
                  {conflictModalData.txCategory.code} — {conflictModalData.txCategory.name}
                </span>
                {!conflictModalData.txCategory.active && (
                  <Tooltip content="This account category has been archived in Chart of Accounts. Historical records are preserved for tax compliance.">
                    <span>
                      <Badge variant="danger">Archived</Badge>
                    </span>
                  </Tooltip>
                )}
              </div>
              <div className="text-xs text-zinc-400 mt-1">Use the Bank Transaction&apos;s category</div>
            </button>

            <button
              type="button"
              className="w-full p-4 border border-zinc-700 rounded-lg hover:border-blue-500 hover:bg-blue-500/10 text-left transition-colors touch-glow-blue cursor-pointer"
              onClick={() => onResolveConflict(conflictModalData.expCategory.id, conflictModalData)}
            >
              <div className="font-medium text-white flex items-center gap-2">
                <span>
                  {conflictModalData.expCategory.code} — {conflictModalData.expCategory.name}
                </span>
                {!conflictModalData.expCategory.active && (
                  <Tooltip content="This account category has been archived in Chart of Accounts. Historical records are preserved for tax compliance.">
                    <span>
                      <Badge variant="danger">Archived</Badge>
                    </span>
                  </Tooltip>
                )}
              </div>
              <div className="text-xs text-zinc-400 mt-1">Use the Expense&apos;s category</div>
            </button>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(replaceOrAddModalData)}
        onClose={onCloseReplaceOrAddModal}
        maxWidth="md"
        title="Already Linked"
        footer={
          <div className="flex justify-end w-full">
            <Button variant="ghost" onClick={onCloseReplaceOrAddModal}>
              Cancel
            </Button>
          </div>
        }
      >
        {replaceOrAddModalData && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400 leading-relaxed">
              This {type === "transaction" ? "transaction" : "expense"} is already linked to another item. Do you
              want to add this new link (e.g., for a split payment) or replace the existing linked item(s) entirely?
            </p>
            <button
              type="button"
              className="w-full p-4 border border-zinc-700 rounded-lg hover:border-blue-500 hover:bg-blue-500/10 text-left transition-colors touch-glow-blue cursor-pointer"
              onClick={() => onAddSplitLink(replaceOrAddModalData)}
            >
              <div className="font-medium text-white">Add to Existing (Split)</div>
              <div className="text-xs text-zinc-400 mt-1">Keep current links and add this new one.</div>
            </button>

            <button
              type="button"
              className="w-full p-4 border border-zinc-700 rounded-lg hover:border-red-500 hover:bg-red-500/10 text-left transition-colors touch-glow-red cursor-pointer"
              onClick={() => onReplaceLinks(replaceOrAddModalData)}
            >
              <div className="font-medium text-white">Replace Existing</div>
              <div className="text-xs text-zinc-400 mt-1">Remove current links and only keep this new one.</div>
            </button>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(overAllocatedModalData)}
        onClose={onCloseOverAllocatedModal}
        maxWidth="md"
        title="Amount Mismatch"
        footer={
          overAllocatedModalData && (
            <div className="flex justify-end gap-3 w-full">
              <Button variant="ghost" onClick={onCloseOverAllocatedModal}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => onConfirmOverAllocated(overAllocatedModalData)}
                className="touch-glow-emerald"
              >
                Link Anyway
              </Button>
            </div>
          )
        }
      >
        {overAllocatedModalData && (
          <p className="text-sm text-zinc-300 leading-relaxed">{overAllocatedModalData.message}</p>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(allowConfirmTarget)}
        onClose={onCloseAllowConfirm}
        maxWidth="md"
        title="Reopen Books to Allow Item"
        footer={
          allowConfirmTarget && (
            <div className="flex justify-end gap-3 w-full">
              <Button variant="ghost" onClick={onCloseAllowConfirm}>
                Cancel
              </Button>
              <Button
                variant="primary"
                isLoading={isAllowing}
                onClick={() => onConfirmAllowClosed(allowConfirmTarget)}
                className="touch-glow-emerald"
              >
                Confirm & Reopen Books
              </Button>
            </div>
          )
        }
      >
        {allowConfirmTarget && (
          <p className="text-sm text-zinc-300 leading-relaxed">
            Allowing this item will approve it and reopen your books back to{" "}
            <strong className="text-white font-mono">{getReopenTargetDateLabel(allowConfirmTarget.date)}</strong> (the
            day before this item). Any linked items and subsequent pending items will be approved automatically.
          </p>
        )}
      </Modal>
    </>
  );
}
