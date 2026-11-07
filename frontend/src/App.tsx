import LedgerPage from "./pages/LedgerPage";
import { ConfirmationProvider } from "./components/ui/ConfirmDialog";

export default function App() {
  return (
    <ConfirmationProvider>
      <LedgerPage />
    </ConfirmationProvider>
  );
}