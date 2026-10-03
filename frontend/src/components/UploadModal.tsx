import FileUploader from "./FileUploader";
import { Modal } from "./ui/Modal";

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess: () => void;
}

export default function UploadModal({ isOpen, onClose, onUploadSuccess }: UploadModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Upload Files" maxWidth="lg">
      <FileUploader onUploadSuccess={() => {
        onUploadSuccess();
        onClose();
      }} />
    </Modal>
  );
}
