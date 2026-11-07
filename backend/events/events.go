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

	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.clients {
		select {
		case ch <- data:
		default:
			// client channel is full; drop to avoid blocking
		}
	}
}

// Broadcast sends an event to all connected SSE clients.
func Broadcast(eventType string, payload interface{}) {
	Hub.Broadcast(eventType, payload)
}

// HandleSSEStream streams server-sent events to connected browser clients.
func HandleSSEStream(c fiber.Ctx) error {
	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	c.Set("Access-Control-Allow-Origin", "*")

	return c.SendStreamWriter(func(w *bufio.Writer) {
		clientChan := Hub.Subscribe()
		defer Hub.Unsubscribe(clientChan)

		// Send initial connected event
		fmt.Fprintf(w, "event: connected\ndata: {\"status\":\"ok\"}\n\n")
		if err := w.Flush(); err != nil {
			return
		}

		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()

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
