package controllers

import (
	"reflex-tech-bookkeeping-app-api/events"

	"github.com/gofiber/fiber/v3"
)

// HandleSSEStream delegates to events.HandleSSEStream.
func HandleSSEStream(c fiber.Ctx) error {
	return events.HandleSSEStream(c)
}
