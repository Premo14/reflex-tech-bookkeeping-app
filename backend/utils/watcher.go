package utils

import (
	"log"
	"os"
	"path/filepath"
	"reflex-tech-bookkeeping-app-api/constants"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

var (
	timers = make(map[string]*time.Timer)
	mu     sync.Mutex // Mutex ensures the map is safe for concurrent access
)

/*
debounceEvent ensures we don't try to process a file while it is still actively downloading or being written to disk.
When a file is created or written to, the OS fires many rapid events. This function creates a "delay" timer.
If another event fires for the same file, it resets the timer. The file is only processed once the timer
finally expires (meaning the file has stopped changing and is safe to read).
*/
func debouceEvent(filePath string, delay time.Duration) {
	mu.Lock()
	defer mu.Unlock()

	// If there is already a timer running for this file, stop it
	if t, exists := timers[filePath]; exists {
		t.Stop()
	}

	// Create a new timer that will fire after the delay
	timers[filePath] = time.AfterFunc(delay, func() {
		// --- THIS CODE RUNS AFTER THE FILE HAS STOPPED CHANGING ---
		log.Println("File finished writing, ready to convert:", filePath)

		if err := processFile(filePath); err != nil {
			log.Println("Error processing file:", err)
		}

		mu.Lock()
		delete(timers, filePath)
		mu.Unlock()
	})
}

/*
Watcher initializes the fsnotify file watcher to monitor the documents/inbox/ folder.
It listens for Create or Write events and passes the files to the debounceEvent function.
This allows the app to respond to newly dropped OFX or image files in real-time.
*/
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
					debouceEvent(event.Name, 2*time.Second)
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

/*
ProcessExistingFiles sweeps the documents/inbox/ folder on server startup.
Because the fsnotify watcher is strictly event-driven, it will miss any files that were dropped into the inbox
while the server was offline or restarting. This function acts as a safety net to process that backlog.
*/
func ProcessExistingFiles(inboxPath string) error {
	contents, err := os.ReadDir(inboxPath)
	if err != nil {
		return err
	}

	for _, content := range contents {
		if err := processFile(filepath.Join(inboxPath, content.Name())); err != nil {
			log.Println("Error processing existing file:", err)
		}
	}

	return nil
}
