package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/disintegration/imaging"
	"github.com/valyala/fasthttp"
)

// OllamaRequest is the JSON body sent to Ollama's /api/generate endpoint.
type OllamaRequest struct {
	Model  string   `json:"model"`
	Prompt string   `json:"prompt"`
	Images []string `json:"images,omitempty"`
	Stream bool     `json:"stream"`
	Format string   `json:"format,omitempty"`
	Options any      `json:"options,omitempty"`
}

// OllamaVisionMultiRequest extends OllamaRequest for multi-image vision calls with supplemental OCR text.
type OllamaVisionMultiRequest struct {
	Model   string   `json:"model"`
	Prompt  string   `json:"prompt"`
	Images  []string `json:"images,omitempty"`
	Stream  bool     `json:"stream"`
	Format  string   `json:"format,omitempty"`
	Options any      `json:"options,omitempty"`
}

// upload limits protect against OOM and malicious uploads.
const (
	maxUploadSize   = 20 << 20 // 20 MB — generous for PDF receipts, tight enough to block abuse
	maxBase64Size   = 12 << 20 // ~12 MB base64 payload cap before encoding (before 4/3 expansion)
	allowedPDFMIME  = "application/pdf"
	allowedImgMIME  = "image/jpeg"
	allowedImgAltMIME = "image/png"
)

// detectMIME reads up to 512 bytes from r and returns the detected MIME type.
func detectMIME(r interface {
	Read(p []byte) (int, error)
}) (string, error) {
	var buf [512]byte
	n, err := r.Read(buf[:])
	if err != nil && err.Error() != "EOF" {
		return "", err
	}
	return http.DetectContentType(buf[:n]), nil
}

// validateUpload checks that the uploaded file meets size and MIME constraints.
// size is the actual byte count of the multipart file (fileHeader.Size).
func validateUpload(size int64, mime string) error {
	if size > maxUploadSize {
		return fmt.Errorf("file too large: %d bytes (max %d)", size, maxUploadSize)
	}
	if mime == allowedPDFMIME {
		return nil
	}
	// Image validation: check JPEG or PNG MIME types
	if mime == allowedImgMIME || mime == allowedImgAltMIME {
		return nil
	}
	return fmt.Errorf("unsupported MIME type: %q (expected %q PDF or %q/%q image)", mime, allowedPDFMIME, allowedImgMIME, allowedImgAltMIME)
}

const defaultTextPrompt = `You are a receipt data extractor. The following is raw OCR text extracted from a receipt.
Extract the expense details and return ONLY a valid JSON object with no explanation or markdown, matching this exact schema:
{
  "timestamp": "",
  "vendor": "",
  "description": "",
  "amount": 0.00,
  "taxAmount": 0.00,
  "currencyCode": "USD",
  "tender": "CARD",
  "chartAccountId": null
}
Rules:
- timestamp must be RFC3339 format (e.g. 2026-07-15T14:30:00Z). Use midnight UTC if no time is visible. Leave as "" if no date is found. NEVER invent a date.
- amount must be the TOTAL paid as a positive number with no currency symbol.
- taxAmount must be the total tax paid, as a number. Leave as 0 if not found.
- currencyCode must be the 3-letter currency code (e.g. USD, CAD, EUR). Default to USD if none is found.
- tender is the payment method: CARD, CASH, CHECK, TRANSFER, PAYPAL, VENMO, ZELLE, OTHER.
- chartAccountId should be null unless an active category ID is provided.
- vendor should be the store/business name (not the address).
- Leave vendor, description, or tender as empty strings if they cannot be determined.
- Leave amount as 0 if it cannot be determined.
`

const defaultVisionPrompt = `You are a receipt data extractor. Look at this receipt image carefully and extract the expense details.
Return ONLY a valid JSON object with no explanation or markdown, matching this exact schema:
{
  "timestamp": "",
  "vendor": "",
  "description": "",
  "amount": 0.00,
  "taxAmount": 0.00,
  "currencyCode": "USD",
  "tender": "CARD",
  "chartAccountId": null
}
Rules:
- timestamp must be RFC3339 format (e.g. 2026-07-15T14:30:00Z). Use midnight UTC if no time is visible. Leave as "" if no date is found. NEVER invent a date.
- amount must be the final total paid as a positive number with no currency symbol.
- taxAmount must be the total tax paid, as a number. Leave as 0 if not found.
- currencyCode must be the 3-letter currency code (e.g. USD, CAD, EUR). Default to USD if none is found.
- tender is the payment method: CARD, CASH, CHECK, TRANSFER, PAYPAL, VENMO, ZELLE, OTHER.
- chartAccountId should be null unless an active category ID is provided.
- vendor should be the store/business name (not the address).
- Leave vendor, description, or tender as empty strings if they cannot be determined.
- Leave amount as 0 if it cannot be determined.`

func main() {
	fasthttp.ListenAndServe(":8081", routeHandler)
}

func ollamaURL() string {
	host := os.Getenv("OLLAMA_HOST")
	if host == "" {
		host = "127.0.0.1:11434"
	}
	if !strings.HasPrefix(host, "http://") && !strings.HasPrefix(host, "https://") {
		host = "http://" + host
	}
	return host + "/api/generate"
}

// compactOCRText collapses redundant whitespace and blank lines to minimize token count
// and keep total prompt tokens within a single 512-token llama.cpp batch.
func compactOCRText(raw string) string {
	var lines []string
	for _, line := range strings.Split(raw, "\n") {
		fields := strings.Fields(line)
		if len(fields) > 0 {
			lines = append(lines, strings.Join(fields, " "))
		}
	}
	res := strings.Join(lines, "\n")
	if len(res) > 4000 {
		res = res[:4000]
	}
	return res
}

// isShortAlphanumeric counts letters and digits in s to detect garbled/empty OCR output.
func isShortAlphanumeric(s string, threshold int) bool {
	count := 0
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			count++
		}
		if count > threshold {
			return false
		}
	}
	return true
}

// alphanumRe extracts only alphanumeric characters for counting.
var alphanumRe = regexp.MustCompile(`[a-zA-Z0-9]`)

// countAlphanum returns the number of alphanumeric characters in s.
func countAlphanum(s string) int {
	return len(alphanumRe.FindAllString(s, -1))
}

// sortNumericSuffix sorts paths that end with -N.png (page images) numerically.
func sortNumericSuffix(files []string) {
	sort.SliceStable(files, func(i, j int) bool {
		ni := pageSuffix(files[i])
		nj := pageSuffix(files[j])
		return ni < nj
	})
}

// pageSuffix extracts the numeric suffix from a path like "base-3.png" → 3.
func pageSuffix(path string) int {
	base := filepath.Base(path)
	// Remove .png extension
	name := strings.TrimSuffix(base, ".png")
	// Find last dash
	if idx := strings.LastIndex(name, "-"); idx != -1 {
		if num, err := strconv.Atoi(name[idx+1:]); err == nil {
			return num
		}
	}
	return 0
}

// callOllamaVisionMulti sends a prompt with multiple images to a vision model (e.g. qwen2.5vl:3b).
func callOllamaVisionMulti(req OllamaVisionMultiRequest) (string, error) {
	jsonBytes, err := json.Marshal(req)
	if err != nil {
		return "", fmt.Errorf("json marshal: %w", err)
	}

	reqBody := fasthttp.AcquireRequest()
	defer fasthttp.ReleaseRequest(reqBody)
	reqBody.SetRequestURI(ollamaURL())
	reqBody.Header.SetMethod(fasthttp.MethodPost)
	reqBody.Header.SetContentType("application/json")
	reqBody.SetBody(jsonBytes)

	resp := fasthttp.AcquireResponse()
	defer fasthttp.ReleaseResponse(resp)

	client := &fasthttp.Client{
		ReadTimeout:  5 * time.Minute,
		WriteTimeout: 30 * time.Second,
	}
	if err := client.Do(reqBody, resp); err != nil {
		return "", fmt.Errorf("ollama vision request: %w", err)
	}
	if resp.StatusCode() != fasthttp.StatusOK {
		return "", fmt.Errorf("ollama vision status %d: %s", resp.StatusCode(), string(resp.Body()))
	}

	var ollamaResp struct {
		Response string `json:"response"`
	}
	if err := json.Unmarshal(resp.Body(), &ollamaResp); err != nil {
		return "", fmt.Errorf("parse vision envelope: %w", err)
	}
	if strings.TrimSpace(ollamaResp.Response) == "" {
		return "", fmt.Errorf("empty vision response from model")
	}
	return ollamaResp.Response, nil
}

// injectOCRContext appends Tesseract OCR text alongside the image when sending to a vision model,
// so blurry dates/totals are caught accurately even if the image is slightly degraded.
func injectOCRContext(imagePrompt string, b64Image string, ocrText string) string {
	if ocrText == "" {
		return imagePrompt
	}
	return imagePrompt + "\n\nSupplemental Tesseract OCR text (use to confirm blurry totals/dates):\n" + ocrText
}

// ValidateOllamaJSON checks that the raw Ollama response is valid JSON with the expected receipt keys.
// If the first parse fails, it performs one clean JSON-repair retry (strip markdown + isolate outermost object).
// Returns the cleaned JSON string or an error if both attempts fail.
func ValidateOllamaJSON(raw string) (string, error) {
	cleaned := CleanAIJSON(raw)

	// Expected keys in the JSON object
	expectedKeys := []string{"timestamp", "vendor", "description", "amount", "taxAmount", "currencyCode", "tender", "chartAccountId"}

	// First attempt: parse the cleaned output directly
	if jsonValid(cleaned, expectedKeys) {
		return cleaned, nil
	}

	// Second attempt: aggressive repair — strip everything outside the outermost {…}
	outermost := isolateOutermostJSON(cleaned)
	if outermost != "" && jsonValid(outermost, expectedKeys) {
		return outermost, nil
	}

	// Third attempt: try to fix common issues like trailing commas or single quotes
	fixed := repairJSON(cleaned)
	if fixed != "" && jsonValid(fixed, expectedKeys) {
		return fixed, nil
	}

	return "", fmt.Errorf("Ollama returned invalid JSON after repair attempts: %s", raw)
}

// CleanAIJSON removes markdown fences and extra commentary, isolating the outer JSON object.
func CleanAIJSON(raw string) string {
	s := strings.TrimSpace(raw)
	// Strip markdown fences if present
	if strings.Contains(s, "```") {
		if idx := strings.Index(s, "```"); idx != -1 {
			remainder := s[idx+3:]
			if newline := strings.Index(remainder, "\n"); newline != -1 {
				remainder = remainder[newline+1:]
			}
			if endIdx := strings.Index(remainder, "```"); endIdx != -1 {
				s = strings.TrimSpace(remainder[:endIdx])
			} else {
				s = strings.TrimSpace(remainder)
			}
		}
	}

	// Isolate JSON object between outermost '{' and '}'
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start != -1 && end != -1 && end > start {
		s = s[start : end+1]
	}

	return strings.TrimSpace(s)
}

// isolateOutermostJSON extracts the content between the first '{' and last '}'.
func isolateOutermostJSON(s string) string {
	s = strings.TrimSpace(s)
	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start != -1 && end != -1 && end > start {
		return strings.TrimSpace(s[start : end+1])
	}
	return ""
}

// repairJSON attempts basic JSON fixes: trailing commas, single quotes to double quotes.
func repairJSON(s string) string {
	s = strings.ReplaceAll(s, "'", "\"")
	// Fix trailing commas before } or ]
	trailingCommaRe := regexp.MustCompile(`,\s*([\}\]])`)
	for {
		fixed := trailingCommaRe.ReplaceAllString(s, "$1")
		if fixed == s {
			break
		}
		s = fixed
	}
	return strings.TrimSpace(s)
}

// jsonValid checks if s is valid JSON and contains all expected keys.
func jsonValid(s string, expectedKeys []string) bool {
	var obj map[string]interface{}
	if err := json.Unmarshal([]byte(s), &obj); err != nil {
		return false
	}
	for _, key := range expectedKeys {
		if _, ok := obj[key]; !ok {
			return false
		}
	}
	return true
}

// runTesseract runs Tesseract OCR on the given image file and returns the extracted text.
func runTesseract(imagePath string) (string, error) {
	cmd := exec.Command("tesseract", imagePath, "stdout", "--psm", "6")
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("tesseract: %w", err)
	}
	return string(out), nil
}

// resizeImage resizes an image preserving legible detail for receipt OCR.
// Tall thermal receipts need wider width than 1200px to keep tiny print readable.
// This function scales by width and caps height at a safe pixel limit.
func resizeImage(inputPath, outputPath string) error {
	// Open and fix EXIF orientation
	img, err := imaging.Open(inputPath, imaging.AutoOrientation(true))
	if err != nil {
		return fmt.Errorf("failed to open image: %w", err)
	}

	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()

	if width == 0 || height == 0 {
		return fmt.Errorf("image has zero dimensions")
	}

	// For tall/narrow thermal receipts (height > width), scale by width first
	// to preserve tiny print legibility. For wide/square images, fit normally.
	const receiptMaxWidth = 800
	const receiptMaxHeight = 2400 // Cap total height to control payload size

	if height > width {
		// Thermal receipt path: scale by width
		newWidth := width
		if width > receiptMaxWidth {
			newWidth = receiptMaxWidth
		}
		ratio := float64(newWidth) / float64(width)
		newHeight := int(float64(height) * ratio)
		if newHeight > receiptMaxHeight {
			// Recalculate width to fit height cap
			newWidth = int(float64(receiptMaxHeight) / ratio)
			img = imaging.Resize(img, newWidth, 0, imaging.Lanczos)
		} else {
			img = imaging.Resize(img, newWidth, 0, imaging.Lanczos)
		}
	} else {
		// Normal path: fit within max dimension
		if width > 800 {
			img = imaging.Fit(img, 800, 800, imaging.Lanczos)
		}
	}

	if err := imaging.Save(img, outputPath, imaging.JPEGQuality(90)); err != nil {
		return fmt.Errorf("failed to save image: %w", err)
	}
	return nil
}

// runOCR runs Tesseract OCR on the given image file and returns the extracted text.
// Deprecated: use runTesseract (same behavior, clearer name).
func runOCR(imagePath string) (string, error) {
	return runTesseract(imagePath)
}

// extractPDFText attempts lossless text extraction from a digital PDF via pdftotext.
func extractPDFText(pdfPath string) string {
	cmd := exec.Command("pdftotext", "-layout", pdfPath, "-")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return compactOCRText(string(out))
}

// convertPDFToImages uses pdftoppm to convert a PDF to PNG images,
// returning the paths of all generated page files.
func convertPDFToImages(pdfPath, baseFileName string) ([]string, error) {
	// 300 DPI gives Tesseract dramatically better accuracy on receipt numbers & dates
	cmd := exec.Command("pdftoppm", "-png", "-r", "300", pdfPath, baseFileName)
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("pdftoppm: %v — %s", err, string(out))
	}
	pages, _ := filepath.Glob(baseFileName + "-*.png")
	if len(pages) == 0 {
		return nil, fmt.Errorf("pdftoppm produced no output pages")
	}
	return pages, nil
}

// callOllama sends a prompt to Ollama's API with structured output (JSON mode)
// and low temperature to prevent markdown commentary or hallucination.
func callOllama(reqBody OllamaRequest) (string, error) {
	jsonBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("json marshal: %w", err)
	}

	req := fasthttp.AcquireRequest()
	defer fasthttp.ReleaseRequest(req)
	req.SetRequestURI(ollamaURL())
	req.Header.SetMethod(fasthttp.MethodPost)
	req.Header.SetContentType("application/json")
	req.SetBody(jsonBytes)

	resp := fasthttp.AcquireResponse()
	defer fasthttp.ReleaseResponse(resp)

	client := &fasthttp.Client{
		ReadTimeout:  5 * time.Minute,
		WriteTimeout: 30 * time.Second,
	}
	if err := client.Do(req, resp); err != nil {
		return "", fmt.Errorf("ollama request: %w", err)
	}
	if resp.StatusCode() != fasthttp.StatusOK {
		return "", fmt.Errorf("ollama status %d: %s", resp.StatusCode(), string(resp.Body()))
	}

	var ollamaResp struct {
		Response string `json:"response"`
	}
	if err := json.Unmarshal(resp.Body(), &ollamaResp); err != nil {
		return "", fmt.Errorf("parse envelope: %w", err)
	}
	if strings.TrimSpace(ollamaResp.Response) == "" {
		return "", fmt.Errorf("empty response from model. Raw: %s", string(resp.Body()))
	}
	return ollamaResp.Response, nil
}

func process(ctx *fasthttp.RequestCtx) {
	baseFileName := fmt.Sprintf("/tmp/upload_%d", time.Now().UnixNano())

	fileHeader, err := ctx.FormFile("document")
	if err != nil {
		ctx.Error("No file provided", fasthttp.StatusBadRequest)
		return
	}

	// Validate file size before saving to prevent OOM attacks.
	if fileHeader.Size > maxUploadSize {
		ctx.Error(fmt.Sprintf("File too large: %d bytes (max %d)", fileHeader.Size, maxUploadSize), fasthttp.StatusBadRequest)
		return
	}

	originalName := strings.ToLower(fileHeader.Filename)
	isPDF := strings.HasSuffix(originalName, ".pdf")

	// Validate MIME type from multipart header (more reliable than extension alone).
	mime := fileHeader.Header.Get("Content-Type")
	if err := validateUpload(fileHeader.Size, mime); err != nil {
		ctx.Error(fmt.Sprintf("Upload rejected: %v", err), fasthttp.StatusBadRequest)
		return
	}

	userPrompt := string(ctx.FormValue("prompt"))

	if isPDF {
		// ── PDF PATH: Embedded text (pdftotext) → if short/garbled, fall back to vision model ─────────────
		pdfName := baseFileName + ".pdf"
		if err := fasthttp.SaveMultipartFile(fileHeader, pdfName); err != nil {
			ctx.Error("Failed to save PDF", fasthttp.StatusInternalServerError)
			return
		}
		defer os.Remove(pdfName)

		extracted := extractPDFText(pdfName)

		// Check if pdftotext produced enough meaningful content
		if countAlphanum(extracted) < 20 {
			// pdftotext produced too little text — render pages and try vision model fallback
			log.Printf("⚠️ PDF pdftotext produced only %d alphanum chars, falling back to vision model", countAlphanum(extracted))

			pages, err := convertPDFToImages(pdfName, baseFileName)
			if err != nil {
				log.Printf("⚠️ PDF conversion failed: %v", err)
				ctx.Error(fmt.Sprintf("PDF conversion failed: %v", err), fasthttp.StatusInternalServerError)
				return
			}

			// Sort pages numerically so -1.png, -2.png, -10.png are in order
			sortNumericSuffix(pages)

			// Render a few pages as resized images for the vision model
			var images []string
			const maxVisionPages = 3 // Cap to stay within token budget
			for i, p := range pages {
				if i >= maxVisionPages {
					break
				}
				resized := baseFileName + fmt.Sprintf("-p%d.jpg", i)
				defer os.Remove(resized)
				if err := resizeImage(p, resized); err == nil {
					data, _ := os.ReadFile(resized)
					images = append(images, base64.StdEncoding.EncodeToString(data))
				}
				os.Remove(p)
			}

			if len(images) == 0 {
				ctx.Error("PDF: no renderable pages for vision model", fasthttp.StatusInternalServerError)
				return
			}

			visionPrompt := userPrompt
			if visionPrompt == "" {
				visionPrompt = "You are a receipt data extractor. Look at these receipt PDF pages carefully and extract the expense details.\nReturn ONLY a valid JSON object with no explanation or markdown:\n{\n  \"timestamp\": \"\",\n  \"vendor\": \"\",\n  \"description\": \"\",\n  \"amount\": 0.00,\n  \"taxAmount\": 0.00,\n  \"currencyCode\": \"USD\",\n  \"tender\": \"CARD\",\n  \"chartAccountId\": null\n}\nRules:\n- timestamp must be RFC3339 format. Leave as \"\" if no date is found. NEVER invent a date.\n- amount must be the final total paid as a positive number.\n- vendor should be the store/business name.\n- Leave amount as 0 if it cannot be determined."
			}

			// Append garbled pdftotext output as context, but do NOT embed base64 image data here.
			// Base64 images are passed via the Images field in OllamaVisionMultiRequest.
			if extracted != "" {
				visionPrompt = visionPrompt + "\n\nRaw pdftotext output (may be garbled for scanned PDFs, rely on visual inspection):\n" + extracted
			}

			// Combine all page images into a single multi-image prompt
			promptParts := []string{visionPrompt}
			for _, img := range images {
				promptParts = append(promptParts, img)
			}

			response, err := callOllamaVisionMulti(OllamaVisionMultiRequest{
				Model:   "qwen2.5vl:3b",
				Prompt:  strings.Join(promptParts, "\n"),
				Images:  images,
				Stream:  false,
				Format:  "json",
				Options: map[string]any{"temperature": 0.0},
			})
			if err != nil {
				ctx.Error(fmt.Sprintf("Ollama vision model error: %v", err), fasthttp.StatusInternalServerError)
				return
			}

			// Validate and normalize JSON before returning
			validJSON, err := ValidateOllamaJSON(response)
			if err != nil {
				log.Printf("⚠️ Vision model returned invalid JSON: %v", err)
				ctx.Error("Vision model returned invalid JSON — please review the receipt manually", fasthttp.StatusInternalServerError)
				return
			}

			ctx.SetContentType("application/json")
			ctx.WriteString(validJSON)
			return
		}

		// pdftotext produced sufficient text — use text model (llama3.1:8b)
		if extracted == "" {
			ctx.Error("Tesseract could not extract text from PDF", fasthttp.StatusInternalServerError)
			return
		}

		prompt := userPrompt
		if prompt == "" {
			prompt = defaultTextPrompt
		}
		prompt = prompt + "\n\nRaw OCR text extracted from document:\n" + extracted

		response, err := callOllama(OllamaRequest{
			Model:  "llama3.1:8b",
			Prompt: prompt,
			Stream: false,
			Format: "json",
			Options: map[string]any{"temperature": 0.0},
		})
		if err != nil {
			ctx.Error(fmt.Sprintf("Ollama text model error: %v", err), fasthttp.StatusInternalServerError)
			return
		}

		// Validate and normalize JSON before returning
		validJSON, err := ValidateOllamaJSON(response)
		if err != nil {
			log.Printf("⚠️ Text model returned invalid JSON: %v", err)
			ctx.Error("Text model returned invalid JSON — please review the receipt manually", fasthttp.StatusInternalServerError)
			return
		}

		ctx.SetContentType("application/json")
		ctx.WriteString(validJSON)
		return

	} else {
		// ── IMAGE PATH: Resize → Tesseract OCR (supplemental) → qwen2.5vl:3b ─────────────
		imgName := baseFileName + filepath.Ext(originalName)
		if err := fasthttp.SaveMultipartFile(fileHeader, imgName); err != nil {
			ctx.Error("Failed to save image", fasthttp.StatusInternalServerError)
			return
		}
		defer os.Remove(imgName)

		resizedName := baseFileName + "_resized.jpg"
		if err := resizeImage(imgName, resizedName); err != nil {
			log.Printf("⚠️ Image resize failed: %v", err)
			ctx.Error(fmt.Sprintf("Image resize failed: %v", err), fasthttp.StatusInternalServerError)
			return
		}
		defer os.Remove(resizedName)

		// Run Tesseract on the resized image for supplemental context
		ocrText := ""
		if text, err := runTesseract(resizedName); err == nil {
			ocrText = compactOCRText(text)
		}

		imgData, err := os.ReadFile(resizedName)
		if err != nil {
			ctx.Error("Failed to read resized image", fasthttp.StatusInternalServerError)
			return
		}
		b64 := base64.StdEncoding.EncodeToString(imgData)

		prompt := userPrompt
		if prompt == "" {
			prompt = defaultVisionPrompt
		}

		// Inject Tesseract OCR as supplemental context alongside the image
		prompt = injectOCRContext(prompt, b64, ocrText)

		response, err := callOllama(OllamaRequest{
			Model:  "qwen2.5vl:3b",
			Prompt: prompt,
			Images: []string{b64},
			Stream: false,
			Format: "json",
			Options: map[string]any{"temperature": 0.0},
		})
		if err != nil {
			ctx.Error(fmt.Sprintf("Ollama vision model error: %v", err), fasthttp.StatusInternalServerError)
			return
		}

		// Validate and normalize JSON before returning
		validJSON, err := ValidateOllamaJSON(response)
		if err != nil {
			log.Printf("⚠️ Vision model returned invalid JSON: %v", err)
			ctx.Error("Vision model returned invalid JSON — please review the receipt manually", fasthttp.StatusInternalServerError)
			return
		}

		ctx.SetContentType("application/json")
		ctx.WriteString(validJSON)
		return
	}
}

func health(ctx *fasthttp.RequestCtx) {
	// Verify Tesseract is available and working
	cmd := exec.Command("tesseract", "--version")
	if err := cmd.Run(); err != nil {
		log.Printf("Health check failed: tesseract error: %v", err)
		ctx.Error(fmt.Sprintf("Service unhealthy: tesseract failed: %v", err), fasthttp.StatusInternalServerError)
		return
	}

	ctx.SetContentType("application/json")
	ctx.SetStatusCode(fasthttp.StatusOK)
	ctx.WriteString(`{"status": "ok", "message": "file-processor is healthy"}`)
}

func routeHandler(ctx *fasthttp.RequestCtx) {
	path := string(ctx.Path())

	if path == "/process" && ctx.IsPost() {
		process(ctx)
	} else if path == "/health" && ctx.IsGet() {
		health(ctx)
	} else {
		ctx.Error("Not Found", fasthttp.StatusNotFound)
	}

}
