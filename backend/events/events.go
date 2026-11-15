package events

import (
	"bufio"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/gofiber/fiber/v3"
)

type EventMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload,omitempty"`
	Time    int64       `json:"time"`
}

type EventHub struct {
	mu      sync.RWMutex
	clients map[chan []byte]struct{}
}

var Hub = &EventHub{
	clients: make(map[chan []byte]struct{}),
}

func (h *EventHub) Subscribe() chan []byte {
	h.mu.Lock()
	defer h.mu.Unlock()
	ch := make(chan []byte, 64)
	h.clients[ch] = struct{}{}
	return ch
}

func (h *EventHub) Unsubscribe(ch chan []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.clients[ch]; ok {
		delete(h.clients, ch)
		close(ch)
	}
}

func (h *EventHub) Broadcast(eventType string, payload interface{}) {
	msg := EventMessage{
		Type:    eventType,
		Payload: payload,
		Time:    time.Now().UnixMilli(),
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	// Snapshot client keys under read lock to avoid map-concurrency issues.
	// Unsubscribe acquires the full lock and may close+delete channels while we iterate.
	h.mu.RLock()
	keys := make([]chan []byte, 0, len(h.clients))
	for ch := range h.clients {
		keys = append(keys, ch)
	}
	h.mu.RUnlock()

	for _, ch := range keys {
		func() {
			defer func() { recover() }() // safeguard against stale/closed channel
			select {
			case ch <- data:
			default:
				// client channel is full; drop to avoid blocking broadcast loop
			}
		}()
	}
}

// Broadcast sends an event to all connected SSE clients (shorthand for Hub.Broadcast).
func Broadcast(eventType string, payload interface{}) {
	Hub.Broadcast(eventType, payload)
}

// SSETickerDuration controls the SSE keep-alive ping interval.
// The default is 20 seconds. Set to a shorter duration in tests.
var SSETickerDuration = 20 * time.Second

// SSEPanicTrigger is called before the main select loop for testing purposes.
// Set to a non-nil function in tests to inject a panic and verify defer recover.
var SSEPanicTrigger func()

// HandleSSEStream streams server-sent events to connected browser clients.
func HandleSSEStream(c fiber.Ctx) error {
	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	// Restrict CORS to match the Fiber CORS middleware; avoid wildcard on SSE
	c.Set("Access-Control-Allow-Origin", "http://localhost:5173")
	c.Set("Access-Control-Allow-Credentials", "true")

	return c.SendStreamWriter(func(w *bufio.Writer) {
		defer func() {
			if r := recover(); r != nil {
				// Prevent a single subscriber panic from taking down the whole broadcast loop
				// Log the panic but allow the handler to clean up gracefully
				fmt.Fprintf(w, "event: error\ndata: {\"message\":\"sse stream recovered from panic\"}\n\n")
				if flushErr := w.Flush(); flushErr != nil {
					fmt.Println("SSE flush error after panic:", flushErr)
				}
			}
		}()

		clientChan := Hub.Subscribe()
		defer Hub.Unsubscribe(clientChan)

		// Send initial connected event
		fmt.Fprintf(w, "event: connected\ndata: {\"status\":\"ok\"}\n\n")
		if err := w.Flush(); err != nil {
			return
		}

		ticker := time.NewTicker(SSETickerDuration)
		defer ticker.Stop()

		// Test hook: allow tests to inject a panic to verify defer recover
		if SSEPanicTrigger != nil {
			SSEPanicTrigger()
		}

		for {
			select {
			case msg, ok := <-clientChan:
				if !ok {
					return
				}
				fmt.Fprintf(w, "event: message\ndata: %s\n\n", string(msg))
				if err := w.Flush(); err != nil {
					return
				}
			case <-ticker.C:
				fmt.Fprintf(w, "event: ping\ndata: {}\n\n")
				if err := w.Flush(); err != nil {
					return
				}
			}
		}
	})
}
