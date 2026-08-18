interface HeaderProps {
  setIsSidebarOpen: (isOpen: boolean) => void;
}

// header displays the current date and eom countdown
export default function Header({ setIsSidebarOpen }: HeaderProps) {
  // date and countdown
  const today = new Date();
  const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const daysRemaining = lastDayOfMonth.getDate() - today.getDate();
  
  const formattedDate = today.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  return (
    <header className="p-6 md:p-8 pb-4">
      
      {/* Mobile Top Bar (Hamburger Menu) */}
      <div className="flex items-center mb-6 md:hidden">
        <button 
          onClick={() => setIsSidebarOpen(true)}
          className="p-2 -ml-2 mr-3 text-zinc-400 hover:text-white focus:bg-zinc-800 rounded-lg transition-colors"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
        </button>
        <h1 className="text-lg font-bold text-white tracking-tight">Ledger</h1>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6 sm:gap-4">
        <div>
          <p className="text-sm font-medium text-zinc-400 mb-1">Current Workspace</p>
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white">{formattedDate}</h2>
        </div>
        
        <div className="w-full sm:w-auto flex sm:block items-center justify-between bg-red-950/30 border border-red-900/50 px-4 py-3 sm:py-2 rounded-lg sm:text-right backdrop-blur-sm">
          <span className="text-xs sm:block font-medium text-red-500/80 uppercase tracking-wide order-2 sm:order-1 sm:mt-1">Days to EOM Close</span>
          <span className="block text-2xl font-bold text-red-400 leading-none order-1 sm:order-2">{daysRemaining}</span>
        </div>
      </div>
    </header>
  );
}
