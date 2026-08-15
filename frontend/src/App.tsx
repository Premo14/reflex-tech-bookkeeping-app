<<<<<<< HEAD
  function App() {

    return (
    // Main background wrapper
    <div className="min-h-screen bg-black p-8 font-sans">
=======
import { useState } from "react";

export default function App() {
  // Automatic Date and Countdown Logic
  const today = new Date();
  const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const daysRemaining = lastDayOfMonth.getDate() - today.getDate();
  
  const formattedDate = today.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  const [is2026Open, setIs2026Open] = useState(true);
  // Track if the mobile sidebar is open
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); 

  return (
    <div className="flex h-screen bg-zinc-900 font-sans text-zinc-100 selection:bg-zinc-700 overflow-hidden relative">
>>>>>>> ui-examples
      
      {/* MOBILE OVERLAY: Dims the background when the sidebar is open on small screens */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

<<<<<<< HEAD
        {/* 1. Image Receipt Card */}
        <section className="bg-gray-600 rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-black mb-4">Mobile Image Capture</h2>
          {/* A soft background pad to frame the image nicely */}
          <div className="flex justify-center bg-gray-800 rounded-lg p-4 border border-gray-200">
            <img
              src="/mock_receipts/walmart-receipt.png"
              alt="Walmart receipt"
              // object-contain ensures it never stretches weirdly, max-h keeps it manageable 
              className="max-h-150 w-auto object-contain rounded shadow-sm"
            />
          </div>
        </section>

        {/* 2. HEIC Image Receipt Card */}
        <section className="bg-gray-600 rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold bg-gray-600 mb-4">Mobile Image Capture (.heic)</h2>
          {/* We added min-h-[200px] and items-center here so the "Converting..." text sits nicely in the middle */}
          <div className="flex justify-center items-center bg-gray-800 rounded-lg p-4 border border-gray-200 min-h-50">            
=======
      {/* SIDEBAR: Converted to a slide-out drawer on mobile, fixed left column on desktop */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-zinc-950 border-r border-zinc-800 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
          <h1 className="text-xl font-bold tracking-tight text-white">Ledger</h1>
          {/* Mobile Close Button */}
          <button 
            className="md:hidden text-zinc-400 hover:text-white transition-colors"
            onClick={() => setIsSidebarOpen(false)}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>
        
        <div className="p-4 flex-1 overflow-y-auto">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">Past Months</h2>
          
          <div className="mb-2">
            <button 
              onClick={() => setIs2026Open(!is2026Open)}
              className="w-full flex justify-between items-center text-left font-medium text-zinc-400 hover:text-white py-2 transition-colors"
            >
              <span>2026</span>
              <span className="text-xs">{is2026Open ? "▼" : "▶"}</span>
            </button>
            
            {is2026Open && (
              <ul className="ml-4 mt-2 space-y-2 border-l-2 border-zinc-800 pl-4">
                <li><button className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors">August</button></li>
                <li><button className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors">July</button></li>
                <li><button className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors">June</button></li>
              </ul>
            )}
          </div>

          <div className="mb-2">
            <button className="w-full flex justify-between items-center text-left font-medium text-zinc-400 hover:text-white py-2 transition-colors">
              <span>2025</span>
              <span className="text-xs">▶</span>
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col overflow-y-auto w-full">
        
        {/* Header: Date & Countdown */}
        <header className="p-6 md:p-8 pb-4">
          
          {/* Mobile Top Bar (Hamburger Menu) */}
          <div className="flex items-center mb-6 md:hidden">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 -ml-2 mr-3 text-zinc-400 hover:text-white focus:bg-zinc-800 rounded-lg transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
            </button>
            <h1 className="text-lg font-bold text-white tracking-tight">Reflex Ledger</h1>
          </div>

          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6 sm:gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-400 mb-1">Current Workspace</p>
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white">{formattedDate}</h2>
            </div>
>>>>>>> ui-examples
            
            <div className="w-full sm:w-auto flex sm:block items-center justify-between bg-red-950/30 border border-red-900/50 px-4 py-3 sm:py-2 rounded-lg sm:text-right backdrop-blur-sm">
              <span className="text-xs sm:block font-medium text-red-500/80 uppercase tracking-wide order-2 sm:order-1 sm:mt-1">Days to EOM Close</span>
              <span className="block text-2xl font-bold text-red-400 leading-none order-1 sm:order-2">{daysRemaining}</span>
            </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="p-6 md:p-8 pt-4 md:pt-8 max-w-5xl space-y-6 md:space-y-8">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            
            {/* Receipts Dropzone */}
            <div className="border-2 border-dashed border-zinc-700 rounded-xl bg-zinc-800/30 p-6 md:p-8 text-center hover:bg-zinc-800 hover:border-zinc-500 transition-all cursor-pointer group">
              <div className="mx-auto w-12 h-12 bg-zinc-800 rounded-full flex items-center justify-center mb-4 group-hover:bg-zinc-700 border border-transparent group-hover:border-zinc-600 transition-all">
                <svg className="w-6 h-6 text-zinc-400 group-hover:text-zinc-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-1">Upload Receipts</h3>
              <p className="text-sm text-zinc-400">Drag & drop or click to browse</p>
              <p className="text-xs text-zinc-500 mt-4 font-mono">Accepts: .png, .jpg, .heic, .pdf, .html</p>
            </div>

            {/* Bank Statements Dropzone */}
            <div className="border-2 border-dashed border-zinc-700 rounded-xl bg-zinc-800/30 p-6 md:p-8 text-center hover:bg-zinc-800 hover:border-zinc-500 transition-all cursor-pointer group">
              <div className="mx-auto w-12 h-12 bg-zinc-800 rounded-full flex items-center justify-center mb-4 group-hover:bg-zinc-700 border border-transparent group-hover:border-zinc-600 transition-all">
                <svg className="w-6 h-6 text-zinc-400 group-hover:text-zinc-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-1">Upload Bank Exports</h3>
              <p className="text-sm text-zinc-400">Drag & drop or click to browse</p>
              <p className="text-xs text-zinc-500 mt-4 font-mono">Accepts: CSV and OFX formats only</p>
            </div>

          </div>

          <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-6 flex flex-col lg:flex-row items-start lg:items-center justify-between shadow-lg gap-6">
            <div>
              <h3 className="text-lg font-semibold text-white">Ready to Process?</h3>
              <p className="text-zinc-400 text-sm mt-1">This will auto-match receipts to statements. It is recommended to do this on the last day of every month.</p>
            </div>
            <button className="bg-zinc-100 text-zinc-900 px-8 py-3 rounded-lg font-semibold shadow-sm hover:bg-white transition-colors focus:ring-4 focus:ring-zinc-700 w-full lg:w-auto shrink-0">
              Run Reconciliation
            </button>
          </div>

        </div>
      </main>
    </div>
  );
}