package utils

// PassImageOrPdfToAI is a no-op placeholder for future image/PDF-to-AI routing.
// The actual file processing pipeline lives in processer.go (sendReceiptToScript)
// and file-processor/main.go (process endpoint).
func PassImageOrPdfToAI(receiptId uint, filePath string) {
	// TODO: wire this up if we ever need a direct browser-to-AI route.
	// Current flow: upload -> file-processor -> expense created -> reconciliation.
}
