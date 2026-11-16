package utils

import (
	"log"
	"os"
	"path/filepath"
	"reflex-tech-bookkeeping-app-api/constants"
	"reflex-tech-bookkeeping-app-api/events"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/fsnotify/fsnotify"
)

var (
	timers          = make(map[string]*time.Timer)
	mu              sync.Mutex // Mutex ensures the timer map is safe for concurrent access
	activeWatcher   *fsnotify.Watcher
	watcherLock     sync.Mutex
	stopWatcherChan chan struct{}

	// inFlight tracks files currently being processed to prevent concurrent processing
	inFlight   = make(map[string]bool)
	inFlightMu sync.Mutex

	// fileStabilityInterval pauses briefly between consecutive Stat calls to detect ongoing writes.
	fileStabilityInterval = 75 * time.Millisecond

	// ocrWorkerSem bounds concurrent background OCR/PDF extractions spawned by watcher debounces.
	ocrWorkerSem = make(chan struct{}, 2)
)

// isIgnoredFile returns true if the file is a Syncthing temporary, metadata, or OS junk file.
func isIgnoredFile(filename string) bool {
	base := filepath.Base(filename)
	ext := strings.ToLower(filepath.Ext(base))

	// Syncthing temp/metadata files
	if strings.HasPrefix(base, ".syncthing.") {
		return true
	}
	if strings.HasPrefix(base, ".st") {
		return true
	}
	// macOS dotfiles
	if strings.HasPrefix(base, ".") {
		return true
	}
	// Partial transfer / download extensions
	switch ext {
	case ".tmp", ".part", ".crdownload", ".partial", ".download":
		return true
	}
	// OS junk files
	switch base {
	case "Thumbs.db", "desktop.ini", "DS_Store":
		return true
	}
	return false
}

// isFileStable checks that a file is non-zero, has a consistent size across two spaced checks,
// and can be opened without error — indicating the writer has finished.
func isFileStable(path string) bool {
	fi, err := os.Stat(path)
	if err != nil || fi.Size() == 0 {
		return false
	}
	size := fi.Size()
	if fileStabilityInterval > 0 {
		time.Sleep(fileStabilityInterval)
	}
	// Second check — size must still match after pause
	fi2, err2 := os.Stat(path)
	if err2 != nil || fi2.Size() != size {
		return false
	}
	// Third check — try to open the file cleanly
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	f.Close()
	return true
}

// acquireInFlight returns true if the file is NOT already being processed.
func acquireInFlight(filePath string) bool {
	inFlightMu.Lock()
	defer inFlightMu.Unlock()
	if inFlight[filePath] {
		return false
	}
	inFlight[filePath] = true
	return true
}

// releaseInFlight removes a file from the in-flight set.
func releaseInFlight(filePath string) {
	inFlightMu.Lock()
	defer inFlightMu.Unlock()
	delete(inFlight, filePath)
}

// clearPendingTimers cancels and clears all pending debounce timers cleanly.
func clearPendingTimers() {
	mu.Lock()
	defer mu.Unlock()
	for path, t := range timers {
		t.Stop()
		delete(timers, path)
	}
}

// debounceEvent delays processing until a file is fully written to disk.
// it resets the timer on every write event, uses spaced stability checks,
// and dispatches OCR work to a bounded semaphore without blocking timer callbacks.
func debounceEvent(filePath string, delay time.Duration) {
	mu.Lock()
	defer mu.Unlock()
	if t, exists := timers[filePath]; exists {
		t.Stop()
	}

	var timer *time.Timer
	timer = time.AfterFunc(delay, func() {
		mu.Lock()
		if timers[filePath] == timer {
			delete(timers, filePath)
		}
		mu.Unlock()

		// Verify file is stable before dispatching OCR work
		if !isFileStable(filePath) {
			log.Printf("⚠️ File '%s' is not stable (may still be writing), skipping.\n", filePath)
			return
		}

		// Acquire in-flight lock to prevent concurrent processing
		if !acquireInFlight(filePath) {
			log.Printf("⚠️ File '%s' already in-flight, skipping duplicate.\n", filePath)
			return
		}

		go func() {
			ocrWorkerSem <- struct{}{}
			defer func() {
				<-ocrWorkerSem
				releaseInFlight(filePath)
			}()

			if err := processFile(filePath); err != nil {
				log.Println("Error processing file:", err)
			} else {
				events.Broadcast("TRANSACTIONS_UPDATED", nil)
				events.Broadcast("EXPENSES_UPDATED", nil)
				events.Broadcast("QUEUE_UPDATED", nil)
				events.Broadcast("ACCOUNTS_UPDATED", nil)
			}
		}()
	})
	timers[filePath] = timer
}

// runWatcherChannels listens on fsnotify event/error channels until stopCh closes or a channel closes.
// It also runs a periodic fallback sweep (every 30s) to handle missed inotify events.
func runWatcherChannels(eventsCh <-chan fsnotify.Event, errsCh <-chan error, stopCh <-chan struct{}) {
	// Start periodic fallback sweep for Docker bind-mount reliability
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-stopCh:
			log.Println("Stopping watcher loop for previous directory.")
			return

		case event, ok := <-eventsCh:
			if !ok {
				return
			}
			log.Println("file watcher event:", event)

			// Handle Create, Write, AND Rename events
			// Rename is used by Syncthing/Synctrain/macOS Finder when atomically renaming .tmp -> final file
			if event.Has(fsnotify.Create) || event.Has(fsnotify.Write) || event.Has(fsnotify.Rename) {
				if !isIgnoredFile(event.Name) {
					debounceEvent(event.Name, 2*time.Second)
				}
			}

		case err, ok := <-errsCh:
			if !ok {
				return
			}
			log.Println("watcher error:", err)

		case <-ticker.C:
			// Periodic fallback sweep for missed inotify events (Docker/macOS/Syncthing)
			inboxPath := constants.GetInboxPath()
			if err := processExistingFilesSweep(inboxPath); err != nil {
				log.Println("Periodic sweep error:", err)
			}
		}
	}
}

// runWatcherLoop wraps runWatcherChannels for an active *fsnotify.Watcher.
func runWatcherLoop(w *fsnotify.Watcher, stopCh chan struct{}) {
	runWatcherChannels(w.Events, w.Errors, stopCh)
}

// RestartWatcher dynamically stops any active watcher and binds to the current constants.GetInboxPath().
func RestartWatcher() error {
	watcherLock.Lock()
	defer watcherLock.Unlock()

	clearPendingTimers()

	// Stop existing watcher if one is running
	if activeWatcher != nil {
		if stopWatcherChan != nil {
			close(stopWatcherChan)
			stopWatcherChan = nil
		}
		activeWatcher.Close()
		activeWatcher = nil
	}

	if err := CreateDirsIfNotExists(); err != nil {
		return err
	}

	w, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}

	activeWatcher = w
	stopWatcherChan = make(chan struct{})

	inboxPath := constants.GetInboxPath()
	err = activeWatcher.Add(inboxPath)
	if err != nil {
		activeWatcher.Close()
		activeWatcher = nil
		return err
	}

	stopCh := stopWatcherChan
	go runWatcherChannels(w.Events, w.Errors, stopCh)

	log.Printf("File watcher active on inbox: %s (Host: %s)\n", inboxPath, constants.GetCurrentHostPath())

	// Process any files already waiting in the new inbox
	go func() {
		if err := ProcessExistingFiles(inboxPath); err != nil {
			log.Println("Error processing files in new inbox:", err)
		}
	}()

	return nil
}

// Watcher starts the background file watcher on the active inbox directory.
func Watcher() error {
	return RestartWatcher()
}

// CreateDirsIfNotExists creates inbox and processed folders with wide-open 0777 permissions.
func CreateDirsIfNotExists() error {
	syscall.Umask(0)

	inbox := constants.GetInboxPath()
	processed := constants.GetProcessedPath()

	if err := os.MkdirAll(inbox, 0777); err != nil {
		return err
	}
	_ = os.Chmod(inbox, 0777)

	if err := os.MkdirAll(processed, 0777); err != nil {
		return err
	}
	_ = os.Chmod(processed, 0777)

	return nil
}

// ProcessExistingFiles processes any files dropped in the inbox while the server was offline.
func ProcessExistingFiles(inboxPath string) error {
	contents, err := os.ReadDir(inboxPath)
	if err != nil {
		return err
	}

	for _, content := range contents {
		if content.IsDir() || isIgnoredFile(content.Name()) {
			continue
		}
		if err := processFile(filepath.Join(inboxPath, content.Name())); err != nil {
			log.Println("Error processing existing file:", err)
		}
	}

	return nil
}

// processExistingFilesSweep is a non-blocking periodic sweep that processes only
// files that were not already handled by fsnotify events. It broadcasts SSE updates.
func processExistingFilesSweep(inboxPath string) error {
	contents, err := os.ReadDir(inboxPath)
	if err != nil {
		return err
	}

	anyProcessed := false
	for _, content := range contents {
		if content.IsDir() || isIgnoredFile(content.Name()) {
			continue
		}
		filePath := filepath.Join(inboxPath, content.Name())

		// Skip files already in-flight (being handled by a debounced fsnotify event)
		inFlightMu.Lock()
		if inFlight[filePath] {
			inFlightMu.Unlock()
			continue
		}
		inFlightMu.Unlock()

		// Skip files that are not stable yet
		if !isFileStable(filePath) {
			continue
		}

		// Try to acquire in-flight lock
		if !acquireInFlight(filePath) {
			continue
		}

		if err := processFile(filePath); err != nil {
			log.Printf("⚠️ Periodic sweep failed on %s: %v\n", filePath, err)
		} else {
			anyProcessed = true
		}
		releaseInFlight(filePath)
	}

	if anyProcessed {
		events.Broadcast("TRANSACTIONS_UPDATED", nil)
		events.Broadcast("EXPENSES_UPDATED", nil)
		events.Broadcast("QUEUE_UPDATED", nil)
		events.Broadcast("ACCOUNTS_UPDATED", nil)
	}

	return nil
}
