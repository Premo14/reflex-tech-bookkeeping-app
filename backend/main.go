package main

import (
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"reflex-tech-bookkeeping-app-api/constants"
	"reflex-tech-bookkeeping-app-api/controllers"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/routes"
	"reflex-tech-bookkeeping-app-api/utils"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
)

var (
	sweepTickerDuration    = 15 * time.Minute
	connectDBFn            = db.Connect
	processExistingFilesFn = utils.ProcessExistingFiles
	startWatcherFn         = utils.Watcher
	listenAppFn            = func(app *fiber.App, addr string) error { return app.Listen(addr) }
	fatalLogFn             = log.Fatal
)

func startBackgroundSweep(stopCh <-chan struct{}, interval time.Duration) {
	controllers.SweepOverdueInvoices()
	utils.RunReconciliation()

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			controllers.SweepOverdueInvoices()
			utils.RunReconciliation()
		case <-stopCh:
			return
		}
	}
}

func initDropboxLocation() {
	var dropboxSetting models.AppSetting
	if db.DB != nil {
		if err := db.DB.Where("key = ?", "DocumentDropboxPath").First(&dropboxSetting).Error; err == nil && dropboxSetting.Value != "" {
			if _, err := constants.SetDropboxLocation(dropboxSetting.Value); err != nil {
				log.Printf("Warning: saved DocumentDropboxPath (%s) could not be loaded: %v", dropboxSetting.Value, err)
			}
			return
		}
	}
	if envPath := os.Getenv("DOCUMENT_DATA_PATH"); envPath != "" {
		if _, err := constants.SetDropboxLocation(envPath); err != nil {
			log.Printf("Warning: env DOCUMENT_DATA_PATH (%s) could not be loaded: %v", envPath, err)
		}
	}
}

func resolveProcessedImagePath(baseDir, relPath string) (string, bool) {
	cleanedBase := filepath.Clean(baseDir)
	cleanTarget := filepath.Clean(filepath.Join(cleanedBase, relPath))
	if !strings.HasPrefix(cleanTarget, cleanedBase+string(filepath.Separator)) && cleanTarget != cleanedBase {
		return "", false
	}
	return cleanTarget, true
}

func newApp() *fiber.App {
	app := fiber.New(fiber.Config{
		BodyLimit: 50 << 20, // 50 MB — max image + bank statement upload size
	})

	app.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:5173"},
		AllowHeaders:     []string{"Origin, Content-Type, Accept, Authorization"},
		AllowCredentials: true,
	}))

	routes.SetupRoutes(app)

	// Expose the processed/ folder so the frontend can display receipt images dynamically
	app.Get("/api/images/*", func(c fiber.Ctx) error {
		cleanTarget, ok := resolveProcessedImagePath(constants.GetProcessedPath(), c.Params("*"))
		if !ok {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Access denied"})
		}
		return c.SendFile(cleanTarget)
	})

	return app
}

func main() {
	connectDBFn()

	stopCh := make(chan struct{})
	var stopOnce sync.Once
	closeStop := func() {
		stopOnce.Do(func() { close(stopCh) })
	}
	var bgWG sync.WaitGroup
	defer func() {
		closeStop()
		bgWG.Wait()
	}()

	// 15-minute background reconciliation & overdue sweep ticker
	bgWG.Add(1)
	go func() {
		defer bgWG.Done()
		startBackgroundSweep(stopCh, sweepTickerDuration)
	}()

	// Initialize dynamic dropbox location from DB settings or environment
	initDropboxLocation()

	if err := utils.CreateDirsIfNotExists(); err != nil {
		fatalLogFn("Failed to create watched \"inbox/\" and \"processed/\" folders:", err)
		return
	}

	if err := startWatcherFn(); err != nil {
		fatalLogFn("Failed to start the watcher:", err)
		return
	}

	app := newApp()

	// Process queued inbox files asynchronously after app creation so /api/health
	// binds immediately even when Ollama is cold-starting or offline.
	bgWG.Add(1)
	go func() {
		defer bgWG.Done()
		select {
		case <-stopCh:
			return
		default:
		}
		if err := processExistingFilesFn(constants.GetInboxPath()); err != nil {
			log.Printf("Warning: initial inbox sweep finished with error: %v", err)
		}
	}()

	// Graceful shutdown on SIGTERM/SIGINT
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	defer signal.Stop(sigCh)
	bgWG.Add(1)
	go func() {
		defer bgWG.Done()
		select {
		case <-sigCh:
			log.Println("Shutting down server...")
			closeStop()
			_ = app.Shutdown()
		case <-stopCh:
		}
	}()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	if err := listenAppFn(app, ":"+port); err != nil {
		fatalLogFn(err)
	}
}
