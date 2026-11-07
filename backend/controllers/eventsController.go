package controllers

import (
	"reflex-tech-bookkeeping-app-api/events"

	"github.com/gofiber/fiber/v3"
)

// BroadcastEvent broadcasts to all connected SSE clients via the events package
func BroadcastEvent(eventType string, payload interface{}) {
	events.Broadcast(eventType, payload)
}

// HandleSSEStream delegates to events.HandleSSEStream
func HandleSSEStream(c fiber.Ctx) error {
	return events.HandleSSEStream(c)
}
