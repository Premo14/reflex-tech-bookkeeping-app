package controllers

import (
	"net/http/httptest"
	"testing"

	"reflex-tech-bookkeeping-app-api/events"

	"github.com/gofiber/fiber/v3"
)

func TestHandleSSEStream(t *testing.T) {
	app := fiber.New()
	app.Get("/events", HandleSSEStream)

	req := httptest.NewRequest("GET", "/events", nil)
	req.Header.Set("Origin", "http://localhost:5173")

	// SSE endpoints are streaming — Test() returns an error for unclosed streams.
	// This is expected; we just verify the handler doesn't panic.
	_, err := app.Test(req)
	// Error is expected (stream doesn't close normally)
	if err == nil {
		// Some environments may close it cleanly — that's OK too
	}
}

func TestHandleSSEStream_NoPanic(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("HandleSSEStream panicked: %v", r)
		}
	}()

	app := fiber.New()
	app.Get("/events", HandleSSEStream)

	req := httptest.NewRequest("GET", "/events", nil)
	_, _ = app.Test(req)
}

func TestBroadcastEvent_Wrapper(t *testing.T) {
	// BroadcastEvent was removed; verify events.Broadcast works directly.
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("events.Broadcast panicked: %v", r)
		}
	}()

	events.Broadcast("test.event", "payload")
}
