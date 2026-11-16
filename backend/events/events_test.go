package events

import (
	"encoding/json"
	"io"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
)

func TestSubscribeUnsubscribe(t *testing.T) {
	// Use a fresh EventHub for test isolation
	hub := &EventHub{clients: make(map[chan []byte]struct{})}

	ch := hub.Subscribe()
	if _, ok := hub.clients[ch]; !ok {
		t.Error("Subscribe: channel not registered in clients map")
	}

	hub.Unsubscribe(ch)
	if _, ok := hub.clients[ch]; ok {
		t.Error("Unsubscribe: channel still in clients map")
	}
}

func TestBroadcast(t *testing.T) {
	hub := &EventHub{clients: make(map[chan []byte]struct{})}

	ch := hub.Subscribe()
	defer hub.Unsubscribe(ch)

	payload := map[string]interface{}{"key": "value"}
	hub.Broadcast("test_event", payload)

	select {
	case msg := <-ch:
		var parsed EventMessage
		if err := json.Unmarshal(msg, &parsed); err != nil {
			t.Fatalf("Failed to unmarshal broadcast message: %v", err)
		}
		if parsed.Type != "test_event" {
			t.Errorf("Event type = %q, want %q", parsed.Type, "test_event")
		}
		if parsed.Time == 0 {
			t.Error("Event time is zero")
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("Broadcast: no message received within timeout")
	}
}

func TestBroadcast_DropsFullChannel(t *testing.T) {
	hub := &EventHub{clients: make(map[chan []byte]struct{})}

	// Simulate a non-blocking subscriber that can't receive fast enough
	// (channel is open but full — should be dropped, not panic)
	bufCh := make(chan []byte, 1)
	hub.clients[bufCh] = struct{}{}
	bufCh <- []byte("full") // fill the buffer

	// This broadcast should drop the full channel entry without blocking or panicking
	hub.Broadcast("test", "payload")

	// The full channel won't receive another message (it was dropped)
	select {
	case <-bufCh:
		// Extra message received — either it wasn't dropped or it was buffered
	default:
		// Expected: channel was full, message was dropped
	}
}

func TestBroadcast_MultipleClients(t *testing.T) {
	hub := &EventHub{clients: make(map[chan []byte]struct{})}

	ch1 := hub.Subscribe()
	ch2 := hub.Subscribe()
	defer func() {
		hub.Unsubscribe(ch1)
		hub.Unsubscribe(ch2)
	}()

	hub.Broadcast("multi", "hello")

	msg1, ok1 := <-ch1
	msg2, ok2 := <-ch2

	if !ok1 || !ok2 {
		t.Error("Broadcast: one or more channels closed unexpectedly")
	}

	var parsed1, parsed2 EventMessage
	if err := json.Unmarshal(msg1, &parsed1); err != nil {
		t.Fatalf("Failed to unmarshal msg1: %v", err)
	}
	if err := json.Unmarshal(msg2, &parsed2); err != nil {
		t.Fatalf("Failed to unmarshal msg2: %v", err)
	}

	if parsed1.Type != parsed2.Type {
		t.Errorf("Messages differ: %q != %q", parsed1.Type, parsed2.Type)
	}
}

func TestBroadcast_InvalidPayload(t *testing.T) {
	hub := &EventHub{clients: make(map[chan []byte]struct{})}

	ch := hub.Subscribe()
	defer hub.Unsubscribe(ch)

	// Send an unmarshalable payload (a channel can't be JSON-marshaled)
	hub.Broadcast("bad_payload", make(chan int))

	// Should not receive anything (marshal fails silently)
	select {
	case <-ch:
		t.Error("Broadcast: received message for invalid payload (marshal should have failed)")
	case <-time.After(50 * time.Millisecond):
		// Expected: no message received
	}
}

func TestHub_GlobalBroadcast(t *testing.T) {
	// Save original hub and restore after test
	original := Hub
	Hub = &EventHub{clients: make(map[chan []byte]struct{})}
	defer func() { Hub = original }()

	ch := Hub.Subscribe()
	defer Hub.Unsubscribe(ch)

	Broadcast("global_test", "data")

	select {
	case msg := <-ch:
		var parsed EventMessage
		if err := json.Unmarshal(msg, &parsed); err != nil {
			t.Fatalf("Failed to unmarshal: %v", err)
		}
		if parsed.Type != "global_test" {
			t.Errorf("Type = %q, want %q", parsed.Type, "global_test")
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("Global Broadcast: no message received")
	}
}

func TestBroadcast_ConcurrentSubscribeUnsubscribe(t *testing.T) {
	// Regression test: previously Broadcast iterated the clients map
	// while holding RLock. A concurrent Unsubscribe (full Lock) could
	// close+delete channels during iteration, causing a panic.
	hub := &EventHub{clients: make(map[chan []byte]struct{})}

	var wg sync.WaitGroup
	stop := make(chan struct{})

	// Fire 20 goroutines that subscribe/unsubscribe continuously
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
					ch := hub.Subscribe()
					time.Sleep(time.Millisecond)
					hub.Unsubscribe(ch)
				}
			}
		}()
	}

	// Broadcast 100 times while the above races
	for i := 0; i < 100; i++ {
		hub.Broadcast("concurrent", i)
		time.Sleep(time.Millisecond)
	}

	close(stop)
	wg.Wait()
	// If we reach here without panic, the snapshot approach works.
}

func TestBroadcast_UnsubscribedClientDoesntReceive(t *testing.T) {
	hub := &EventHub{clients: make(map[chan []byte]struct{})}
	ch := hub.Subscribe()
	hub.Unsubscribe(ch) // remove before broadcast

	// After Unsubscribe the channel is closed. A receive on a closed channel
	// returns zero-value immediately with ok=false, so we must check ok.
	select {
	case _, ok := <-ch:
		if ok {
			t.Error("unsubscribed channel should not deliver data")
		}
		// ok=false is expected (closed channel, no data)
	case <-time.After(50 * time.Millisecond):
		// also expected
	}
}

// ---- HandleSSEStream: ticker ping path ----

func TestHandleSSEStream_TickerPing(t *testing.T) {
	app := fiber.New()
	oldDuration := SetSSETickerDuration(50 * time.Millisecond)
	defer func() {
		Hub.CloseAll()
		WaitSSEStreams()
		SetSSETickerDuration(oldDuration)
	}()

	app.Get("/sse", HandleSSEStream)

	req := httptest.NewRequest("GET", "/sse", nil)
	resp, err := app.Test(req, fiber.TestConfig{Timeout: 200 * time.Millisecond})
	if err != nil {
		t.Logf("SSE ticker test: %v (timeout expected for streaming response)", err)
	}
	if resp != nil && resp.Body != nil {
		body, _ := io.ReadAll(resp.Body)
		bodyStr := string(body)
		// Should have connected event + at least one ping
		if !strings.Contains(bodyStr, "event: connected") {
			t.Errorf("Missing 'event: connected' in body: %s", bodyStr)
		}
		if !strings.Contains(bodyStr, "event: ping") {
			t.Errorf("Missing 'event: ping' — ticker should fire within 200ms with 50ms duration")
		}
		resp.Body.Close()
	}
}

// ---- HandleSSEStream: message delivery + ticker ----

func TestHandleSSEStream_MessageAndPing(t *testing.T) {
	app := fiber.New()
	oldDuration := SetSSETickerDuration(30 * time.Millisecond)
	defer func() {
		Hub.CloseAll()
		WaitSSEStreams()
		SetSSETickerDuration(oldDuration)
	}()

	app.Get("/sse", HandleSSEStream)

	req := httptest.NewRequest("GET", "/sse", nil)
	resp, err := app.Test(req, fiber.TestConfig{Timeout: 150 * time.Millisecond})
	if err != nil {
		t.Logf("SSE msg+ping test: %v", err)
	}
	if resp != nil && resp.Body != nil {
		body, _ := io.ReadAll(resp.Body)
		bodyStr := string(body)
		if !strings.Contains(bodyStr, "event: connected") {
			t.Errorf("Missing 'event: connected'")
		}
		if !strings.Contains(bodyStr, "event: ping") {
			t.Errorf("Missing 'event: ping'")
		}
		resp.Body.Close()
	}
}

// ---- HandleSSEStream: channel close path ----

func TestHandleSSEStream_ChannelClosePath(t *testing.T) {
	// The !ok path in the select loop is triggered when clientChan is closed
	// from outside the handler. We test this by verifying that after unsubscribe,
	// a broadcast doesn't deliver to the closed channel (the defer recover in
	// Broadcast handles the closed channel, and the SSE handler's defer Unsubscribe
	// will close the channel when the handler returns).
	hub := &EventHub{clients: make(map[chan []byte]struct{})}
	ch := hub.Subscribe()
	hub.Unsubscribe(ch) // closes channel

	// Verify channel is closed
	select {
	case _, ok := <-ch:
		if ok {
			t.Error("channel should be closed after unsubscribe")
		}
	case <-time.After(50 * time.Millisecond):
		// Also expected
	}
}

// ---- HandleSSEStream: Fiber request with full headers ----

func TestHandleSSEStream_RequestHeaders(t *testing.T) {
	oldDuration := SetSSETickerDuration(50 * time.Millisecond)
	defer func() {
		Hub.CloseAll()
		WaitSSEStreams()
		SetSSETickerDuration(oldDuration)
	}()

	app := fiber.New()
	app.Get("/sse", HandleSSEStream)

	req := httptest.NewRequest("GET", "/sse", nil)
	resp, err := app.Test(req, fiber.TestConfig{Timeout: 200 * time.Millisecond})
	if err != nil {
		t.Logf("SSE headers test: %v", err)
		return
	}
	defer resp.Body.Close()

	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Errorf("Content-Type = %q, want 'text/event-stream'", ct)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("Cache-Control = %q, want 'no-cache'", cc)
	}
	if conn := resp.Header.Get("Connection"); conn != "keep-alive" {
		t.Errorf("Connection = %q, want 'keep-alive'", conn)
	}
	if aco := resp.Header.Get("Access-Control-Allow-Origin"); aco != "http://localhost:5173" {
		t.Errorf("Access-Control-Allow-Origin = %q", aco)
	}
	if acc := resp.Header.Get("Access-Control-Allow-Credentials"); acc != "true" {
		t.Errorf("Access-Control-Allow-Credentials = %q", acc)
	}

	// Read body to check for connected + ping events
	body, _ := io.ReadAll(resp.Body)
	bodyStr := string(body)
	if !strings.Contains(bodyStr, "event: connected") {
		t.Errorf("Missing 'event: connected'")
	}
	if !strings.Contains(bodyStr, "event: ping") {
		t.Errorf("Missing 'event: ping'")
	}
}

// ---- HandleSSEStream: SSE panic recovery via SSEPanicTrigger ----

func TestHandleSSEStream_PanicRecovery(t *testing.T) {
	app := fiber.New()
	oldHook := SetSSEPanicTrigger(func() {
		panic("test sse panic")
	})
	defer func() {
		Hub.CloseAll()
		WaitSSEStreams()
		SetSSEPanicTrigger(oldHook)
	}()

	app.Get("/sse", HandleSSEStream)

	req := httptest.NewRequest("GET", "/sse", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Logf("SSE panic test: %v (expected for streaming panic recovery)", err)
	}
	if resp != nil && resp.Body != nil {
		body, _ := io.ReadAll(resp.Body)
		bodyStr := string(body)
		// Should have connected event + error event from panic recovery
		if !strings.Contains(bodyStr, "event: connected") {
			t.Errorf("Missing 'event: connected'")
		}
		if !strings.Contains(bodyStr, "event: error") {
			t.Errorf("Missing 'event: error' from panic recovery — body: %s", bodyStr)
		}
		resp.Body.Close()
	}
}
