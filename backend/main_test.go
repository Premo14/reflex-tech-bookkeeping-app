package main

import (
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"reflex-tech-bookkeeping-app-api/constants"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"

	"github.com/gofiber/fiber/v3"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func setupMainTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatalf("failed to open sqlite: %v", err)
	}
	if err := database.AutoMigrate(&models.AppSetting{}, &models.Invoice{}, &models.BankTransaction{}, &models.Expense{}, &models.ExpenseBankTransaction{}, &models.ChartAccount{}); err != nil {
		t.Fatalf("failed automigrate: %v", err)
	}
	db.DB = database
	return database
}

func TestStartBackgroundSweep(t *testing.T) {
	setupMainTestDB(t)
	stopCh := make(chan struct{})
	done := make(chan struct{})

	go func() {
		startBackgroundSweep(stopCh, 5*time.Millisecond)
		close(done)
	}()

	time.Sleep(15 * time.Millisecond)
	close(stopCh)

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("startBackgroundSweep did not exit after stopCh closed")
	}
}

func TestInitDropboxLocation(t *testing.T) {
	database := setupMainTestDB(t)
	tmpDir := t.TempDir()
	docDir := filepath.Join(tmpDir, "document-data")

	// 1. From DB setting (valid)
	database.Create(&models.AppSetting{Key: "DocumentDropboxPath", Value: docDir})
	initDropboxLocation()
	if got := constants.GetProcessedPath(); got == "" {
		t.Fatal("expected processed path to be initialized")
	}

	// 2. From DB setting (invalid / read-only file blocking directory creation)
	badFile := filepath.Join(tmpDir, "blocker-file")
	_ = os.WriteFile(badFile, []byte("x"), 0600)
	database.Model(&models.AppSetting{}).Where("key = ?", "DocumentDropboxPath").Update("value", filepath.Join(badFile, "document-data"))
	initDropboxLocation()

	// 3. Fallback to DOCUMENT_DATA_PATH env var when DB setting is empty
	database.Where("key = ?", "DocumentDropboxPath").Delete(&models.AppSetting{})
	envDir := filepath.Join(tmpDir, "env-docs", "document-data")
	_ = os.MkdirAll(filepath.Dir(envDir), 0755)
	t.Setenv("DOCUMENT_DATA_PATH", envDir)
	initDropboxLocation()

	// 4. Invalid DOCUMENT_DATA_PATH env var logs warning without panicking
	t.Setenv("DOCUMENT_DATA_PATH", filepath.Join(badFile, "document-data"))
	initDropboxLocation()
}

func TestNewApp_ImagesRouteAndTraversalGuard(t *testing.T) {
	setupMainTestDB(t)
	tmpDir := t.TempDir()
	docDir := filepath.Join(tmpDir, "document-data")
	if _, err := constants.SetDropboxLocation(docDir); err != nil {
		t.Fatalf("SetDropboxLocation failed: %v", err)
	}

	processedDir := constants.GetProcessedPath()
	sampleImg := filepath.Join(processedDir, "receipt1.png")
	if err := os.WriteFile(sampleImg, []byte("PNGDATA"), 0644); err != nil {
		t.Fatalf("failed writing sample image: %v", err)
	}

	app := newApp()

	// Valid image inside processed/
	req := httptest.NewRequest("GET", "/api/images/receipt1.png", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("GET /api/images/receipt1.png failed: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("expected 200 for valid receipt image, got %d", resp.StatusCode)
	}

	// Path traversal check via resolveProcessedImagePath and route
	if _, ok := resolveProcessedImagePath(processedDir, "../../../../../../../../../../../../etc/passwd"); ok {
		t.Error("expected resolveProcessedImagePath to reject path traversal outside baseDir")
	}
	if _, ok := resolveProcessedImagePath(processedDir, "receipt1.png"); !ok {
		t.Error("expected resolveProcessedImagePath to accept valid relative file")
	}
}

func TestMain_LifecycleAndErrorBranches(t *testing.T) {
	setupMainTestDB(t)
	tmpDir := t.TempDir()
	docDir := filepath.Join(tmpDir, "document-data")
	_, _ = constants.SetDropboxLocation(docDir)

	origConnect := connectDBFn
	origProcessExisting := processExistingFilesFn
	origWatcher := startWatcherFn
	origListen := listenAppFn
	origFatal := fatalLogFn
	origSweep := sweepTickerDuration
	defer func() {
		connectDBFn = origConnect
		processExistingFilesFn = origProcessExisting
		startWatcherFn = origWatcher
		listenAppFn = origListen
		fatalLogFn = origFatal
		sweepTickerDuration = origSweep
	}()

	connectDBFn = func() {}
	processExistingFilesFn = func(path string) error { return nil }
	startWatcherFn = func() error { return nil }
	sweepTickerDuration = 50 * time.Millisecond

	var fatalCalled bool
	fatalLogFn = func(v ...interface{}) {
		fatalCalled = true
	}

	// 1. Happy path + custom PORT + SIGTERM graceful shutdown signal handler + non-blocking initial inbox sweep
	sweepDone := make(chan struct{}, 1)
	processExistingFilesFn = func(path string) error {
		time.Sleep(30 * time.Millisecond)
		select {
		case sweepDone <- struct{}{}:
		default:
		}
		return nil
	}
	t.Setenv("PORT", "0")
	t.Setenv("DOCUMENT_DATA_PATH", docDir)
	listenAppFn = func(app *fiber.App, addr string) error {
		_ = syscall.Kill(os.Getpid(), syscall.SIGTERM)
		time.Sleep(20 * time.Millisecond)
		return nil
	}
	main()
	if fatalCalled {
		t.Error("expected main() happy path not to call fatalLogFn")
	}
	select {
	case <-sweepDone:
	default:
		t.Error("expected main() to run initial inbox sweep and wait for completion on shutdown")
	}

	// 2. Default PORT + listen error triggers fatalLogFn
	processExistingFilesFn = func(path string) error { return nil }
	t.Setenv("PORT", "")
	listenAppFn = func(app *fiber.App, addr string) error {
		return errors.New("listen failed")
	}
	main()
	if !fatalCalled {
		t.Error("expected fatalLogFn when listenAppFn fails")
	}

	// 3. Watcher startup error triggers fatalLogFn
	fatalCalled = false
	startWatcherFn = func() error {
		return errors.New("watcher failed")
	}
	main()
	if !fatalCalled {
		t.Error("expected fatalLogFn when startWatcherFn fails")
	}

	// 4. CreateDirsIfNotExists error triggers fatalLogFn (replace inbox dir with a plain file)
	fatalCalled = false
	inboxPath := constants.GetInboxPath()
	_ = os.RemoveAll(inboxPath)
	_ = os.WriteFile(inboxPath, []byte("blocker"), 0644)
	main()
	if !fatalCalled {
		t.Error("expected fatalLogFn when CreateDirsIfNotExists fails")
	}
}
