package main

import (
	"log"
	"reflex-tech-bookkeeping-app-api/constants"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/routes"
	"reflex-tech-bookkeeping-app-api/utils"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/static"
)

func main() {

	db.Connect()

	if err := utils.CreateDirsIfNotExists(); err != nil {
		log.Fatal("Failed to create watched \"inbox/\" and \"processed/\" folders:", err)
	}

	if err := utils.ProcessExistingFiles(constants.InboxPath); err != nil {
		log.Fatal("Failed to process existing files:", err)
	}

	if err := utils.Watcher(); err != nil {
		log.Fatal("Failed to start the watcher:", err)
	}

	app := fiber.New()

	// Expose the processed/ folder so the frontend can display receipt images
	app.Get("/images/*", static.New(constants.ProcessedPath))

	// Wire up all the API routes from our routes/ folder!
	routes.SetupRoutes(app)

	log.Fatal(app.Listen(":8080"))
}
