import { useState, useEffect } from "react";
import { getSettings, updateSettings } from "../services/api";
import { Modal } from "./ui/Modal";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  refreshData: () => void;
}

export default function SettingsModal({ isOpen, onClose, refreshData }: SettingsModalProps) {
  const [booksClosedDate, setBooksClosedDate] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    try {
      const settings = await getSettings();
      if (settings["BooksClosedDate"]) {
        setBooksClosedDate(settings["BooksClosedDate"]);
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError("");
    try {
      await updateSettings("BooksClosedDate", booksClosedDate);
      refreshData();
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to update settings");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title="Global Settings" 
      maxWidth="md"
      footer={
        <div className="flex gap-3 justify-end w-full">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} isLoading={isSaving}>
            Save Changes
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">
            {error}
          </div>
        )}
        <div>
          <p className="text-xs text-zinc-500 mb-4 leading-relaxed">
            Transactions on or before this date will be locked to prevent accidental changes to your past tax or financial records. 
            <br/><br/>
            <em>Need to make an adjusting entry? You can temporarily clear or change this date at any time.</em>
          </p>
          <Input
            type="date"
            label="Lock Books (Closing Date)"
            value={booksClosedDate}
            onChange={e => setBooksClosedDate(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
