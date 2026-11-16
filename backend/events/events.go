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

// CloseAll closes and removes all currently subscribed client channels cleanly.
func (h *EventHub) CloseAll() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.clients {
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

	// Hold RLock while doing non-blocking sends so Unsubscribe/CloseAll cannot close
	// any channel concurrently with a channel send.
	h.mu.RLock()
	defer h.mu.RUnlock()

	for ch := range h.clients {
		select {
		case ch <- data:
		default:
			// client channel is full; drop to avoid blocking broadcast loop
		}
	}
}

// Broadcast sends an event to all connected SSE clients (shorthand for Hub.Broadcast).
func Broadcast(eventType string, payload interface{}) {
	Hub.Broadcast(eventType, payload)
}

var (
	sseConfigMu       sync.RWMutex
	sseTickerDuration = 20 * time.Second
	ssePanicTrigger   func()
	activeSSEStreams  sync.WaitGroup
)

// SetSSETickerDuration safely sets the SSE keep-alive ping interval and returns the previous value.
func SetSSETickerDuration(d time.Duration) time.Duration {
	sseConfigMu.Lock()
	defer sseConfigMu.Unlock()
	prev := sseTickerDuration
	sseTickerDuration = d
	return prev
}

func getSSETickerDuration() time.Duration {
	sseConfigMu.RLock()
	defer sseConfigMu.RUnlock()
	return sseTickerDuration
}

// SetSSEPanicTrigger safely sets an optional hook invoked before streaming starts and returns the previous hook.
func SetSSEPanicTrigger(fn func()) func() {
	sseConfigMu.Lock()
	defer sseConfigMu.Unlock()
	prev := ssePanicTrigger
	ssePanicTrigger = fn
	return prev
}

func getSSEPanicTrigger() func() {
	sseConfigMu.RLock()
	defer sseConfigMu.RUnlock()
	return ssePanicTrigger
}

// WaitSSEStreams blocks until all active SSE stream writers have exited.
func WaitSSEStreams() {
	activeSSEStreams.Wait()
}

// HandleSSEStream streams server-sent events to connected browser clients.
func HandleSSEStream(c fiber.Ctx) error {
	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")
	// Restrict CORS to match the Fiber CORS middleware; avoid wildcard on SSE
	c.Set("Access-Control-Allow-Origin", "http://localhost:5173")
	c.Set("Access-Control-Allow-Credentials", "true")

	return c.SendStreamWriter(streamSSEWriter)
}

func streamSSEWriter(w *bufio.Writer) {
	activeSSEStreams.Add(1)
	defer activeSSEStreams.Done()

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

	ticker := time.NewTicker(getSSETickerDuration())
	defer ticker.Stop()

	// Test hook: allow tests to inject a panic to verify defer recover
	if panicFn := getSSEPanicTrigger(); panicFn != nil {
		panicFn()
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
}
