import LedgerPage from "./pages/LedgerPage";
import { ConfirmationProvider } from "./components/ui/ConfirmDialog";
import { TooltipProvider } from "./components/ui/Tooltip";
import { NavigationStackProvider } from "./context/NavigationStackProvider";

export default function App() {
  return (
    <TooltipProvider>
      <ConfirmationProvider>
        <NavigationStackProvider>
          <LedgerPage />
        </NavigationStackProvider>
      </ConfirmationProvider>
    </TooltipProvider>
  );
}