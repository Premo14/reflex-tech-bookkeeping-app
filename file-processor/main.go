package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
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
	_ "golang.org/x/image/webp"
)

// OllamaRequest is the JSON body sent to Ollama's /api/generate endpoint.
type OllamaRequest struct {
	Model   string   `json:"model"`
	Prompt  string   `json:"prompt"`
	Images  []string `json:"images,omitempty"`
	Stream  bool     `json:"stream"`
	Format  string   `json:"format,omitempty"`
	Options any      `json:"options,omitempty"`
}

// upload limits protect against OOM and malicious uploads.
const (
	maxUploadSize     = 20 << 20 // 20 MB — generous for PDF receipts, tight enough to block abuse
	allowedPDFMIME    = "application/pdf"
	allowedImgMIME    = "image/jpeg"
	allowedImgAltMIME = "image/png"
)

// detectMIME reads up to 512 bytes from r and returns the detected MIME type.
func detectMIME(r io.Reader) (string, error) {
	var buf [512]byte
	n, err := r.Read(buf[:])
	if err != nil && err != io.EOF {
		return "", err
	}
	return http.DetectContentType(buf[:n]), nil
}

// resolveUploadMIME inspects actual magic bytes from the multipart file header so
// standard Go multipart uploads (which default to application/octet-stream) succeed
// while rejecting non-receipt payloads.
func resolveUploadMIME(fileHeader *multipart.FileHeader) (string, error) {
	headerMIME := strings.ToLower(strings.TrimSpace(strings.Split(fileHeader.Header.Get("Content-Type"), ";")[0]))
	f, err := fileHeader.Open()
	if err != nil {
		return headerMIME, err
	}
	defer f.Close()

	sniffed, err := detectMIME(f)
	if err != nil {
		return headerMIME, err
	}
	sniffed = strings.ToLower(strings.TrimSpace(strings.Split(sniffed, ";")[0]))

	// Accept sniffed magic bytes directly when recognized as a supported receipt format.
	if sniffed == allowedPDFMIME || sniffed == allowedImgMIME || sniffed == allowedImgAltMIME ||
		sniffed == "image/webp" || sniffed == "image/bmp" {
		return sniffed, nil
	}

	// ISO BMFF / TIFF formats (e.g. .heic/.heif/.tiff) sniff as application/octet-stream in net/http.
	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
	if sniffed == "application/octet-stream" && (ext == ".heic" || ext == ".heif" || ext == ".tif" || ext == ".tiff") {
		if ext == ".tif" || ext == ".tiff" {
			return "image/tiff", nil
		}
		return "image/heic", nil
	}

	if sniffed != "" && sniffed != "application/octet-stream" {
		return sniffed, nil
	}
	return headerMIME, nil
}

// validateUpload checks that the uploaded file meets size and MIME constraints.
// size is the actual byte count of the multipart file (fileHeader.Size).
func validateUpload(size int64, mime string) error {
	if size > maxUploadSize {
		return fmt.Errorf("file too large: %d bytes (max %d)", size, maxUploadSize)
	}
	normalized := strings.ToLower(strings.TrimSpace(strings.Split(mime, ";")[0]))
	switch normalized {
	case allowedPDFMIME, allowedImgMIME, allowedImgAltMIME, "image/webp", "image/bmp", "image/tiff":
		return nil
	case "image/heic":
		return fmt.Errorf("unsupported MIME type: %q (HEIC images must be converted to PNG or JPEG before processing)", mime)
	default:
		return fmt.Errorf("unsupported MIME type: %q (expected PDF or JPEG/PNG/WEBP/BMP/TIFF image)", mime)
	}
}

const receiptPromptSchemaAndRules = `Return ONLY a valid JSON object with no explanation or markdown, matching this exact schema:
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
- timestamp must be RFC3339 format (e.g. 2026-07-15T14:30:00Z). Use midnight UTC if no time is visible. Leave as "" if no date is found. NEVER invent or guess a date.
- amount must be the final grand total paid (including tax and tip, NOT subtotal or change due) as a positive number with no currency symbol.
- taxAmount must be the total tax paid, as a number. Leave as 0 if not found.
- currencyCode must be the 3-letter ISO currency code (e.g. USD, CAD, EUR). Default to USD if none is found.
- tender is the payment method: CARD, CASH, CHECK, TRANSFER, PAYPAL, VENMO, ZELLE, OTHER.
- chartAccountId should be null unless an active category ID list is provided.
- vendor must be the merchant/business name only (never the street address, phone number, URL, or store #).
- Leave vendor, description, or tender as empty strings if they cannot be determined.
- Leave amount as 0 if it cannot be determined.`

const defaultTextPrompt = "You are a receipt data extractor. The following is raw OCR text extracted from a receipt.\nExtract the expense details.\n" + receiptPromptSchemaAndRules

const defaultVisionPrompt = "You are a receipt data extractor. Look at this receipt image carefully and extract the expense details.\n" + receiptPromptSchemaAndRules

const defaultPDFVisionPrompt = "You are a receipt data extractor. Look at these receipt PDF pages carefully and extract the expense details.\n" + receiptPromptSchemaAndRules

func main() {
	srv := &fasthttp.Server{
		Handler:            routeHandler,
		MaxRequestBodySize: maxUploadSize + (1 << 20), // match 20MB upload cap + multipart overhead
		ReadTimeout:        5 * time.Minute,
		WriteTimeout:       6 * time.Minute,
	}
	log.Fatal(srv.ListenAndServe(":8081"))
}

func ollamaBaseURL() string {
	host := strings.TrimSpace(os.Getenv("OLLAMA_HOST"))
	if host == "" {
		host = "127.0.0.1:11434"
	}
	if !strings.HasPrefix(host, "http://") && !strings.HasPrefix(host, "https://") {
		host = "http://" + host
	}
	return strings.TrimRight(host, "/")
}

func ollamaURL() string {
	return ollamaBaseURL() + "/api/generate"
}

const (
	maxOCRRunes     = 4000
	ocrHeadRunes    = 1500
	ocrTailRunes    = 2495
	ocrTruncMarker  = "\n...\n"
)

// compactOCRText collapses redundant whitespace and blank lines to minimize token count
// while preserving UTF-8 rune boundaries and both receipt headers (vendor/date) and footers (totals/tax/tender).
func compactOCRText(raw string) string {
	var lines []string
	for _, line := range strings.Split(raw, "\n") {
		fields := strings.Fields(line)
		if len(fields) > 0 {
			lines = append(lines, strings.Join(fields, " "))
		}
	}
	res := strings.Join(lines, "\n")
	runes := []rune(res)
	if len(runes) <= maxOCRRunes {
		return res
	}
	if len(lines) <= 1 {
		return string(runes[:maxOCRRunes])
	}
	head := string(runes[:ocrHeadRunes])
	tailStart := len(runes) - ocrTailRunes
	if tailStart < ocrHeadRunes {
		tailStart = ocrHeadRunes
	}
	tail := string(runes[tailStart:])
	return strings.TrimSpace(head) + ocrTruncMarker + strings.TrimSpace(tail)
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

var ollamaHTTPClient = &fasthttp.Client{
	ReadTimeout:  5 * time.Minute,
	WriteTimeout: 30 * time.Second,
}

var trailingCommaRe = regexp.MustCompile(`,\s*([\}\]])`)

// defaultOllamaOptions ensures deterministic JSON generation with adequate context capacity.
func defaultOllamaOptions() map[string]any {
	return map[string]any{
		"temperature": 0.0,
		"num_ctx":     4096,
	}
}

// injectOCRContext appends Tesseract OCR text alongside the image when sending to a vision model,
// so blurry dates/totals are caught accurately even if the image is slightly degraded.
func injectOCRContext(imagePrompt string, ocrText string) string {
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

// repairJSON converts Python-style single-quoted keys/values into valid JSON
// without corrupting apostrophes inside strings, then strips trailing commas.
func repairJSON(s string) string {
	runes := []rune(s)
	var out strings.Builder
	out.Grow(len(s))

	inDouble := false
	inSingle := false

	nextNonSpaceIsDelimiter := func(start int) bool {
		for j := start; j < len(runes); j++ {
			switch runes[j] {
			case ' ', '\t', '\r', '\n':
				continue
			case ':', ',', '}', ']':
				return true
			default:
				return false
			}
		}
		return true
	}

	for i := 0; i < len(runes); i++ {
		r := runes[i]
		if inDouble {
			out.WriteRune(r)
			if r == '\\' && i+1 < len(runes) {
				i++
				out.WriteRune(runes[i])
			} else if r == '"' {
				inDouble = false
			}
			continue
		}
		if inSingle {
			if r == '\\' && i+1 < len(runes) {
				next := runes[i+1]
				i++
				if next == '\'' {
					out.WriteRune('\'')
				} else {
					out.WriteRune('\\')
					out.WriteRune(next)
				}
				continue
			}
			if r == '\'' {
				if nextNonSpaceIsDelimiter(i + 1) {
					out.WriteRune('"')
					inSingle = false
				} else {
					// Embedded apostrophe inside a single-quoted value (e.g., 'Joe's Diner').
					out.WriteRune('\'')
				}
				continue
			}
			if r == '"' {
				out.WriteString(`\"`)
				continue
			}
			out.WriteRune(r)
			continue
		}

		switch r {
		case '"':
			inDouble = true
			out.WriteRune(r)
		case '\'':
			inSingle = true
			out.WriteRune('"')
		default:
			out.WriteRune(r)
		}
	}

	res := out.String()
	for {
		fixed := trailingCommaRe.ReplaceAllString(res, "$1")
		if fixed == res {
			break
		}
		res = fixed
	}
	return strings.TrimSpace(res)
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

var execCmd = exec.Command

// runTesseract runs Tesseract OCR on the given image file and returns the extracted text.
func runTesseract(imagePath string) (string, error) {
	cmd := execCmd("tesseract", imagePath, "stdout", "--psm", "6")
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("tesseract: %w", err)
	}
	return string(out), nil
}

// resizeImage resizes an image preserving legible detail for receipt OCR.
// Tall thermal receipts scale up to 800px width (capped at 2400px height) so tiny print remains readable.
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
			// Scale down by max height to preserve aspect ratio without upscaling width.
			img = imaging.Resize(img, 0, receiptMaxHeight, imaging.Lanczos)
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
	cmd := execCmd("pdftotext", "-layout", pdfPath, "-")
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
	cmd := execCmd("pdftoppm", "-png", "-r", "300", pdfPath, baseFileName)
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("pdftoppm: %v — %s", err, string(out))
	}
	pages, _ := filepath.Glob(baseFileName + "-*.png")
	if len(pages) == 0 {
		return nil, fmt.Errorf("pdftoppm produced no output pages")
	}
	return pages, nil
}

// callOllama sends a prompt (with optional Images) to Ollama's /api/generate endpoint
// using the shared fasthttp client and JSON structured output mode.
func callOllama(reqBody OllamaRequest) (string, error) {
	if reqBody.Options == nil {
		reqBody.Options = defaultOllamaOptions()
	}
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

	if err := ollamaHTTPClient.Do(req, resp); err != nil {
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

func writeValidatedAIResponse(ctx *fasthttp.RequestCtx, response, label string) {
	validJSON, err := ValidateOllamaJSON(response)
	if err != nil {
		log.Printf("⚠️ %s model returned invalid JSON: %v", label, err)
		ctx.Error(fmt.Sprintf("%s model returned invalid JSON — please review the receipt manually", label), fasthttp.StatusInternalServerError)
		return
	}

	ctx.SetContentType("application/json")
	ctx.WriteString(validJSON)
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

	// Sniff actual file bytes rather than trusting multipart Content-Type alone,
	// because Go's multipart.Writer.CreateFormFile sends application/octet-stream.
	mime, err := resolveUploadMIME(fileHeader)
	if err != nil {
		ctx.Error(fmt.Sprintf("Failed to inspect upload: %v", err), fasthttp.StatusBadRequest)
		return
	}
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

			// Sort pages numerically so -1.png, -2.png, -10.png are in order.
			sortNumericSuffix(pages)
			defer func() {
				for _, p := range pages {
					_ = os.Remove(p)
				}
			}()

			// Render up to maxVisionPages as resized JPEGs and extract supplemental Tesseract OCR.
			var images []string
			var ocrChunks []string
			const maxVisionPages = 3 // Cap to stay within token budget
			for i, p := range pages {
				if i >= maxVisionPages {
					break
				}
				if text, ocrErr := runTesseract(p); ocrErr == nil {
					if trimmed := strings.TrimSpace(text); trimmed != "" {
						ocrChunks = append(ocrChunks, trimmed)
					}
				}
				resized := baseFileName + fmt.Sprintf("-p%d.jpg", i)
				defer os.Remove(resized)
				if err := resizeImage(p, resized); err != nil {
					log.Printf("⚠️ PDF page %d resize failed: %v", i+1, err)
					continue
				}
				data, readErr := os.ReadFile(resized)
				if readErr != nil {
					log.Printf("⚠️ PDF page %d read failed: %v", i+1, readErr)
					continue
				}
				images = append(images, base64.StdEncoding.EncodeToString(data))
			}

			if len(images) == 0 {
				ctx.Error("PDF: no renderable pages for vision model", fasthttp.StatusInternalServerError)
				return
			}

			visionPrompt := userPrompt
			if visionPrompt == "" {
				visionPrompt = defaultPDFVisionPrompt
			}

			supplementalOCR := compactOCRText(strings.Join(ocrChunks, "\n"))
			if supplementalOCR != "" {
				visionPrompt = injectOCRContext(visionPrompt, supplementalOCR)
			} else if extracted != "" {
				visionPrompt = visionPrompt + "\n\nRaw pdftotext output (may be incomplete for scanned PDFs, rely on visual inspection):\n" + extracted
			}

			response, err := callOllama(OllamaRequest{
				Model:   "qwen2.5vl:3b",
				Prompt:  visionPrompt,
				Images:  images,
				Stream:  false,
				Format:  "json",
				Options: defaultOllamaOptions(),
			})
			if err != nil {
				ctx.Error(fmt.Sprintf("Ollama vision model error: %v", err), fasthttp.StatusInternalServerError)
				return
			}

			writeValidatedAIResponse(ctx, response, "Vision")
			return
		}

		// pdftotext produced sufficient text — use text model (llama3.1:8b)
		prompt := userPrompt
		if prompt == "" {
			prompt = defaultTextPrompt
		}
		prompt = prompt + "\n\nRaw OCR text extracted from document:\n" + extracted

		response, err := callOllama(OllamaRequest{
			Model:   "llama3.1:8b",
			Prompt:  prompt,
			Stream:  false,
			Format:  "json",
			Options: defaultOllamaOptions(),
		})
		if err != nil {
			ctx.Error(fmt.Sprintf("Ollama text model error: %v", err), fasthttp.StatusInternalServerError)
			return
		}

		writeValidatedAIResponse(ctx, response, "Text")
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
		prompt = injectOCRContext(prompt, ocrText)

		response, err := callOllama(OllamaRequest{
			Model:   "qwen2.5vl:3b",
			Prompt:  prompt,
			Images:  []string{b64},
			Stream:  false,
			Format:  "json",
			Options: defaultOllamaOptions(),
		})
		if err != nil {
			ctx.Error(fmt.Sprintf("Ollama vision model error: %v", err), fasthttp.StatusInternalServerError)
			return
		}

		writeValidatedAIResponse(ctx, response, "Vision")
		return
	}
}

var ollamaHealthClient = &fasthttp.Client{
	ReadTimeout:  2 * time.Second,
	WriteTimeout: 2 * time.Second,
}

func checkOllamaReachable() bool {
	req := fasthttp.AcquireRequest()
	defer fasthttp.ReleaseRequest(req)
	req.SetRequestURI(ollamaBaseURL() + "/api/tags")
	req.Header.SetMethod(fasthttp.MethodGet)

	resp := fasthttp.AcquireResponse()
	defer fasthttp.ReleaseResponse(resp)

	if err := ollamaHealthClient.DoTimeout(req, resp, 2*time.Second); err != nil {
		return false
	}
	return resp.StatusCode() == fasthttp.StatusOK
}

func health(ctx *fasthttp.RequestCtx) {
	requiredTools := []struct {
		name string
		arg  string
	}{
		{"tesseract", "--version"},
		{"pdftoppm", "-v"},
		{"pdftotext", "-v"},
	}
	for _, tool := range requiredTools {
		if err := execCmd(tool.name, tool.arg).Run(); err != nil {
			log.Printf("Health check failed: %s error: %v", tool.name, err)
			ctx.Error(fmt.Sprintf("Service unhealthy: %s failed: %v", tool.name, err), fasthttp.StatusInternalServerError)
			return
		}
	}

	ollamaUp := checkOllamaReachable()
	payload, _ := json.Marshal(map[string]any{
		"status":          "ok",
		"message":         "file-processor is healthy",
		"ollamaReachable": ollamaUp,
		"tools": map[string]string{
			"tesseract": "ok",
			"pdftoppm":  "ok",
			"pdftotext": "ok",
		},
	})
	ctx.SetContentType("application/json")
	ctx.SetStatusCode(fasthttp.StatusOK)
	ctx.Write(payload)
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
