package main

import (
	"log"
	"reflex-tech-bookkeeping-app-api/db"

	"github.com/gofiber/fiber/v3"
)

func main() {
	app := fiber.New()

	db.Connect()

	app.Get("/", func(c fiber.Ctx) error {
		return c.SendString("Hello, World!")
	})

	log.Fatal(app.Listen(":8080"))
}
