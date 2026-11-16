import FileUploader from "./FileUploader";
import { Modal } from "./ui/Modal";

interface UploadModalProps {
  isOpen: boolean;
  suspended?: boolean;
  onClose: () => void;
  onUploadSuccess: () => void;
}

export default function UploadModal({ isOpen, suspended = false, onClose, onUploadSuccess }: UploadModalProps) {
  return (
    <Modal isOpen={isOpen} suspended={suspended} onClose={onClose} title="Upload Files" maxWidth="lg">
      <FileUploader onUploadSuccess={() => {
        onUploadSuccess();
        onClose();
      }} />
    </Modal>
  );
}
