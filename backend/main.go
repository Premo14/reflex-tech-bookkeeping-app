package main

import (
	"log"
	"os"
	"path/filepath"
	"reflex-tech-bookkeeping-app-api/constants"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/routes"
	"reflex-tech-bookkeeping-app-api/utils"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
)

func main() {

	db.Connect()
	go utils.RunReconciliation()

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

	app := fiber.New()

	app.Use(cors.New(cors.Config{
		AllowOrigins: []string{"http://localhost:5173"},
		AllowHeaders: []string{"Origin, Content-Type, Accept"},
	}))

	// Expose the processed/ folder so the frontend can display receipt images dynamically
	app.Get("/api/images/*", func(c fiber.Ctx) error {
		relPath := c.Params("*")
		filePath := filepath.Join(constants.GetProcessedPath(), relPath)
		return c.SendFile(filePath)
	})

	routes.SetupRoutes(app)

	log.Fatal(app.Listen(":8080"))
}
