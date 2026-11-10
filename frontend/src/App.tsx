import LedgerPage from "./pages/LedgerPage";
import { ConfirmationProvider } from "./components/ui/ConfirmDialog";
import { TooltipProvider } from "./components/ui/Tooltip";

export default function App() {
  return (
    <TooltipProvider>
      <ConfirmationProvider>
        <LedgerPage />
      </ConfirmationProvider>
    </TooltipProvider>
  );
}