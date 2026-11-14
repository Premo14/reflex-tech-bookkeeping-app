package main

import (
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
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

// shutdownCh is closed on SIGTERM/SIGINT so background goroutines can exit cleanly.
var shutdownCh = make(chan struct{})

func main() {
	db.Connect()

	// 15-minute background reconciliation & overdue sweep ticker
	go func() {
		controllers.SweepOverdueInvoices()
		utils.RunReconciliation()

		ticker := time.NewTicker(15 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				controllers.SweepOverdueInvoices()
				utils.RunReconciliation()
			case <-shutdownCh:
				return
			}
		}
	}()

	// Initialize dynamic dropbox location from DB settings or environment
	var dropboxSetting models.AppSetting
	if err := db.DB.Where("key = ?", "DocumentDropboxPath").First(&dropboxSetting).Error; err == nil && dropboxSetting.Value != "" {
		if _, err := constants.SetDropboxLocation(dropboxSetting.Value); err != nil {
			log.Printf("Warning: saved DocumentDropboxPath (%s) could not be loaded: %v", dropboxSetting.Value, err)
		}
	} else if envPath := os.Getenv("DOCUMENT_DATA_PATH"); envPath != "" {
		if _, err := constants.SetDropboxLocation(envPath); err != nil {
			log.Printf("Warning: env DOCUMENT_DATA_PATH (%s) could not be loaded: %v", envPath, err)
		}
	}

	if err := utils.CreateDirsIfNotExists(); err != nil {
		log.Fatal("Failed to create watched \"inbox/\" and \"processed/\" folders:", err)
	}

	if err := utils.ProcessExistingFiles(constants.GetInboxPath()); err != nil {
		log.Fatal("Failed to process existing files:", err)
	}

	if err := utils.Watcher(); err != nil {
		log.Fatal("Failed to start the watcher:", err)
	}

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
		relPath := c.Params("*")
		baseDir := filepath.Clean(constants.GetProcessedPath())
		cleanTarget := filepath.Clean(filepath.Join(baseDir, relPath))

		// Prevent path traversal outside the processed folder
		if !strings.HasPrefix(cleanTarget, baseDir+string(filepath.Separator)) && cleanTarget != baseDir {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Access denied"})
		}
		return c.SendFile(cleanTarget)
	})

	// Graceful shutdown on SIGTERM/SIGINT
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-sigCh
		log.Println("Shutting down server...")
		close(shutdownCh) // signal background goroutines to exit
		_ = app.Shutdown()
	}()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Fatal(app.Listen(":" + port))
}
