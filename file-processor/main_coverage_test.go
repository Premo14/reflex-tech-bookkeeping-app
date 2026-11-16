package main

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/valyala/fasthttp"
)

// mockOllamaServer creates an httptest.Server that mimics Ollama's /api/generate endpoint.
func mockOllamaServer(t *testing.T, response string, statusCode int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if r.URL.Path != "/api/generate" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if statusCode >= 400 {
			w.WriteHeader(statusCode)
			w.Write([]byte("error"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(fasthttp.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"response": response})
	}))
}

// mockOllamaServerInvalidJSON returns an envelope with invalid JSON.
func mockOllamaServerInvalidJSON(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(fasthttp.StatusOK)
		w.Write([]byte(`{invalid json`))
	}))
}

// mockOllamaServerEmptyResponse returns an empty response string.
func mockOllamaServerEmptyResponse(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(fasthttp.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"response": "   "})
	}))
}

// createJpeg creates a minimal valid JPEG in memory.
func createJpeg(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	img.Set(0, 0, color.RGBA{R: 255, G: 0, B: 0, A: 255})
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatalf("jpeg encode: %v", err)
	}
	return buf.Bytes()
}

// createPng creates a minimal valid PNG in memory.
func createPng(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	img.Set(0, 0, color.RGBA{R: 0, G: 255, B: 0, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png encode: %v", err)
	}
	return buf.Bytes()
}

// createPdf creates minimal PDF bytes.
func createPdf() []byte {
	return []byte("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\nxref\n0 4\ntrailer\n<< /Size 4 >>\nstartxref\n0\n%%EOF\n")
}

func TestCallOllama_Success(t *testing.T) {
	resp := `{"timestamp":"2026-01-01T00:00:00Z","vendor":"Test","description":"Item","amount":5,"taxAmount":0,"currencyCode":"USD","tender":"CARD","chartAccountId":null}`
	ts := mockOllamaServer(t, resp, fasthttp.StatusOK)
	defer ts.Close()

	t.Setenv("OLLAMA_HOST", ts.URL)

	req := OllamaRequest{
		Model:  "llama3.1:8b",
		Prompt: "extract receipt",
		Stream: false,
		Format: "json",
		Options: map[string]any{"temperature": 0.0},
	}
	result, err := callOllama(req)
	if err != nil {
		t.Fatalf("callOllama() error: %v", err)
	}
	if result != resp {
		t.Errorf("callOllama() = %q, want %q", result, resp)
	}
}

func TestCallOllama_NetworkError(t *testing.T) {
	t.Setenv("OLLAMA_HOST", "http://127.0.0.1:1")
	req := OllamaRequest{Model: "test", Prompt: "test", Stream: false}
	_, err := callOllama(req)
	if err == nil {
		t.Fatal("expected error for unreachable Ollama host")
	}
	if !strings.Contains(err.Error(), "ollama request") {
		t.Errorf("error should contain 'ollama request': %v", err)
	}
}

func TestCallOllama_Non200Status(t *testing.T) {
	ts := mockOllamaServer(t, "error", 503)
	defer ts.Close()
	t.Setenv("OLLAMA_HOST", ts.URL)

	req := OllamaRequest{Model: "test", Prompt: "test", Stream: false}
	_, err := callOllama(req)
	if err == nil {
		t.Fatal("expected error for non-200 status")
	}
	if !strings.Contains(err.Error(), "ollama status") {
		t.Errorf("error should contain 'ollama status': %v", err)
	}
}

func TestCallOllama_EmptyResponse(t *testing.T) {
	ts := mockOllamaServerEmptyResponse(t)
	defer ts.Close()
	t.Setenv("OLLAMA_HOST", ts.URL)

	req := OllamaRequest{Model: "test", Prompt: "test", Stream: false}
	_, err := callOllama(req)
	if err == nil {
		t.Fatal("expected error for empty response")
	}
	if !strings.Contains(err.Error(), "empty response") {
		t.Errorf("error should contain 'empty response': %v", err)
	}
}

func TestCallOllama_PoorJson(t *testing.T) {
	ts := mockOllamaServerInvalidJSON(t)
	defer ts.Close()
	t.Setenv("OLLAMA_HOST", ts.URL)

	req := OllamaRequest{Model: "test", Prompt: "test", Stream: false}
	_, err := callOllama(req)
	if err == nil {
		t.Fatal("expected error for malformed JSON")
	}
	if !strings.Contains(err.Error(), "parse envelope") {
		t.Errorf("error should contain 'parse envelope': %v", err)
	}
}

func TestCallOllama_VisionMulti_Success(t *testing.T) {
	resp := `{"timestamp":"2026-01-01T00:00:00Z","vendor":"Store","description":"Receipt","amount":15.50,"taxAmount":1.20,"currencyCode":"USD","tender":"CASH","chartAccountId":null}`
	ts := mockOllamaServer(t, resp, fasthttp.StatusOK)
	defer ts.Close()

	t.Setenv("OLLAMA_HOST", ts.URL)

	req := OllamaRequest{
		Model:   "qwen2.5vl:3b",
		Prompt:  "extract receipt from image",
		Images:  []string{"iVBORw0KGgoAAAANSUhEUg=="},
		Stream:  false,
		Format:  "json",
		Options: map[string]any{"temperature": 0.0},
	}
	result, err := callOllama(req)
	if err != nil {
		t.Fatalf("callOllama() error: %v", err)
	}
	if result != resp {
		t.Errorf("callOllama() = %q, want %q", result, resp)
	}
}

func TestCallOllama_VisionMulti_NetworkError(t *testing.T) {
	t.Setenv("OLLAMA_HOST", "http://127.0.0.1:1")
	req := OllamaRequest{Model: "test", Prompt: "test", Images: []string{"a"}}
	_, err := callOllama(req)
	if err == nil {
		t.Fatal("expected error for unreachable host")
	}
	if !strings.Contains(err.Error(), "ollama request") {
		t.Errorf("error should contain 'ollama request': %v", err)
	}
}

func TestCallOllama_VisionMulti_Non200(t *testing.T) {
	ts := mockOllamaServer(t, "error", 500)
	defer ts.Close()
	t.Setenv("OLLAMA_HOST", ts.URL)

	req := OllamaRequest{Model: "test", Prompt: "test", Images: []string{"a"}}
	_, err := callOllama(req)
	if err == nil {
		t.Fatal("expected error for non-200")
	}
	if !strings.Contains(err.Error(), "ollama status") {
		t.Errorf("error should contain 'ollama status': %v", err)
	}
}

func TestCallOllama_VisionMulti_EmptyResponse(t *testing.T) {
	ts := mockOllamaServerEmptyResponse(t)
	defer ts.Close()
	t.Setenv("OLLAMA_HOST", ts.URL)

	req := OllamaRequest{Model: "test", Prompt: "test", Images: []string{"a"}}
	_, err := callOllama(req)
	if err == nil {
		t.Fatal("expected error for empty response")
	}
	if !strings.Contains(err.Error(), "empty response") {
		t.Errorf("error should contain 'empty response': %v", err)
	}
}

// routeHandlerServer creates an httptest.Server that wraps routeHandler
// by converting standard http requests to fasthttp.RequestCtx calls.
func routeHandlerServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		defer r.Body.Close()

		fctx := &fasthttp.RequestCtx{}
		fctx.Request.URI().SetPath(r.URL.Path)
		fctx.Request.Header.SetMethod(r.Method)
		fctx.Request.Header.Set("Content-Type", r.Header.Get("Content-Type"))
		fctx.Request.SetBody(body)

		// For multipart requests, let fasthttp parse lazily via ctx.FormFile()
		ct := r.Header.Get("Content-Type")
		if strings.HasPrefix(ct, "multipart/") {
			boundary := extractBoundary(ct)
			if boundary != "" {
				fctx.Request.Header.Set("Content-Type", "multipart/form-data; boundary="+boundary)
			}
		}

		routeHandler(fctx)

		w.WriteHeader(fctx.Response.StatusCode())
		w.Write(fctx.Response.Body())
	}))
}

func extractBoundary(ct string) string {
	for _, p := range strings.Split(ct, ";") {
		p = strings.TrimSpace(p)
		if strings.HasPrefix(p, "boundary=") {
			return strings.Trim(p[len("boundary="):], `"`)
		}
	}
	return ""
}

func TestRouteHandler_Routing(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		path       string
		wantStatus int
	}{
		{"GET /unknown", "GET", "/unknown", fasthttp.StatusNotFound},
		{"DELETE /process", "DELETE", "/process", fasthttp.StatusNotFound},
		{"GET /process", "GET", "/process", fasthttp.StatusNotFound},
		{"POST /health", "POST", "/health", fasthttp.StatusNotFound},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fctx := &fasthttp.RequestCtx{}
			fctx.Request.URI().SetPath(tt.path)
			fctx.Request.Header.SetMethod(tt.method)
			routeHandler(fctx)

			if fctx.Response.StatusCode() != tt.wantStatus {
				t.Errorf("%s: status = %d, want %d. Body: %s", tt.name, fctx.Response.StatusCode(), tt.wantStatus, string(fctx.Response.Body()))
			}
		})
	}
}

func TestHealth_Mocked(t *testing.T) {
	// Create a stub script that succeeds
	tmpDir := t.TempDir()
	stubScript := filepath.Join(tmpDir, "stub")
	f, err := os.Create(stubScript)
	if err != nil {
		t.Fatal(err)
	}
	f.WriteString("#!/bin/sh\nexit 0\n")
	f.Close()
	os.Chmod(stubScript, 0755)

	orig := execCmd
	execCmd = func(name string, args ...string) *exec.Cmd {
		return exec.Command(stubScript, args...)
	}
	defer func() { execCmd = orig }()

	fctx := &fasthttp.RequestCtx{}
	fctx.Request.URI().SetPath("/health")
	fctx.Request.Header.SetMethod("GET")
	health(fctx)

	if fctx.Response.StatusCode() != fasthttp.StatusOK {
		t.Errorf("health status = %d, want %d. Body: %s", fctx.Response.StatusCode(), fasthttp.StatusOK, string(fctx.Response.Body()))
	}

	ct := string(fctx.Response.Header.ContentType())
	if ct != "application/json" {
		t.Errorf("content-type = %q, want %q", ct, "application/json")
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(fctx.Response.Body(), &resp); err != nil {
		t.Errorf("response body is not valid JSON: %v. Body: %s", err, string(fctx.Response.Body()))
	}
}

func TestHealth_MockedFailure(t *testing.T) {
	// Create a stub script that fails
	tmpDir := t.TempDir()
	stubScript := filepath.Join(tmpDir, "stub")
	f, err := os.Create(stubScript)
	if err != nil {
		t.Fatal(err)
	}
	f.WriteString("#!/bin/sh\nexit 1\n")
	f.Close()
	os.Chmod(stubScript, 0755)

	orig := execCmd
	execCmd = func(name string, args ...string) *exec.Cmd {
		return exec.Command(stubScript, args...)
	}
	defer func() { execCmd = orig }()

	fctx := &fasthttp.RequestCtx{}
	fctx.Request.URI().SetPath("/health")
	fctx.Request.Header.SetMethod("GET")
	health(fctx)

	if fctx.Response.StatusCode() != fasthttp.StatusInternalServerError {
		t.Errorf("health status = %d, want %d. Body: %s", fctx.Response.StatusCode(), fasthttp.StatusInternalServerError, string(fctx.Response.Body()))
	}
}

func TestResizeImage_NormalWide(t *testing.T) {
	tmp := t.TempDir()
	inPath := filepath.Join(tmp, "wide.png")
	outPath := filepath.Join(tmp, "out.jpg")

	img := image.NewRGBA(image.Rect(0, 0, 1200, 400))
	img.Set(0, 0, color.RGBA{R: 0, G: 0, B: 255, A: 255})
	f, err := os.Create(inPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		f.Close()
		t.Fatal(err)
	}
	f.Close()

	if err := resizeImage(inPath, outPath); err != nil {
		t.Fatalf("resizeImage error: %v", err)
	}

	outFile, err := os.Open(outPath)
	if err != nil {
		t.Fatal(err)
	}
	defer outFile.Close()
	cfg, _, err := image.DecodeConfig(outFile)
	if err != nil {
		t.Fatal(err)
	}

	if cfg.Width > 800 {
		t.Errorf("width = %d, want <= 800", cfg.Width)
	}
	if cfg.Height > 800 {
		t.Errorf("height = %d, want <= 800", cfg.Height)
	}
}

func TestResizeImage_Square(t *testing.T) {
	tmp := t.TempDir()
	inPath := filepath.Join(tmp, "square.png")
	outPath := filepath.Join(tmp, "out.jpg")

	img := image.NewRGBA(image.Rect(0, 0, 500, 500))
	img.Set(0, 0, color.RGBA{R: 255, G: 255, B: 0, A: 255})
	f, err := os.Create(inPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		f.Close()
		t.Fatal(err)
	}
	f.Close()

	if err := resizeImage(inPath, outPath); err != nil {
		t.Fatalf("resizeImage error: %v", err)
	}

	outFile, err := os.Open(outPath)
	if err != nil {
		t.Fatal(err)
	}
	defer outFile.Close()
	cfg, _, err := image.DecodeConfig(outFile)
	if err != nil {
		t.Fatal(err)
	}

	if cfg.Width != 500 || cfg.Height != 500 {
		t.Errorf("dimensions = %dx%d, want 500x500", cfg.Width, cfg.Height)
	}
}

func TestResizeImage_ZeroDimensions(t *testing.T) {
	tmp := t.TempDir()
	inPath := filepath.Join(tmp, "empty.png")
	outPath := filepath.Join(tmp, "out.jpg")

	img := image.NewRGBA(image.Rect(0, 0, 0, 0))
	f, err := os.Create(inPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(f, img); err != nil {
		t.Skip("zero-dim PNG encoding failed")
	}
	f.Close()

	err = resizeImage(inPath, outPath)
	if err == nil {
		t.Error("expected error for zero-dimension image")
	}
}

func TestProcess_SupportedMimes(t *testing.T) {
	testCases := []struct {
		filename  string
		payload   []byte
		wantMIME  string
		wantValid bool
	}{
		{"receipt.heic", []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'h', 'e', 'i', 'c', ' ', ' ', ' ', ' '}, "image/heic", false},
		{"receipt.heif", []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'm', 'p', '4', ' ', ' ', ' ', ' ', ' '}, "image/heic", false},
		{"image.tif", []byte{0, 0, 'I', 'I', 42, 0, 8, 0, 0, 0, 4, 0, 1, 254}, "image/tiff", true},
		{"image.tiff", []byte{0, 0, 'I', 'I', 42, 0, 8, 0, 0, 0, 4, 0, 1, 254}, "image/tiff", true},
	}

	for _, tc := range testCases {
		t.Run(tc.filename, func(t *testing.T) {
			var body bytes.Buffer
			w := multipart.NewWriter(&body)
			fw, err := w.CreateFormFile("document", tc.filename)
			if err != nil {
				t.Fatal(err)
			}
			fw.Write(tc.payload)
			w.Close()

			mr := multipart.NewReader(&body, w.Boundary())
			form, err := mr.ReadForm(1 << 24)
			if err != nil {
				t.Skip("form parse failed: " + err.Error())
			}
			defer form.RemoveAll()

			fh := form.File["document"][0]
			gotMIME, err := resolveUploadMIME(fh)
			if err != nil {
				t.Fatalf("resolveUploadMIME error: %v", err)
			}
			if gotMIME != tc.wantMIME {
				t.Errorf("resolveUploadMIME(%q) = %q, want %q", tc.filename, gotMIME, tc.wantMIME)
			}

			err = validateUpload(int64(len(tc.payload)), gotMIME)
			if (err == nil) != tc.wantValid {
				t.Errorf("validateUpload(%q) err=%v, wantValid=%v", gotMIME, err, tc.wantValid)
			}
		})
	}
}

func TestProcess_InvalidMIME(t *testing.T) {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fw, err := w.CreateFormFile("document", "evil.pdf")
	if err != nil {
		t.Fatal(err)
	}
	fw.Write([]byte("not a pdf, just text"))
	w.Close()

	mr := multipart.NewReader(&body, w.Boundary())
	form, err := mr.ReadForm(1 << 24)
	if err != nil {
		t.Skip("form parse failed: " + err.Error())
	}
	defer form.RemoveAll()

	fh := form.File["document"][0]
	gotMIME, err := resolveUploadMIME(fh)
	if err != nil {
		t.Fatalf("resolveUploadMIME error: %v", err)
	}
	if gotMIME == "application/pdf" {
		t.Errorf("resolveUploadMIME should not return PDF for text content, got %q", gotMIME)
	}
	if err := validateUpload(20, gotMIME); err == nil {
		t.Error("validateUpload should reject text/plain")
	}
}

func TestProcess_FileTooLarge(t *testing.T) {
	err := validateUpload(maxUploadSize+1, "image/jpeg")
	if err == nil {
		t.Fatal("expected error for oversized file")
	}
	if !strings.Contains(err.Error(), "file too large") {
		t.Errorf("error should contain 'file too large': %v", err)
	}
}

func TestDetectMIME_ReadError(t *testing.T) {
	_, err := detectMIME(strings.NewReader(""))
	if err != nil {
		t.Errorf("detectMIME empty reader: unexpected error: %v", err)
	}
}

type actualErrorReader struct{}

func (er *actualErrorReader) Read(p []byte) (int, error) {
	return 0, io.ErrUnexpectedEOF
}

func TestDetectMIME_ActualError(t *testing.T) {
	er := &actualErrorReader{}
	_, err := detectMIME(er)
	if err == nil {
		t.Fatal("expected error from detectMIME with real error")
	}
}

func TestResolveUploadMIME_TIFFExtension(t *testing.T) {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fw, err := w.CreateFormFile("document", "image.tif")
	if err != nil {
		t.Fatal(err)
	}
	fw.Write([]byte{0, 0, 'I', 'I', 42, 0})
	w.Close()

	mr := multipart.NewReader(&body, w.Boundary())
	form, err := mr.ReadForm(1 << 24)
	if err != nil {
		t.Skip("form parse failed: " + err.Error())
	}
	defer form.RemoveAll()

	fh := form.File["document"][0]
	gotMIME, err := resolveUploadMIME(fh)
	if err != nil {
		t.Fatalf("resolveUploadMIME error: %v", err)
	}
	if gotMIME != "image/tiff" {
		t.Errorf("resolveUploadMIME(.tif) = %q, want %q", gotMIME, "image/tiff")
	}
}

func TestResolveUploadMIME_BMPExtension(t *testing.T) {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fw, err := w.CreateFormFile("document", "image.bmp")
	if err != nil {
		t.Fatal(err)
	}
	fw.Write([]byte("BM"))
	w.Close()

	mr := multipart.NewReader(&body, w.Boundary())
	form, err := mr.ReadForm(1 << 24)
	if err != nil {
		t.Skip("form parse failed: " + err.Error())
	}
	defer form.RemoveAll()

	fh := form.File["document"][0]
	gotMIME, err := resolveUploadMIME(fh)
	if err != nil {
		t.Fatalf("resolveUploadMIME error: %v", err)
	}
	if gotMIME != "image/bmp" {
		t.Errorf("resolveUploadMIME(.bmp) = %q, want %q", gotMIME, "image/bmp")
	}
}

func TestResolveUploadMIME_HeaderFallback(t *testing.T) {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	_, err := w.CreateFormFile("document", "receipt.jpg")
	if err != nil {
		t.Fatal(err)
	}
	w.Close()

	mr := multipart.NewReader(&body, w.Boundary())
	form, err := mr.ReadForm(1 << 24)
	if err != nil {
		t.Skip("form parse failed: " + err.Error())
	}
	defer form.RemoveAll()

	fh := form.File["document"][0]
	gotMIME, err := resolveUploadMIME(fh)
	if err != nil {
		t.Fatalf("resolveUploadMIME error: %v", err)
	}
	_ = gotMIME
}

func TestRunOCR(t *testing.T) {
	// runOCR is a wrapper around runTesseract — test with a nonexistent file
	// to exercise the function path regardless of whether tesseract is installed
	tmpDir := t.TempDir()
	badPath := filepath.Join(tmpDir, "nonexistent.png")

	_, err := runOCR(badPath)
	if err == nil {
		t.Error("expected error for nonexistent file")
	}
	if !strings.Contains(err.Error(), "tesseract") {
		t.Errorf("error should contain 'tesseract': %v", err)
	}
}

func TestRunTesseract_NotFound(t *testing.T) {
	tmpDir := t.TempDir()
	badPath := filepath.Join(tmpDir, "nonexistent.png")

	_, err := runTesseract(badPath)
	if err == nil {
		t.Error("expected error for nonexistent file")
	}
	if !strings.Contains(err.Error(), "tesseract") {
		t.Errorf("error should contain 'tesseract': %v", err)
	}
}

func TestExtractPDFText_NotFound(t *testing.T) {
	tmpDir := t.TempDir()
	badPath := filepath.Join(tmpDir, "nonexistent.pdf")

	result := extractPDFText(badPath)
	if result != "" {
		t.Errorf("extractPDFText(nonexistent) = %q, want empty string", result)
	}
}

func TestExtractPDFText_EmptyOutput(t *testing.T) {
	if _, err := exec.LookPath("pdftotext"); err != nil {
		t.Skip("pdftotext not installed")
	}

	tmpDir := t.TempDir()
	pdfPath := filepath.Join(tmpDir, "blank.pdf")
	os.WriteFile(pdfPath, createPdf(), 0644)

	result := extractPDFText(pdfPath)
	_ = result
}

func TestConvertPDFToImages_NotFound(t *testing.T) {
	tmpDir := t.TempDir()
	badPath := filepath.Join(tmpDir, "nonexistent.pdf")

	_, err := convertPDFToImages(badPath, "output")
	if err == nil {
		t.Error("expected error for nonexistent PDF")
	}
	if !strings.Contains(err.Error(), "pdftoppm") {
		t.Errorf("error should contain 'pdftoppm': %v", err)
	}
}

func TestConvertPDFToImages_NoPages(t *testing.T) {
	if _, err := exec.LookPath("pdftoppm"); err != nil {
		t.Skip("pdftoppm not installed")
	}

	tmpDir := t.TempDir()
	pdfPath := filepath.Join(tmpDir, "empty.pdf")
	os.WriteFile(pdfPath, []byte("%%EOF\n"), 0644)

	pages, err := convertPDFToImages(pdfPath, filepath.Join(tmpDir, "out"))
	_ = pages
	_ = err
}

func TestValidateOllamaJSON_OutermostExtraction(t *testing.T) {
	input := `Some text { "timestamp": "", "vendor": "X", "description": "Y", "amount": 1, "taxAmount": 0, "currencyCode": "USD", "tender": "CARD", "chartAccountId": null } more text`
	result, err := ValidateOllamaJSON(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var obj map[string]interface{}
	if err := json.Unmarshal([]byte(result), &obj); err != nil {
		t.Fatalf("result is not valid JSON: %v (result: %s)", err, result)
	}
	if obj["vendor"] != "X" {
		t.Errorf("vendor = %v, want 'X'", obj["vendor"])
	}
}

func TestValidateOllamaJSON_RepairPath(t *testing.T) {
	input := "{'timestamp':'2026-01-01T00:00:00Z','vendor':'Test','description':'Item','amount':5,'taxAmount':0,'currencyCode':'USD','tender':'CARD','chartAccountId':null,}"
	result, err := ValidateOllamaJSON(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var obj map[string]interface{}
	if err := json.Unmarshal([]byte(result), &obj); err != nil {
		t.Fatalf("result is not valid JSON: %v", err)
	}
}

func TestValidateOllamaJSON_MalformedAfterRecovery(t *testing.T) {
	input := "this is not json at all {{{"
	_, err := ValidateOllamaJSON(input)
	if err == nil {
		t.Fatal("expected error for completely malformed input")
	}
}

func TestProcess_ImageJpegPath_FullFlow(t *testing.T) {
	tmpDir := t.TempDir()
	inPath := filepath.Join(tmpDir, "test.jpg")
	jpegData := createJpeg(t, 400, 300)
	os.WriteFile(inPath, jpegData, 0644)

	outPath := filepath.Join(tmpDir, "out.jpg")
	err := resizeImage(inPath, outPath)
	if err != nil {
		t.Fatalf("resizeImage failed: %v", err)
	}

	outData, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("read output: %v", err)
	}
	if len(outData) == 0 {
		t.Fatal("output file is empty")
	}

	cfg, _, err := image.DecodeConfig(bytes.NewReader(outData))
	if err != nil {
		t.Fatalf("decode output: %v", err)
	}
	if cfg.Width > 800 || cfg.Height > 2400 {
		t.Errorf("dimensions %dx%d exceed limits", cfg.Width, cfg.Height)
	}
}

func TestProcess_PdfTextPath_MimeCheck(t *testing.T) {
	pdfData := createPdf()

	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fw, err := w.CreateFormFile("document", "receipt.pdf")
	if err != nil {
		t.Fatal(err)
	}
	fw.Write(pdfData)
	w.Close()

	mr := multipart.NewReader(&body, w.Boundary())
	form, err := mr.ReadForm(1 << 24)
	if err != nil {
		t.Skip("form parse failed: " + err.Error())
	}
	defer form.RemoveAll()

	fh := form.File["document"][0]
	gotMIME, err := resolveUploadMIME(fh)
	if err != nil {
		t.Fatalf("resolveUploadMIME error: %v", err)
	}
	if gotMIME != "application/pdf" {
		t.Errorf("resolveUploadMIME(.pdf) = %q, want %q", gotMIME, "application/pdf")
	}

	if err := validateUpload(int64(len(pdfData)), gotMIME); err != nil {
		t.Errorf("validateUpload(pdf) failed: %v", err)
	}
}

func TestValidateUpload_WebpAndBmp(t *testing.T) {
	tests := []struct {
		mime string
		want bool
	}{
		{"image/webp", false},
		{"image/bmp", false},
		{"image/tiff", false},
		{"image/heic", true}, // HEIC must be converted upstream before file-processor
	}
	for _, tt := range tests {
		t.Run(tt.mime, func(t *testing.T) {
			err := validateUpload(1000, tt.mime)
			gotErr := err != nil
			if gotErr != tt.want {
				t.Errorf("validateUpload(%q): gotErr=%v, wantErr=%v", tt.mime, gotErr, tt.want)
			}
		})
	}
}

func TestCompactOCRText_Boundary(t *testing.T) {
	exact := strings.Repeat("A", 4000)
	result := compactOCRText(exact)
	if len(result) != 4000 {
		t.Errorf("compactOCRText(4000) length = %d, want 4000", len(result))
	}

	over := strings.Repeat("A", 4001)
	result = compactOCRText(over)
	if len(result) != 4000 {
		t.Errorf("compactOCRText(4001) length = %d, want 4000", len(result))
	}
}

func TestMainConstants(t *testing.T) {
	if maxUploadSize != 20<<20 {
		t.Errorf("maxUploadSize = %d, want %d", maxUploadSize, 20<<20)
	}
}

func TestFasthttpRequestContext(t *testing.T) {
	fctx := &fasthttp.RequestCtx{}
	fctx.Request.URI().SetPath("/test")
	fctx.Request.Header.SetMethod("GET")

	if string(fctx.Path()) != "/test" {
		t.Errorf("Path() = %q, want /test", string(fctx.Path()))
	}
	if !fctx.IsGet() {
		t.Error("IsGet() should be true for GET")
	}
	fctx.Request.URI().SetPath("/other")
	if string(fctx.Path()) != "/other" {
		t.Errorf("Path() after set = %q, want /other", string(fctx.Path()))
	}
}

func TestRouteHandler_HealthOKPath(t *testing.T) {
	ts := routeHandlerServer(t)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/health")
	if err != nil {
		t.Fatalf("GET /health: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == fasthttp.StatusNotFound {
		t.Error("routeHandler did not route /health correctly: got 404")
	}
}

func TestResolveUploadMIME_HEIFExtension(t *testing.T) {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fw, err := w.CreateFormFile("document", "image.heif")
	if err != nil {
		t.Fatal(err)
	}
	fw.Write([]byte{0, 0, 0, 20, 'f', 't', 'y', 'p', ' ', ' ', ' ', ' '})
	w.Close()

	mr := multipart.NewReader(&body, w.Boundary())
	form, err := mr.ReadForm(1 << 24)
	if err != nil {
		t.Skip("form parse failed: " + err.Error())
	}
	defer form.RemoveAll()

	fh := form.File["document"][0]
	gotMIME, err := resolveUploadMIME(fh)
	if err != nil {
		t.Fatalf("resolveUploadMIME error: %v", err)
	}
	if gotMIME != "image/heic" {
		t.Errorf("resolveUploadMIME(.heif) = %q, want %q", gotMIME, "image/heic")
	}
}

func TestResolveUploadMIME_OctetStreamWithExtension(t *testing.T) {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fw, err := w.CreateFormFile("document", "image.heic")
	if err != nil {
		t.Fatal(err)
	}
	fw.Write([]byte{0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07})
	w.Close()

	mr := multipart.NewReader(&body, w.Boundary())
	form, err := mr.ReadForm(1 << 24)
	if err != nil {
		t.Skip("form parse failed: " + err.Error())
	}
	defer form.RemoveAll()

	fh := form.File["document"][0]
	gotMIME, err := resolveUploadMIME(fh)
	if err != nil {
		t.Fatalf("resolveUploadMIME error: %v", err)
	}
	if gotMIME != "image/heic" {
		t.Errorf("resolveUploadMIME(.heic with octet-stream sniff) = %q, want %q", gotMIME, "image/heic")
	}
}

func TestValidateUpload_MIMEWithParams(t *testing.T) {
	tests := []struct {
		mime    string
		wantErr bool
	}{
		{"image/jpeg; charset=binary", false},
		{"application/pdf; version=1.7", false},
		{"  image/jpeg  ", false},
	}
	for _, tt := range tests {
		t.Run(tt.mime, func(t *testing.T) {
			err := validateUpload(1000, tt.mime)
			gotErr := err != nil
			if gotErr != tt.wantErr {
				t.Errorf("validateUpload(%q): gotErr=%v, wantErr=%v", tt.mime, gotErr, tt.wantErr)
			}
		})
	}
}

func TestCleanAIJSON_SingleBrace(t *testing.T) {
	input := `{ "vendor": "Test"`
	result := CleanAIJSON(input)
	if result != input {
		t.Errorf("CleanAIJSON(open brace only) = %q, want %q", result, input)
	}
}

func TestCleanAIJSON_NoBraces(t *testing.T) {
	input := "Just plain text with no braces"
	result := CleanAIJSON(input)
	if result != input {
		t.Errorf("CleanAIJSON(no braces) = %q, want %q", result, input)
	}
}

func TestIsolateOutermostJSON_NoBraces(t *testing.T) {
	result := isolateOutermostJSON("no braces here")
	if result != "" {
		t.Errorf("isolateOutermostJSON(no braces) = %q, want empty", result)
	}
}

func TestIsolateOutermostJSON_Empty(t *testing.T) {
	result := isolateOutermostJSON("")
	if result != "" {
		t.Errorf("isolateOutermostJSON(empty) = %q, want empty", result)
	}
}

func TestConvertPDFToImages_MockedSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	stubScript := filepath.Join(tmpDir, "stub")
	f, err := os.Create(stubScript)
	if err != nil {
		t.Fatal(err)
	}
	// pdftoppm stub: create fake page files
	f.WriteString("#!/bin/sh\n" +
		"# Args: -png -r 300 <pdf> <base>\n" +
		"# Find the base name (last arg)\n" +
		"base=\"\"\n" +
		"for a in \"$@\"; do\n" +
		"  case \"$a\" in -png|-r) continue ;; esac\n" +
		"  if [[ \"$a\" == /* ]]; then base=\"$a\"; fi\n" +
		"done\n" +
		"touch \"${base}-1.png\"\n")
	f.Close()
	os.Chmod(stubScript, 0755)

	orig := execCmd
	execCmd = func(name string, args ...string) *exec.Cmd {
		return exec.Command(stubScript, args...)
	}
	defer func() { execCmd = orig }()

	pdfPath := filepath.Join(tmpDir, "test.pdf")
	os.WriteFile(pdfPath, []byte("fake pdf"), 0644)
	baseOut := filepath.Join(tmpDir, "out")

	pages, err := convertPDFToImages(pdfPath, baseOut)
	if err != nil {
		t.Fatalf("convertPDFToImages error: %v", err)
	}
	if len(pages) == 0 {
		t.Fatal("expected at least one page")
	}
}

func TestConvertPDFToImages_MockedNoPages(t *testing.T) {
	tmpDir := t.TempDir()
	stubScript := filepath.Join(tmpDir, "stub")
	f, err := os.Create(stubScript)
	if err != nil {
		t.Fatal(err)
	}
	// Stub that succeeds but creates no output files
	f.WriteString("#!/bin/sh\nexit 0\n")
	f.Close()
	os.Chmod(stubScript, 0755)

	orig := execCmd
	execCmd = func(name string, args ...string) *exec.Cmd {
		return exec.Command(stubScript, args...)
	}
	defer func() { execCmd = orig }()

	pdfPath := filepath.Join(tmpDir, "test.pdf")
	os.WriteFile(pdfPath, []byte("fake pdf"), 0644)
	baseOut := filepath.Join(tmpDir, "out")

	_, err = convertPDFToImages(pdfPath, baseOut)
	if err == nil {
		t.Fatal("expected error for no pages")
	}
	if !strings.Contains(err.Error(), "no output pages") {
		t.Errorf("error should contain 'no output pages': %v", err)
	}
}

func TestConvertPDFToImages_MockedFailure(t *testing.T) {
	tmpDir := t.TempDir()
	stubScript := filepath.Join(tmpDir, "stub")
	f, err := os.Create(stubScript)
	if err != nil {
		t.Fatal(err)
	}
	f.WriteString("#!/bin/sh\necho 'conversion failed' >&2\nexit 1\n")
	f.Close()
	os.Chmod(stubScript, 0755)

	orig := execCmd
	execCmd = func(name string, args ...string) *exec.Cmd {
		return exec.Command(stubScript, args...)
	}
	defer func() { execCmd = orig }()

	pdfPath := filepath.Join(tmpDir, "test.pdf")
	os.WriteFile(pdfPath, []byte("fake pdf"), 0644)
	baseOut := filepath.Join(tmpDir, "out")

	_, err = convertPDFToImages(pdfPath, baseOut)
	if err == nil {
		t.Fatal("expected error from pdftoppm failure")
	}
	if !strings.Contains(err.Error(), "pdftoppm") {
		t.Errorf("error should contain 'pdftoppm': %v", err)
	}
}

func TestExtractPDFText_MockedSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	stubScript := filepath.Join(tmpDir, "stub")
	f, err := os.Create(stubScript)
	if err != nil {
		t.Fatal(err)
	}
	// pdftotext stub: output text to stdout
	f.WriteString("#!/bin/sh\necho 'Store Name\nItem 1    $5.00\nItem 2    $3.00\nTotal   $8.00'\n")
	f.Close()
	os.Chmod(stubScript, 0755)

	orig := execCmd
	execCmd = func(name string, args ...string) *exec.Cmd {
		return exec.Command(stubScript, args...)
	}
	defer func() { execCmd = orig }()

	pdfPath := filepath.Join(tmpDir, "test.pdf")
	os.WriteFile(pdfPath, []byte("fake pdf"), 0644)

	result := extractPDFText(pdfPath)
	if result == "" {
		t.Fatal("expected non-empty text output")
	}
	// Should be compacted (whitespace collapsed)
	if strings.Contains(result, "    $") {
		t.Errorf("output should be compacted (no multiple spaces): %q", result)
	}
}

func TestExtractPDFText_MockedError(t *testing.T) {
	tmpDir := t.TempDir()
	stubScript := filepath.Join(tmpDir, "stub")
	f, err := os.Create(stubScript)
	if err != nil {
		t.Fatal(err)
	}
	f.WriteString("#!/bin/sh\nexit 1\n")
	f.Close()
	os.Chmod(stubScript, 0755)

	orig := execCmd
	execCmd = func(name string, args ...string) *exec.Cmd {
		return exec.Command(stubScript, args...)
	}
	defer func() { execCmd = orig }()

	pdfPath := filepath.Join(tmpDir, "test.pdf")
	os.WriteFile(pdfPath, []byte("fake pdf"), 0644)

	result := extractPDFText(pdfPath)
	if result != "" {
		t.Errorf("expected empty string on error, got: %q", result)
	}
}

// runFasthttpProcess creates a multipart request body and calls process() directly.
func runFasthttpProcess(t *testing.T, filename string, payload []byte, prompt string) *fasthttp.RequestCtx {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fw, err := w.CreateFormFile("document", filename)
	if err != nil {
		t.Fatal(err)
	}
	fw.Write(payload)
	if prompt != "" {
		w.WriteField("prompt", prompt)
	}
	w.Close()

	fctx := &fasthttp.RequestCtx{}
	fctx.Request.URI().SetPath("/process")
	fctx.Request.Header.SetMethod("POST")
	fctx.Request.Header.SetContentType(w.FormDataContentType())
	fctx.Request.SetBody(body.Bytes())

	return fctx
}

func TestProcess_NoFile(t *testing.T) {
	// POST /process with no form file → bad request
	fctx := &fasthttp.RequestCtx{}
	fctx.Request.URI().SetPath("/process")
	fctx.Request.Header.SetMethod("POST")
	fctx.Request.Header.SetContentType("application/json")
	fctx.Request.SetBody([]byte(`{}`))

	routeHandler(fctx)

	if fctx.Response.StatusCode() != fasthttp.StatusBadRequest {
		t.Errorf("status = %d, want %d. Body: %s", fctx.Response.StatusCode(), fasthttp.StatusBadRequest, string(fctx.Response.Body()))
	}
}

func TestProcess_TooLarge(t *testing.T) {
	// POST /process with oversized file → bad request
	over := make([]byte, maxUploadSize+1)
	os.WriteFile("/tmp/oversized_test.bin", over, 0644)
	defer os.Remove("/tmp/oversized_test.bin")

	data, err := os.ReadFile("/tmp/oversized_test.bin")
	if err != nil {
		t.Fatal(err)
	}

	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fw, _ := w.CreateFormFile("document", "big.jpg")
	fw.Write(data)
	w.Close()

	fctx := &fasthttp.RequestCtx{}
	fctx.Request.URI().SetPath("/process")
	fctx.Request.Header.SetMethod("POST")
	fctx.Request.Header.SetContentType(w.FormDataContentType())
	fctx.Request.SetBody(body.Bytes())

	routeHandler(fctx)

	if fctx.Response.StatusCode() != fasthttp.StatusBadRequest {
		t.Errorf("status = %d, want %d. Body: %s", fctx.Response.StatusCode(), fasthttp.StatusBadRequest, string(fctx.Response.Body()))
	}
}

func TestProcess_Image_OK(t *testing.T) {
	// Full image path: resize → tesseract (mocked) → Ollama (mocked)
	tmpDir := t.TempDir()

	// Stub for tesseract: output OCR text
	tessScript := filepath.Join(tmpDir, "tess")
	f, _ := os.Create(tessScript)
	f.WriteString("#!/bin/sh\necho 'STORE_NAME\nItem 1    $5.00'\n")
	f.Close()
	os.Chmod(tessScript, 0755)

	origExec := execCmd
	execCmd = func(name string, args ...string) *exec.Cmd {
		return exec.Command(tessScript, args...)
	}
	defer func() { execCmd = origExec }()

	// Ollama mock: return valid JSON response
	ollamaResp := `{"timestamp":"2026-01-01T00:00:00Z","vendor":"MockStore","description":"Item","amount":5.00,"taxAmount":0.50,"currencyCode":"USD","tender":"CARD","chartAccountId":null}`
	ollamaHost := mockOllamaServer(t, ollamaResp, fasthttp.StatusOK)
	defer ollamaHost.Close()
	t.Setenv("OLLAMA_HOST", ollamaHost.URL)

	jpegData := createJpeg(t, 400, 300)
	fctx := runFasthttpProcess(t, "receipt.jpg", jpegData, "")
	routeHandler(fctx)

	if fctx.Response.StatusCode() != fasthttp.StatusOK {
		t.Errorf("status = %d, want %d. Body: %s", fctx.Response.StatusCode(), fasthttp.StatusOK, string(fctx.Response.Body()))
	}

	// Verify response is valid JSON
	var result map[string]interface{}
	if err := json.Unmarshal(fctx.Response.Body(), &result); err != nil {
		t.Errorf("response body is not valid JSON: %v. Body: %s", err, string(fctx.Response.Body()))
	}
}

func TestProcess_PDF_TxtOk(t *testing.T) {
	// PDF path with sufficient pdftotext output: pdftotext → Ollama text model
	tmpDir := t.TempDir()

	// Stub for pdftotext: output sufficient text (>= 20 alphanum chars)
	pdftotextScript := filepath.Join(tmpDir, "pdftotext")
	f, _ := os.Create(pdftotextScript)
	f.WriteString("#!/bin/sh\necho 'Vendor Name\nWidget $10.00\nGadget $5.00\nTotal $15.00'\n")
	f.Close()
	os.Chmod(pdftotextScript, 0755)

	// Stub for tesseract (also needed by process for image fallback)
	tessScript := filepath.Join(tmpDir, "tess")
	f2, _ := os.Create(tessScript)
	f2.WriteString("#!/bin/sh\necho 'OCR text'\n")
	f2.Close()
	os.Chmod(tessScript, 0755)

	origExec := execCmd
	execCmd = func(name string, args ...string) *exec.Cmd {
		switch name {
		case "pdftotext":
			return exec.Command(pdftotextScript, args...)
		default:
			return exec.Command(tessScript, args...)
		}
	}
	defer func() { execCmd = origExec }()

	// Ollama mock for text model
	ollamaResp := `{"timestamp":"2026-01-01T00:00:00Z","vendor":"PDFVendor","description":"Widget","amount":10.00,"taxAmount":0,"currencyCode":"USD","tender":"CARD","chartAccountId":null}`
	ollamaHost := mockOllamaServer(t, ollamaResp, fasthttp.StatusOK)
	defer ollamaHost.Close()
	t.Setenv("OLLAMA_HOST", ollamaHost.URL)

	pdfData := createPdf()
	fctx := runFasthttpProcess(t, "receipt.pdf", pdfData, "")
	routeHandler(fctx)

	if fctx.Response.StatusCode() != fasthttp.StatusOK {
		t.Errorf("status = %d, want %d. Body: %s", fctx.Response.StatusCode(), fasthttp.StatusOK, string(fctx.Response.Body()))
	}

	var result map[string]interface{}
	if err := json.Unmarshal(fctx.Response.Body(), &result); err != nil {
		t.Errorf("response body is not valid JSON: %v. Body: %s", err, string(fctx.Response.Body()))
	}
	if v, ok := result["vendor"].(string); !ok || v != "PDFVendor" {
		t.Errorf("vendor = %v, want 'PDFVendor'", result["vendor"])
	}
}

func TestProcess_PDF_VisionFallback(t *testing.T) {
	// PDF path with insufficient pdftotext → vision model fallback
	tmpDir := t.TempDir()

	// Stub for pdftotext: output too little text (< 20 alphanum chars)
	pdftotextScript := filepath.Join(tmpDir, "pdftotext")
	f, _ := os.Create(pdftotextScript)
	f.WriteString("#!/bin/sh\necho 'garbled'\n")
	f.Close()
	os.Chmod(pdftotextScript, 0755)

	// Stub for pdftoppm: create valid 1x1 PNG using base64 decode
	pdftoppmScript := filepath.Join(tmpDir, "pdftoppm")
	f2, _ := os.Create(pdftoppmScript)
	// Minimal 1x1 red PNG
	pngB64 := "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
	f2.WriteString("#!/bin/sh\n" +
		"base=\"\"\n" +
		"for a in \"$@\"; do\n" +
		"  case \"$a\" in -png|-r) continue ;; esac\n" +
		"  if [[ \"$a\" == /* ]]; then base=\"$a\"; fi\n" +
		"done\n" +
		"echo '" + pngB64 + "' | base64 -d > \"${base}-1.png\"\n")
	f2.Close()
	os.Chmod(pdftoppmScript, 0755)

	// Failing stub for any other command (tesseract not needed in vision fallback path)
	failScript := filepath.Join(tmpDir, "fail")
	f3, _ := os.Create(failScript)
	f3.WriteString("#!/bin/sh\nexit 0\n")
	f3.Close()
	os.Chmod(failScript, 0755)

	origExec := execCmd
	execCmd = func(name string, args ...string) *exec.Cmd {
		switch name {
		case "pdftotext":
			return exec.Command(pdftotextScript, args...)
		case "pdftoppm":
			return exec.Command(pdftoppmScript, args...)
		default:
			return exec.Command(failScript, args...)
		}
	}
	defer func() { execCmd = origExec }()

	// Ollama mock for vision model
	ollamaResp := `{"timestamp":"","vendor":"VisionStore","description":"Receipt","amount":25.00,"taxAmount":2.00,"currencyCode":"USD","tender":"CASH","chartAccountId":null}`
	ollamaHost := mockOllamaServer(t, ollamaResp, fasthttp.StatusOK)
	defer ollamaHost.Close()
	t.Setenv("OLLAMA_HOST", ollamaHost.URL)

	pdfData := createPdf()
	fctx := runFasthttpProcess(t, "scanned.pdf", pdfData, "")
	routeHandler(fctx)

	if fctx.Response.StatusCode() != fasthttp.StatusOK {
		t.Errorf("status = %d, want %d. Body: %s", fctx.Response.StatusCode(), fasthttp.StatusOK, string(fctx.Response.Body()))
	}

	var result map[string]interface{}
	if err := json.Unmarshal(fctx.Response.Body(), &result); err != nil {
		t.Errorf("response body is not valid JSON: %v. Body: %s", err, string(fctx.Response.Body()))
	}
}

func TestProcess_PDF_NoOllama(t *testing.T) {
	// PDF with good pdftotext output but Ollama failure
	tmpDir := t.TempDir()

	pdftotextScript := filepath.Join(tmpDir, "pdftotext")
	f, _ := os.Create(pdftotextScript)
	f.WriteString("#!/bin/sh\necho 'Vendor\nWidget $10.00\nTotal $10.00'\n")
	f.Close()
	os.Chmod(pdftotextScript, 0755)

	tessScript := filepath.Join(tmpDir, "tess")
	f2, _ := os.Create(tessScript)
	f2.WriteString("#!/bin/sh\necho 'OCR text'\n")
	f2.Close()
	os.Chmod(tessScript, 0755)

	origExec := execCmd
	execCmd = func(name string, args ...string) *exec.Cmd {
		switch name {
		case "pdftotext":
			return exec.Command(pdftotextScript, args...)
		default:
			return exec.Command(tessScript, args...)
		}
	}
	defer func() { execCmd = origExec }()

	// Ollama returns error (non-200)
	ollamaHost := mockOllamaServer(t, "error", 503)
	defer ollamaHost.Close()
	t.Setenv("OLLAMA_HOST", ollamaHost.URL)

	pdfData := createPdf()
	fctx := runFasthttpProcess(t, "receipt.pdf", pdfData, "")
	routeHandler(fctx)

	if fctx.Response.StatusCode() != fasthttp.StatusInternalServerError {
		t.Errorf("status = %d, want %d. Body: %s", fctx.Response.StatusCode(), fasthttp.StatusInternalServerError, string(fctx.Response.Body()))
	}
}

func TestProcess_Image_OllamaBadJSON(t *testing.T) {
	// Image path where Ollama returns invalid JSON
	tmpDir := t.TempDir()

	tessScript := filepath.Join(tmpDir, "tess")
	f, _ := os.Create(tessScript)
	f.WriteString("#!/bin/sh\necho 'OCR text'\n")
	f.Close()
	os.Chmod(tessScript, 0755)

	origExec := execCmd
	execCmd = func(name string, args ...string) *exec.Cmd {
		return exec.Command(tessScript, args...)
	}
	defer func() { execCmd = origExec }()

	// Ollama returns garbled text that fails JSON validation
	ollamaHost := mockOllamaServer(t, "some text {{{no json here", fasthttp.StatusOK)
	defer ollamaHost.Close()
	t.Setenv("OLLAMA_HOST", ollamaHost.URL)

	jpegData := createJpeg(t, 400, 300)
	fctx := runFasthttpProcess(t, "receipt.jpg", jpegData, "")
	routeHandler(fctx)

	if fctx.Response.StatusCode() != fasthttp.StatusInternalServerError {
		t.Errorf("status = %d, want %d. Body: %s", fctx.Response.StatusCode(), fasthttp.StatusInternalServerError, string(fctx.Response.Body()))
	}
}

func TestProcess_OctetStreamWithPDFExtension(t *testing.T) {
	// File with .pdf extension — resolves to application/pdf MIME via extension fallback
	// when sniffed bytes match PDF magic or when header is application/octet-stream
	tmpDir := t.TempDir()

	pdftotextScript := filepath.Join(tmpDir, "pdftotext")
	f, _ := os.Create(pdftotextScript)
	f.WriteString("#!/bin/sh\necho 'Vendor\nWidget $10.00\nTotal $10.00'\n")
	f.Close()
	os.Chmod(pdftotextScript, 0755)

	tessScript := filepath.Join(tmpDir, "tess")
	f2, _ := os.Create(tessScript)
	f2.WriteString("#!/bin/sh\necho 'OCR'\n")
	f2.Close()
	os.Chmod(tessScript, 0755)

	origExec := execCmd
	execCmd = func(name string, args ...string) *exec.Cmd {
		switch name {
		case "pdftotext":
			return exec.Command(pdftotextScript, args...)
		default:
			return exec.Command(tessScript, args...)
		}
	}
	defer func() { execCmd = origExec }()

	ollamaHost := mockOllamaServer(t, `{"vendor":"OctetStore","amount":10,"taxAmount":0,"description":"test","timestamp":"","currencyCode":"USD","tender":"CARD","chartAccountId":null}`, fasthttp.StatusOK)
	defer ollamaHost.Close()
	t.Setenv("OLLAMA_HOST", ollamaHost.URL)

	// Create a valid minimal PDF so MIME sniffing succeeds
	pdfData := createPdf()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fw, _ := w.CreateFormFile("document", "file.pdf")
	fw.Write(pdfData)
	w.Close()

	fctx := &fasthttp.RequestCtx{}
	fctx.Request.URI().SetPath("/process")
	fctx.Request.Header.SetMethod("POST")
	fctx.Request.Header.SetContentType(w.FormDataContentType())
	fctx.Request.SetBody(body.Bytes())

	routeHandler(fctx)

	// Should pass validation and hit the PDF text path
	if fctx.Response.StatusCode() != fasthttp.StatusOK {
		t.Errorf("status = %d, want %d. Body: %s", fctx.Response.StatusCode(), fasthttp.StatusOK, string(fctx.Response.Body()))
	}
}

func TestRunTesseract_MockedSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	stub := filepath.Join(tmpDir, "tess")
	f, _ := os.Create(stub)
	f.WriteString("#!/bin/sh\necho 'Extracted text from image'\n")
	f.Close()
	os.Chmod(stub, 0755)

	orig := execCmd
	execCmd = func(name string, args ...string) *exec.Cmd {
		return exec.Command(stub, args...)
	}
	defer func() { execCmd = orig }()

	tmpImg := filepath.Join(tmpDir, "img.png")
	os.WriteFile(tmpImg, []byte("fake png"), 0644)

	result, err := runTesseract(tmpImg)
	if err != nil {
		t.Fatalf("runTesseract error: %v", err)
	}
	if result != "Extracted text from image\n" {
		t.Errorf("result = %q, want %q", result, "Extracted text from image\n")
	}
}

func TestRunOCR_MockedSuccess(t *testing.T) {
	tmpDir := t.TempDir()
	stub := filepath.Join(tmpDir, "tess")
	f, _ := os.Create(stub)
	f.WriteString("#!/bin/sh\necho 'OCR result'\n")
	f.Close()
	os.Chmod(stub, 0755)

	orig := execCmd
	execCmd = func(name string, args ...string) *exec.Cmd {
		return exec.Command(stub, args...)
	}
	defer func() { execCmd = orig }()

	tmpImg := filepath.Join(tmpDir, "img.png")
	os.WriteFile(tmpImg, []byte("fake png"), 0644)

	result, err := runOCR(tmpImg)
	if err != nil {
		t.Fatalf("runOCR error: %v", err)
	}
	if result != "OCR result\n" {
		t.Errorf("result = %q, want %q", result, "OCR result\n")
	}
}
