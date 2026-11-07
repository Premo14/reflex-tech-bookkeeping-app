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
)

// isIgnoredFile returns true if the file is a Syncthing temporary file or metadata file.
func isIgnoredFile(filename string) bool {
	base := filepath.Base(filename)
	if strings.HasPrefix(base, ".syncthing.") {
		return true
	}
	if strings.HasPrefix(base, ".st") {
		return true
	}
	if strings.HasPrefix(base, ".") {
		return true
	}
	return false
}

// debounceEvent delays processing until a file is fully written to disk.
// it resets the timer on every write event.
func debouceEvent(filePath string, delay time.Duration) {
	mu.Lock()
	defer mu.Unlock()

	// If there is already a timer running for this file, stop it
	if t, exists := timers[filePath]; exists {
		t.Stop()
	}

	// Create a new timer that will fire after the delay
	timers[filePath] = time.AfterFunc(delay, func() {
		// run after file has stopped changing
		log.Println("File finished writing, ready to convert:", filePath)

		if err := processFile(filePath); err != nil {
			log.Println("Error processing file:", err)
		} else {
			events.Broadcast("TRANSACTIONS_UPDATED", nil)
			events.Broadcast("EXPENSES_UPDATED", nil)
			events.Broadcast("QUEUE_UPDATED", nil)
			events.Broadcast("ACCOUNTS_UPDATED", nil)
		}

		mu.Lock()
		delete(timers, filePath)
		mu.Unlock()
	})
}

// runWatcherLoop listens for events until stopCh is closed or watcher is closed.
func runWatcherLoop(w *fsnotify.Watcher, stopCh chan struct{}) {
	for {
		select {
		case <-stopCh:
			log.Println("Stopping watcher loop for previous directory.")
			return

		case event, ok := <-w.Events:
			if !ok {
				return
			}
			log.Println("file watcher event:", event)

			if event.Has(fsnotify.Create) || event.Has(fsnotify.Write) {
				if !isIgnoredFile(event.Name) {
					debouceEvent(event.Name, 2*time.Second)
				}
			}

		case err, ok := <-w.Errors:
			if !ok {
				return
			}
			log.Println("watcher error:", err)
		}
	}
}

// RestartWatcher dynamically stops any active watcher and binds to the current constants.GetInboxPath().
func RestartWatcher() error {
	watcherLock.Lock()
	defer watcherLock.Unlock()

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
	go runWatcherLoop(w, stopCh)

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
