package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
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
}

const defaultTextPrompt = `You are a receipt data extractor. The following is raw OCR text extracted from a receipt.
Extract the expense details and return ONLY a valid JSON object with no explanation or markdown, matching this exact structure:
{
  "timestamp": "2023-08-16T18:51:49Z",
  "vendor": "Walmart",
  "description": "Groceries",
  "amount": 181.13,
  "tender": "VISA"
}
Rules:
- timestamp must be RFC3339 format (e.g. 2023-08-16T18:51:49Z). Use midnight UTC if no time is visible.
- amount must be the TOTAL paid (not subtotal), as a number with no currency symbol.
- tender is the payment method (e.g. VISA, CASH, MASTERCARD, DEBIT).
- vendor should be the store/business name (e.g. Walmart, not the address).
- Leave vendor, description, or tender as empty strings if they cannot be determined.
- Leave amount as 0 if it cannot be determined.

Raw OCR text:
`

const defaultVisionPrompt = `You are a receipt data extractor. Look at this receipt image carefully and extract the expense details.
Return ONLY a valid JSON object with no explanation or markdown, matching this exact structure:
{
  "timestamp": "2023-08-16T18:51:49Z",
  "vendor": "Walmart",
  "description": "Groceries",
  "amount": 181.13,
  "tender": "VISA"
}
Rules:
- timestamp must be RFC3339 format (e.g. 2023-08-16T18:51:49Z). Use midnight UTC if no time is visible.
- amount must be the final total paid as a number with no currency symbol.
- tender is the payment method (e.g. VISA, CASH, MASTERCARD, DEBIT).
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

// resizeImage resizes the image using disintegration/imaging
// This natively handles EXIF orientation and interpolates without aliasing artifacts.
func resizeImage(inputPath, outputPath string) error {
	// Open and fix EXIF orientation
	img, err := imaging.Open(inputPath, imaging.AutoOrientation(true))
	if err != nil {
		return fmt.Errorf("failed to open image: %w", err)
	}

	bounds := img.Bounds()
	maxDim := bounds.Dx()
	if bounds.Dy() > maxDim {
		maxDim = bounds.Dy()
	}

	// If it's a huge 4000px camera photo, we first step down to 2000px with Box
	// to avoid aliasing artifacts, then do the final smooth Lanczos down to 1200.
	if maxDim > 2000 {
		img = imaging.Fit(img, 2000, 2000, imaging.Box)
		bounds = img.Bounds()
		maxDim = bounds.Dx()
		if bounds.Dy() > maxDim {
			maxDim = bounds.Dy()
		}
	}

	if maxDim > 1200 {
		img = imaging.Fit(img, 1200, 1200, imaging.Lanczos)
	}

	if err := imaging.Save(img, outputPath, imaging.JPEGQuality(85)); err != nil {
		return fmt.Errorf("failed to save image: %w", err)
	}
	return nil
}

// runOCR runs Tesseract OCR on the given image file and returns the extracted text.
func runOCR(imagePath string) (string, error) {
	cmd := exec.Command("tesseract", imagePath, "stdout")
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("tesseract: %w", err)
	}
	return string(out), nil
}

// convertPDFToImages uses pdftoppm to convert a PDF to PNG images,
// returning the paths of all generated page files.
func convertPDFToImages(pdfPath, baseFileName string) ([]string, error) {
	// 150 DPI gives Tesseract good quality without excessive file sizes
	cmd := exec.Command("pdftoppm", "-png", "-r", "150", pdfPath, baseFileName)
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("pdftoppm: %v — %s", err, string(out))
	}
	pages, _ := filepath.Glob(baseFileName + "-*.png")
	if len(pages) == 0 {
		return nil, fmt.Errorf("pdftoppm produced no output pages")
	}
	return pages, nil
}

// callOllama sends a prompt to Ollama's API and returns the response.
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

	originalName := strings.ToLower(fileHeader.Filename)
	isPDF := strings.HasSuffix(originalName, ".pdf")
	userPrompt := string(ctx.FormValue("prompt"))

	if isPDF {
		// ── PDF PATH: Tesseract OCR → text model ─────────────
		pdfName := baseFileName + ".pdf"
		if err := fasthttp.SaveMultipartFile(fileHeader, pdfName); err != nil {
			ctx.Error("Failed to save PDF", fasthttp.StatusInternalServerError)
			return
		}
		defer os.Remove(pdfName)

		pages, err := convertPDFToImages(pdfName, baseFileName)
		if err != nil {
			log.Printf("⚠️ PDF conversion failed: %v", err)
			ctx.Error(fmt.Sprintf("PDF conversion failed: %v", err), fasthttp.StatusInternalServerError)
			return
		}

		var ocrText strings.Builder
		for _, img := range pages {
			text, err := runOCR(img)
			os.Remove(img)
			if err == nil {
				ocrText.WriteString(text)
				ocrText.WriteString("\n\n")
			}
		}

		extracted := strings.TrimSpace(ocrText.String())
		if extracted == "" {
			ctx.Error("Tesseract could not extract text from PDF", fasthttp.StatusInternalServerError)
			return
		}

		prompt := userPrompt
		if prompt == "" {
			prompt = defaultTextPrompt + extracted
		}

		response, err := callOllama(OllamaRequest{
			Model:  "llama3.1:8b", // Using text model for PDF text processing
			Prompt: prompt,
			Stream: false,
		})
		if err != nil {
			ctx.Error(fmt.Sprintf("Ollama text model error: %v", err), fasthttp.StatusInternalServerError)
			return
		}

		ctx.SetContentType("application/json")
		ctx.WriteString(response)
		return

	} else {
		// ── IMAGE PATH: PIL Resize → qwen2.5vl:3b ─────────────
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

		response, err := callOllama(OllamaRequest{
			Model:  "qwen2.5vl:3b", // Using vision model for image parsing
			Prompt: prompt,
			Images: []string{b64},
			Stream: false,
		})
		if err != nil {
			ctx.Error(fmt.Sprintf("Ollama vision model error: %v", err), fasthttp.StatusInternalServerError)
			return
		}

		ctx.SetContentType("application/json")
		ctx.WriteString(response)
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
