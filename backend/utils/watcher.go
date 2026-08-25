package utils

import (
	"log"
	"os"
	"path/filepath"
	"reflex-tech-bookkeeping-app-api/constants"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

var (
	timers = make(map[string]*time.Timer)
	mu     sync.Mutex // Mutex ensures the map is safe for concurrent access
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
		}

		mu.Lock()
		delete(timers, filePath)
		mu.Unlock()
	})
}

// Watcher listens for new files in documents/inbox/ and passes them to debounceEvent.
func Watcher() error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}

	// Start a new goroutine (background thread) so the watcher runs indefinitely
	// without blocking the rest of the application.
	go func() {
		// An infinite loop to continuously listen for events.
		for {
			// It waits here and blocks the loop until it receives a message from one of the channels.
			select {

			// 1. If we receive a message on the watcher.Events channel:
			case event, ok := <-watcher.Events:
				// If `ok` is false, it means the channel was closed. We should exit the thread.
				if !ok {
					return
				}

				log.Println("event:", event)

				// We only care if a file was newly created or written to.
				// (We ignore things like fsnotify.Remove or fsnotify.Chmod)
				if event.Has(fsnotify.Create) || event.Has(fsnotify.Write) {
					if !isIgnoredFile(event.Name) {
						debouceEvent(event.Name, 2*time.Second)
					}
				}

			// 2. If we receive a message on the watcher.Errors channel:
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				log.Println("error:", err)
			}
		}
	}()

	// Tell the watcher which specific directory to monitor
	err = watcher.Add(constants.InboxPath)
	if err != nil {
		return err
	}

	return nil
}

// Create documents/inbox/ and documents/processed/ folders if they do not already exist.
func CreateDirsIfNotExists() error {

	if err := os.MkdirAll(constants.InboxPath, 0755); err != nil {
		return err
	}
	if err := os.MkdirAll(constants.ProcessedPath, 0755); err != nil {
		return err
	}
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
