import { BrowserRouter, Routes, Route } from "react-router-dom";

import Dashboard from "./pages/Dashboard";
import MonthLedger from "./pages/MonthLedger";
import DetailsView from "./pages/DetailsView";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/ledger/:year/:month" element={<MonthLedger />} />
        <Route path="/details/:type/:id" element={<DetailsView />} />
      </Routes>
    </BrowserRouter>
  );
}