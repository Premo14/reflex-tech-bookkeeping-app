package constants

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
)

var (
	pathMu              sync.RWMutex
	currentHostPath     string
	currentContainerDir string
)

func init() {
	// Set umask to 0 so all created dirs and files have wide-open 0777/0666 permissions
	syscall.Umask(0)

	currentContainerDir = "/app/documents"
	currentHostPath = os.Getenv("DOCUMENT_DATA_PATH")
	if currentHostPath == "" {
		currentHostPath = "./document-data"
	} else {
		currentHostPath = NormalizeDropboxHostPath(currentHostPath)
		currentContainerDir = ResolveHostToContainer(currentHostPath)
	}
}

// NormalizeDropboxHostPath ensures that the folder name is ALWAYS "document-data".
// If the user supplies a parent path like "/home/user/Desktop", it appends "document-data".
func NormalizeDropboxHostPath(hostPath string) string {
	cleaned := filepath.Clean(strings.TrimSpace(hostPath))
	if cleaned == "" || cleaned == "." || cleaned == "./document-data" || cleaned == "document-data" {
		return "./document-data"
	}

	// Expand ~/ to host user home if running in container
	if strings.HasPrefix(cleaned, "~") {
		entries, err := os.ReadDir("/host_fs/home")
		if err == nil && len(entries) > 0 {
			for _, e := range entries {
				if e.IsDir() {
					cleaned = filepath.Join("/home", e.Name(), strings.TrimPrefix(cleaned, "~"))
					break
				}
			}
		}
	}

	// If user enters without leading slash e.g. "home/premo/...", prepend "/"
	if strings.HasPrefix(cleaned, "home/") {
		cleaned = "/" + cleaned
	}

	// If the path does not end with "document-data", append it
	if filepath.Base(cleaned) != "document-data" {
		cleaned = filepath.Join(cleaned, "document-data")
	}
	return cleaned
}

// ResolveHostToContainer maps a host path to its container-accessible path.
// When Docker mounts / to /host_fs, host path /home/user/x maps to /host_fs/home/user/x.
func ResolveHostToContainer(hostPath string) string {
	cleaned := filepath.Clean(strings.TrimSpace(hostPath))
	if cleaned == "" || cleaned == "." || cleaned == "./document-data" || cleaned == "document-data" {
		return "/app/documents"
	}

	// If already an internal container path
	if strings.HasPrefix(cleaned, "/app/documents") || strings.HasPrefix(cleaned, "/host_fs") {
		return cleaned
	}

	// Check if running inside container with /host_fs mount
	if fi, err := os.Stat("/host_fs"); err == nil && fi.IsDir() {
		return filepath.Join("/host_fs", cleaned)
	}

	// Outside container / local dev
	return cleaned
}

// copyFile copies a single file and ensures 0666 permissions
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0666)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return os.Chmod(dst, 0666)
}

// copyDir recursively copies a directory and its contents
func copyDir(src, dst string) error {
	if err := os.MkdirAll(dst, 0777); err != nil {
		return err
	}
	_ = os.Chmod(dst, 0777)

	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())

		if entry.IsDir() {
			if err := copyDir(srcPath, dstPath); err != nil {
				return err
			}
		} else {
			if err := copyFile(srcPath, dstPath); err != nil {
				return err
			}
		}
	}
	return nil
}

// moveDirectory moves a directory from src to dst.
// It first attempts an atomic os.Rename. If that fails (e.g. cross-device EXDEV),
// it recursively copies all files, verifies, and removes the old directory.
func moveDirectory(src, dst string) error {
	if src == dst {
		return nil
	}

	srcFi, srcErr := os.Stat(src)
	if srcErr != nil {
		// If source doesn't exist, nothing to move
		return nil
	}

	dstFi, dstErr := os.Stat(dst)
	if dstErr == nil && os.SameFile(srcFi, dstFi) {
		log.Printf("Source %s and destination %s are the same physical directory; skipping move.\n", src, dst)
		return nil
	}

	// Verify parent directory of dst exists (do not create arbitrary non-existent parent paths)
	dstParent := filepath.Dir(dst)
	if fi, err := os.Stat(dstParent); err != nil || !fi.IsDir() {
		return fmt.Errorf("destination parent directory %s does not exist on your computer", dstParent)
	}
	_ = os.Chmod(dstParent, 0777)

	// Try atomic rename first
	if err := os.Rename(src, dst); err == nil {
		log.Printf("Successfully moved folder atomically from %s to %s\n", src, dst)
		return nil
	}

	// If rename failed (cross-device move or target already exists), copy recursively
	log.Printf("Atomic rename failed, performing recursive copy from %s to %s\n", src, dst)
	if err := copyDir(src, dst); err != nil {
		return fmt.Errorf("failed to copy files to new destination: %w", err)
	}

	// Remove old directory after successful copy
	if src != "/app/documents" {
		if err := os.RemoveAll(src); err != nil {
			log.Printf("Warning: failed to remove old directory %s after copy: %v\n", src, err)
		}
	} else {
		// If src is the /app/documents mount point, clear its contents without trying to unlink the mount point itself
		entries, _ := os.ReadDir(src)
		for _, e := range entries {
			_ = os.RemoveAll(filepath.Join(src, e.Name()))
		}
	}

	return nil
}

// MoveDropboxLocation moves the entire existing "document-data" folder and all its child
// items to the new host path, ensuring "document-data" is preserved as the folder name.
func MoveDropboxLocation(newHostPath string) (containerPath string, err error) {
	pathMu.Lock()
	defer pathMu.Unlock()

	normalizedNewHost := NormalizeDropboxHostPath(newHostPath)
	targetContainer := ResolveHostToContainer(normalizedNewHost)
	oldContainer := currentContainerDir

	// Verify that the parent directory of document-data actually exists on the host computer!
	// We do NOT create missing parent folders (e.g. if user types /home/premo/test/ but test does not exist).
	if normalizedNewHost != "./document-data" {
		parentHost := filepath.Dir(normalizedNewHost)
		parentContainer := ResolveHostToContainer(parentHost)

		fi, err := os.Stat(parentContainer)
		if err != nil || !fi.IsDir() {
			return "", fmt.Errorf("parent directory '%s' does not exist on your computer. Please select an existing folder", parentHost)
		}
	}

	syscall.Umask(0)

	// If source directory exists and is different from target, move it!
	if oldContainer != targetContainer {
		if fi, err := os.Stat(oldContainer); err == nil && fi.IsDir() {
			log.Printf("Moving document-data folder from %s to %s\n", oldContainer, targetContainer)
			if err := moveDirectory(oldContainer, targetContainer); err != nil {
				return "", fmt.Errorf("failed to move document-data folder: %w", err)
			}
		}
	}

	// Ensure target subdirectories exist with 0777 permissions
	inbox := filepath.Join(targetContainer, "inbox")
	processed := filepath.Join(targetContainer, "processed")

	if err := os.MkdirAll(inbox, 0777); err != nil {
		return "", fmt.Errorf("failed to create inbox directory at %s: %w", inbox, err)
	}
	_ = os.Chmod(inbox, 0777)

	if err := os.MkdirAll(processed, 0777); err != nil {
		return "", fmt.Errorf("failed to create processed directory at %s: %w", processed, err)
	}
	_ = os.Chmod(processed, 0777)
	_ = os.Chmod(targetContainer, 0777)

	// Verify write access
	testFile := filepath.Join(inbox, ".write_test")
	if err := os.WriteFile(testFile, []byte("ok"), 0666); err != nil {
		return "", fmt.Errorf("directory %s is not writable: %w", inbox, err)
	}
	_ = os.Remove(testFile)

	currentHostPath = normalizedNewHost
	currentContainerDir = targetContainer
	return targetContainer, nil
}

// SetDropboxLocation sets the active dropbox location without moving files (used on startup).
func SetDropboxLocation(hostPath string) (containerPath string, err error) {
	pathMu.Lock()
	defer pathMu.Unlock()

	normalized := NormalizeDropboxHostPath(hostPath)
	targetContainer := ResolveHostToContainer(normalized)

	inbox := filepath.Join(targetContainer, "inbox")
	processed := filepath.Join(targetContainer, "processed")

	syscall.Umask(0)

	if err := os.MkdirAll(inbox, 0777); err != nil {
		return "", fmt.Errorf("failed to create inbox directory at %s: %w", inbox, err)
	}
	_ = os.Chmod(inbox, 0777)

	if err := os.MkdirAll(processed, 0777); err != nil {
		return "", fmt.Errorf("failed to create processed directory at %s: %w", processed, err)
	}
	_ = os.Chmod(processed, 0777)
	_ = os.Chmod(targetContainer, 0777)

	testFile := filepath.Join(inbox, ".write_test")
	if err := os.WriteFile(testFile, []byte("ok"), 0666); err != nil {
		return "", fmt.Errorf("directory %s is not writable: %w", inbox, err)
	}
	_ = os.Remove(testFile)

	currentHostPath = normalized
	currentContainerDir = targetContainer
	return targetContainer, nil
}

func GetCurrentHostPath() string {
	pathMu.RLock()
	defer pathMu.RUnlock()
	return currentHostPath
}

func GetCurrentContainerDir() string {
	pathMu.RLock()
	defer pathMu.RUnlock()
	return currentContainerDir
}

func GetInboxPath() string {
	pathMu.RLock()
	defer pathMu.RUnlock()
	return filepath.Join(currentContainerDir, "inbox")
}

func GetProcessedPath() string {
	pathMu.RLock()
	defer pathMu.RUnlock()
	return filepath.Join(currentContainerDir, "processed")
}
