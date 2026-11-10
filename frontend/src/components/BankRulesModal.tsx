import { Modal } from "./ui/Modal";
import BankRulesTab, { type BankRulesTabProps } from "./BankRulesTab";

interface BankRulesModalProps extends BankRulesTabProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function BankRulesModal({
  isOpen,
  onClose,
  initialRuleData,
  onRulesApplied,
}: BankRulesModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span className="font-bold text-white">Automated Bank Rules</span>
        </div>
      }
      maxWidth="4xl"
      bodyClassName="p-5 overflow-y-auto flex-1 min-h-0 custom-scrollbar max-h-[80vh]"
    >
      <BankRulesTab
        initialRuleData={initialRuleData}
        onRulesApplied={onRulesApplied}
      />
    </Modal>
  );
}
