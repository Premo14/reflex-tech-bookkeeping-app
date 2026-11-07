import { useState, useEffect } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Input } from "./ui/Input";
import { updateSettings, browseHostDirectories } from "../services/api";

interface AppSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Record<string, string>;
  refreshSettings: () => void;
}

export default function AppSettingsModal({ isOpen, onClose, settings, refreshSettings }: AppSettingsModalProps) {
  const currentPath = settings["DocumentDropboxPath"] || "./document-data";
  const [folderPath, setFolderPath] = useState(currentPath);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Host folder browser state
  const [showBrowser, setShowBrowser] = useState(false);
  const [browserPath, setBrowserPath] = useState("/home/premo");
  const [browserParent, setBrowserParent] = useState("");
  const [browserDirs, setBrowserDirs] = useState<string[]>([]);
  const [isLoadingDirs, setIsLoadingDirs] = useState(false);

  const getNormalizedTarget = (input: string) => {
    let trimmed = input.trim().replace(/\/+$/, '');
    if (!trimmed || trimmed === '.' || trimmed === './document-data' || trimmed === 'document-data') {
      return './document-data';
    }
    if (trimmed.startsWith('~')) {
      trimmed = trimmed.replace(/^~/, '/home/premo');
    }
    if (trimmed.startsWith('home/')) {
      trimmed = '/' + trimmed;
    }
    if (trimmed.endsWith('/document-data')) {
      return trimmed;
    }
    return `${trimmed}/document-data`;
  };

  const normalizedTarget = getNormalizedTarget(folderPath);
  const normalizedCurrent = getNormalizedTarget(currentPath);
  const isChanged = normalizedTarget !== normalizedCurrent;

  useEffect(() => {
    if (isOpen) {
      setFolderPath(settings["DocumentDropboxPath"] || "./document-data");
      setStatusMessage(null);
      setShowBrowser(false);
    }
  }, [isOpen, settings]);

  const handleOpenBrowser = async (startPath?: string) => {
    const p = startPath || (folderPath.startsWith('/') || folderPath.startsWith('home/') ? folderPath.replace(/\/document-data$/, '') : '/home/premo');
    setShowBrowser(true);
    await navigateBrowser(p);
  };

  const navigateBrowser = async (path: string) => {
    setIsLoadingDirs(true);
    try {
      const res = await browseHostDirectories(path);
      setBrowserPath(res.currentPath);
      setBrowserParent(res.parentPath);
      setBrowserDirs(res.directories || []);
    } catch {
      // Fallback to /home/premo
      try {
        const fallback = await browseHostDirectories('/home/premo');
        setBrowserPath(fallback.currentPath);
        setBrowserParent(fallback.parentPath);
        setBrowserDirs(fallback.directories || []);
      } catch {
        setBrowserDirs([]);
      }
    } finally {
      setIsLoadingDirs(false);
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!folderPath.trim()) {
      setStatusMessage({ type: 'error', text: 'Folder path cannot be empty.' });
      return;
    }

    setIsSaving(true);
    setStatusMessage(null);

    try {
      await updateSettings("DocumentDropboxPath", folderPath.trim());
      setStatusMessage({
        type: 'success',
        text: `Successfully moved document-data to ${normalizedTarget}! All child files preserved, permissions set to 0777.`
      });
      refreshSettings();
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'Failed to update dropbox location.'
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetDefault = () => {
    setFolderPath("./document-data");
    setShowBrowser(false);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="font-bold text-white">Application Settings</span>
        </div>
      }
      maxWidth="xl"
      bodyClassName="p-5 overflow-y-auto flex-1 min-h-0 custom-scrollbar"
      footer={
        <div className="flex justify-end w-full gap-2.5">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={isSaving || !isChanged}
          >
            {isSaving ? "Moving Folder..." : isChanged ? "Move Folder & Connect" : "Location Connected"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Document Intake & Storage Card */}
        <div className="p-4 rounded-xl bg-zinc-950 border border-white/10 space-y-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
              Document Intake & Dropbox Directory
            </span>
            <Badge variant="success">24/7 Daemon Active</Badge>
          </div>

          <p className="text-xs text-zinc-400 leading-relaxed">
            Specify where the <span className="font-mono text-emerald-400 font-semibold">document-data</span> folder lives on your computer. When you change this path, the entire folder and all its child files will be safely moved.
          </p>

          <form onSubmit={handleSave} className="space-y-2.5">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest pl-0.5">
                Host Path / Parent Directory
              </label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder="/home/premo/Desktop"
                  className="font-mono text-xs flex-1 break-all"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => handleOpenBrowser()}
                  className="shrink-0 flex items-center gap-1.5 px-3! text-xs font-semibold"
                >
                  <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  Browse...
                </Button>
              </div>
            </div>

            {/* Host Directory Browser Drawer */}
            {showBrowser && (
              <div className="p-3.5 rounded-xl bg-zinc-900 border border-emerald-500/30 space-y-3 animate-in fade-in zoom-in-95 duration-150">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span className="text-xs font-bold text-white uppercase tracking-wider">Host Folder Browser</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowBrowser(false)}
                    className="text-zinc-500 hover:text-white text-xs p-1"
                  >
                    ✕ Close
                  </button>
                </div>

                {/* Quick shortcuts */}
                <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                  <span className="text-zinc-500 text-[10px] uppercase font-bold pr-1">Jump to:</span>
                  <button
                    type="button"
                    onClick={() => navigateBrowser('/home/premo/Desktop')}
                    className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                  >
                    Desktop
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateBrowser('/home/premo/Documents')}
                    className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                  >
                    Documents
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateBrowser('/home/premo/Downloads')}
                    className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                  >
                    Downloads
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateBrowser('/home/premo')}
                    className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                  >
                    Home (~)
                  </button>
                </div>

                {/* Current path bar */}
                <div className="flex items-center gap-2 p-2 rounded bg-black/60 border border-white/5 font-mono text-xs text-zinc-300 break-all">
                  <span className="text-zinc-500 select-none">📁</span>
                  <span className="text-white font-semibold flex-1">{browserPath}</span>
                  {browserParent && (
                    <button
                      type="button"
                      onClick={() => navigateBrowser(browserParent)}
                      className="px-2 py-0.5 text-[11px] rounded bg-white/10 hover:bg-white/20 text-zinc-300 shrink-0"
                    >
                      ⬆ Up
                    </button>
                  )}
                </div>

                {/* Directory items list */}
                <div className="max-h-48 overflow-y-auto custom-scrollbar border border-white/5 rounded-lg bg-black/30 divide-y divide-white/5">
                  {isLoadingDirs ? (
                    <div className="p-4 text-center text-xs text-zinc-500">Loading directories...</div>
                  ) : browserDirs.length === 0 ? (
                    <div className="p-4 text-center text-xs text-zinc-500">No subfolders in this directory</div>
                  ) : (
                    browserDirs.map((dir) => (
                      <button
                        key={dir}
                        type="button"
                        onClick={() => navigateBrowser(`${browserPath.replace(/\/+$/, '')}/${dir}`)}
                        className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-emerald-500/10 hover:text-emerald-400 transition-colors flex items-center justify-between group"
                      >
                        <span className="flex items-center gap-2 font-mono">
                          <span className="text-amber-400/80">📁</span>
                          <span>{dir}</span>
                        </span>
                        <span className="text-[10px] text-zinc-500 group-hover:text-emerald-400">Open ➔</span>
                      </button>
                    ))
                  )}
                </div>

                {/* Select folder button */}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-zinc-400">
                    Will create <span className="font-mono text-emerald-400 font-semibold">document-data</span> in this folder
                  </span>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setFolderPath(browserPath);
                      setShowBrowser(false);
                    }}
                  >
                    Select This Folder
                  </Button>
                </div>
              </div>
            )}

            {/* Target Folder Preview (Dedicated separate lines) */}
            <div className="flex flex-col gap-2 p-3 rounded-lg bg-zinc-900 border border-white/5 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">Folder Name:</span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono text-[11px] font-semibold">
                  document-data
                </span>
                <span className="text-zinc-500 text-[10px]">(permanently fixed)</span>
              </div>
              <div className="pt-2 border-t border-white/5 flex flex-col gap-1">
                <span className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">
                  Target Destination Path:
                </span>
                <div className="font-mono text-xs text-emerald-300 font-semibold break-all bg-black/50 px-3 py-2 rounded-lg border border-white/5 select-all">
                  {normalizedTarget}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-0.5">
              <button
                type="button"
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors underline cursor-pointer"
                onClick={handleResetDefault}
              >
                Reset to default (./document-data)
              </button>
            </div>
          </form>

          {statusMessage && (
            <div
              className={`p-2.5 rounded-lg text-xs leading-relaxed break-words ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
                  : 'bg-red-500/10 border border-red-500/20 text-red-300'
              }`}
            >
              {statusMessage.text}
            </div>
          )}

          {/* Subdirectories Preview (Non-redundant, explains layout) */}
          <div className="grid grid-cols-2 gap-2.5 pt-0.5">
            <div className="p-2.5 bg-zinc-900 border border-white/5 rounded-lg space-y-1">
              <span className="block text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                📥 Incoming Folder
              </span>
              <p className="font-mono text-xs text-zinc-200">
                /inbox
              </p>
              <p className="text-[11px] text-zinc-500 leading-snug">
                Drop OFX, QFX, PNG, JPG, or PDF files here
              </p>
            </div>
            <div className="p-2.5 bg-zinc-900 border border-white/5 rounded-lg space-y-1">
              <span className="block text-[10px] font-bold text-blue-400 uppercase tracking-wider">
                📦 Archive Folder
              </span>
              <p className="font-mono text-xs text-zinc-200">
                /processed
              </p>
              <p className="text-[11px] text-zinc-500 leading-snug">
                Indexed vouchers & receipts stored here
              </p>
            </div>
          </div>

          {/* Frictionless Permissions Note */}
          <div className="p-2.5 bg-zinc-900/80 border border-white/5 rounded-lg flex items-start gap-2.5 text-xs text-zinc-400">
            <svg className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <div className="leading-relaxed">
              <span className="font-semibold text-zinc-200">Zero-Friction Permissions (0777): </span>
              Subfolders and documents are created with wide-open read/write access for all users, scripts, and local scanners on this machine.
            </div>
          </div>
        </div>

        {/* General Preferences Card */}
        <div className="p-3.5 rounded-xl bg-zinc-950 border border-white/10 space-y-2">
          <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
            General Preferences
          </span>
          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <div className="p-2.5 bg-zinc-900 border border-white/5 rounded-lg space-y-0.5">
              <span className="text-zinc-500 font-semibold uppercase text-[10px]">Accounting Basis</span>
              <p className="font-bold text-zinc-200">Single-Entry Cash Basis</p>
              <p className="text-zinc-500 text-[11px] leading-snug">With voucher & bank reconciliation</p>
            </div>
            <div className="p-2.5 bg-zinc-900 border border-white/5 rounded-lg space-y-0.5">
              <span className="text-zinc-500 font-semibold uppercase text-[10px]">Base Currency</span>
              <p className="font-bold text-zinc-200">USD ($)</p>
              <p className="text-zinc-500 text-[11px] leading-snug">Standard decimal precision</p>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
