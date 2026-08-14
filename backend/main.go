package main

import (
	"log"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/utils"
	"time"

	"github.com/gofiber/fiber/v3"
)

func main() {
	inboxPath := "/app/documents/inbox"

	// Call this so existing files are handled at startup
	if err := utils.ProcessExistingFiles(inboxPath); err != nil {
		log.Fatal("Failed to process existing files:", err)
	}

	if err := utils.CreateDirIfNotExists(); err != nil {
		log.Fatal("Failed to create watched \"inbox/\" folder:", err)
	}

	if err := utils.Watcher(); err != nil {
		log.Fatal("Failed to start the watcher:", err)
	}

	app := fiber.New()

	db.Connect()

	app.Get("/", func(c fiber.Ctx) error {
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"status":    "success",
			"message":   "Service is up and running",
			"timestamp": time.Now().Format(time.RFC3339),
		})
	})

	app.Get("/receipts", func(c fiber.Ctx) error {
		return nil
	})

	log.Fatal(app.Listen(":8080"))
}
