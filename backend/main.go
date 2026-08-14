package main

import (
	"log"
	"reflex-tech-bookkeeping-app-api/constants"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/utils"
	"time"

	"github.com/gofiber/fiber/v3"
)

func main() {

	db.Connect()

	if err := utils.CreateDirsIfNotExists(); err != nil {
		log.Fatal("Failed to create watched \"inbox/\" and \"processed/\" folders:", err)
	}

	// Call this so existing files are handled at startup
	if err := utils.ProcessExistingFiles(constants.InboxPath); err != nil {
		log.Fatal("Failed to process existing files:", err)
	}

	if err := utils.Watcher(); err != nil {
		log.Fatal("Failed to start the watcher:", err)
	}

	app := fiber.New()

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
