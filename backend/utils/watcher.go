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
debouceEvent() creates a delay to ensure heic files are completely
downloaded to disk before performing processing them.
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
fsnotify is utilized to watch the documents/inbox/ folder for events
e.g. adding a new file to the folder
*/
func Watcher() error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}

	go func() {
		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				log.Println("event:", event)
				if event.Has(fsnotify.Create) || event.Has(fsnotify.Write) {
					debouceEvent(event.Name, 2*time.Second)

					// log.Println("modified file:", event.Name) // debug only
				}
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				log.Println("error:", err)
			}
		}
	}()

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
fsnotify is event-driven, if files are already in the inbox/ folder
on startup it will not process those files.
This function processes the documents/inbox/ folder on startup in case
files already exist in inbox/ after a crash or reset.
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
