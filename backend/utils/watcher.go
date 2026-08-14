package utils

import (
	"log"
	"os"
	"path/filepath"
	"strings"
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

		outputPath, err := ConvertHeicToPng(filePath)
		if err != nil {
			log.Println("Error Converting HEIC image to PNG:", err)
		} else {
			log.Println("Conversion succeeded, PNG at:", outputPath)
			// Safe to delete the original now
			if err := os.Remove(filePath); err != nil {
				log.Println("Failed to delete original HEIC:", err)
			}
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
					if strings.ToLower(filepath.Ext(event.Name)) == ".heic" {
						debouceEvent(event.Name, 2*time.Second)
					}
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

	inboxPath := "/app/documents/inbox" // TODO: create a const file for constant vars
	err = watcher.Add(inboxPath)
	if err != nil {
		return err
	}

	return nil
}

// Create documents/inbox/ folder(s) if they do not already exist.
func CreateDirIfNotExists() error {
	path := "/app/documents/inbox"

	if err := os.MkdirAll(path, 0755); err != nil {
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
		if !content.IsDir() && strings.ToLower(filepath.Ext(content.Name())) == ".heic" {
			filePath := filepath.Join(inboxPath, content.Name())
			outputPath, err := ConvertHeicToPng(filePath)
			if err != nil {
				log.Println("Error Converting HEIC image to PNG:", err)
			} else {
				log.Println("Conversion succeeded, PNG at:", outputPath)
				// Safe to delete the original now
				if err = os.Remove(filePath); err != nil {
					log.Println("Failed to delete original HEIC:", err)
				}
			}
		}
	}

	return nil
}
