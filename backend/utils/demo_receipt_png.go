package utils

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"reflex-tech-bookkeeping-app-api/constants"
	"strings"
)

// DemoReceiptSpec carries the text rendered onto a realistic synthetic thermal receipt PNG.
type DemoReceiptSpec struct {
	ReceiptID    uint
	Vendor       string
	Date         string
	Description  string
	Subtotal     string
	Tax          string
	Total        string
	Tender       string
	AccountLabel string
}

// 5x7 crisp monochrome bitmap glyphs for readable synthetic receipts without external font dependencies.
var bitmapFont5x7 = map[rune][7]uint8{
	' ':  {0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00},
	'A':  {0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11},
	'B':  {0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E},
	'C':  {0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E},
	'D':  {0x1C, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1C},
	'E':  {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F},
	'F':  {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10},
	'G':  {0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F},
	'H':  {0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11},
	'I':  {0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E},
	'J':  {0x07, 0x02, 0x02, 0x02, 0x12, 0x12, 0x0C},
	'K':  {0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11},
	'L':  {0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F},
	'M':  {0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11},
	'N':  {0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11},
	'O':  {0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E},
	'P':  {0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10},
	'Q':  {0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D},
	'R':  {0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11},
	'S':  {0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E},
	'T':  {0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04},
	'U':  {0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E},
	'V':  {0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04},
	'W':  {0x11, 0x11, 0x11, 0x15, 0x15, 0x1B, 0x11},
	'X':  {0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11},
	'Y':  {0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04},
	'Z':  {0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F},
	'0':  {0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E},
	'1':  {0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E},
	'2':  {0x0E, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1F},
	'3':  {0x1F, 0x02, 0x04, 0x06, 0x01, 0x11, 0x0E},
	'4':  {0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02},
	'5':  {0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E},
	'6':  {0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E},
	'7':  {0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08},
	'8':  {0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E},
	'9':  {0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C},
	'.':  {0x00, 0x00, 0x00, 0x00, 0x00, 0x0C, 0x0C},
	',':  {0x00, 0x00, 0x00, 0x00, 0x04, 0x04, 0x08},
	':':  {0x00, 0x0C, 0x0C, 0x00, 0x0C, 0x0C, 0x00},
	'-':  {0x00, 0x00, 0x00, 0x1F, 0x00, 0x00, 0x00},
	'+':  {0x00, 0x04, 0x04, 0x1F, 0x04, 0x04, 0x00},
	'/':  {0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10},
	'$':  {0x04, 0x0F, 0x14, 0x0E, 0x05, 0x1E, 0x04},
	'#':  {0x0A, 0x1F, 0x0A, 0x0A, 0x1F, 0x0A, 0x00},
	'&':  {0x0C, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0D},
	'(':  {0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02},
	')':  {0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08},
	'*':  {0x00, 0x15, 0x0E, 0x1F, 0x0E, 0x15, 0x00},
	'\'': {0x04, 0x04, 0x08, 0x00, 0x00, 0x00, 0x00},
	'%':  {0x19, 0x1A, 0x02, 0x04, 0x08, 0x0B, 0x13},
	'=':  {0x00, 0x00, 0x1F, 0x00, 0x1F, 0x00, 0x00},
	'_':  {0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1F},
}

func drawBitmapText(img *image.RGBA, x, y, scale int, text string, col color.RGBA) {
	upper := strings.ToUpper(text)
	cursorX := x
	for _, r := range upper {
		glyph, ok := bitmapFont5x7[r]
		if !ok {
			glyph = bitmapFont5x7[' ']
		}
		for row := 0; row < 7; row++ {
			bits := glyph[row]
			for colIdx := 0; colIdx < 5; colIdx++ {
				if (bits>>(4-colIdx))&1 == 1 {
					draw.Draw(
						img,
						image.Rect(cursorX+colIdx*scale, y+row*scale, cursorX+(colIdx+1)*scale, y+(row+1)*scale),
						&image.Uniform{col},
						image.Point{},
						draw.Src,
					)
				}
			}
		}
		cursorX += 6 * scale
	}
}

func drawDottedRule(img *image.RGBA, x1, x2, y int, col color.RGBA) {
	for x := x1; x < x2; x += 10 {
		draw.Draw(img, image.Rect(x, y, min(x+5, x2), y+2), &image.Uniform{col}, image.Point{}, draw.Src)
	}
}

func wrapLine(s string, maxChars int) []string {
	words := strings.Fields(s)
	if len(words) == 0 {
		return []string{""}
	}
	var lines []string
	cur := words[0]
	for _, w := range words[1:] {
		if len(cur)+1+len(w) <= maxChars {
			cur += " " + w
		} else {
			lines = append(lines, cur)
			cur = w
		}
	}
	lines = append(lines, cur)
	if len(lines) > 3 {
		lines = lines[:3]
	}
	return lines
}

// CreateDemoReceiptPNG renders a readable thermal-style receipt PNG into the active processed directory.
func CreateDemoReceiptPNG(spec DemoReceiptSpec) (string, string, error) {
	return CreateDemoReceiptPNGToDir(spec, constants.GetProcessedPath())
}

// CreateDemoReceiptPNGToDir renders a readable thermal-style receipt PNG on disk into processedDir and returns its path and SHA-256 hash.
func CreateDemoReceiptPNGToDir(spec DemoReceiptSpec, processedDir string) (string, string, error) {
	if err := os.MkdirAll(processedDir, 0777); err != nil {
		return "", "", err
	}

	outPath := filepath.Join(processedDir, fmt.Sprintf("demo_receipt_%d.png", spec.ReceiptID))

	width, height := 560, 740
	img := image.NewRGBA(image.Rect(0, 0, width, height))

	// Dark slate outer frame + crisp warm paper inner receipt
	frameBg := color.RGBA{26, 29, 36, 255}
	paperBg := color.RGBA{250, 248, 242, 255}
	inkDark := color.RGBA{28, 32, 40, 255}
	inkMuted := color.RGBA{105, 110, 122, 255}
	accent := color.RGBA{16, 185, 129, 255}
	ruleCol := color.RGBA{190, 186, 176, 255}

	draw.Draw(img, img.Bounds(), &image.Uniform{frameBg}, image.Point{}, draw.Src)
	draw.Draw(img, image.Rect(24, 24, width-24, height-24), &image.Uniform{paperBg}, image.Point{}, draw.Src)

	// Top header banner
	draw.Draw(img, image.Rect(24, 24, width-24, 110), &image.Uniform{inkDark}, image.Point{}, draw.Src)
	draw.Draw(img, image.Rect(24, 110, width-24, 116), &image.Uniform{accent}, image.Point{}, draw.Src)

	vendorLines := wrapLine(spec.Vendor, 24)
	drawBitmapText(img, 48, 46, 3, vendorLines[0], color.RGBA{255, 255, 255, 255})
	if len(vendorLines) > 1 {
		drawBitmapText(img, 48, 76, 2, vendorLines[1], color.RGBA{180, 240, 215, 255})
	}

	drawBitmapText(img, 48, 140, 2, fmt.Sprintf("RECEIPT NO: #RM-%05d", spec.ReceiptID), inkMuted)
	drawBitmapText(img, 48, 166, 2, fmt.Sprintf("DATE:       %s", spec.Date), inkDark)
	drawBitmapText(img, 48, 192, 2, fmt.Sprintf("TENDER:     %s", strings.ToUpper(spec.Tender)), inkDark)
	if spec.AccountLabel != "" {
		drawBitmapText(img, 48, 218, 2, fmt.Sprintf("CATEGORY:   %s", spec.AccountLabel), inkMuted)
	}

	drawDottedRule(img, 48, width-48, 254, ruleCol)
	drawBitmapText(img, 48, 274, 2, "ITEM / DESCRIPTION", inkMuted)
	drawDottedRule(img, 48, width-48, 300, ruleCol)

	yPos := 322
	for _, line := range wrapLine(spec.Description, 34) {
		drawBitmapText(img, 48, yPos, 2, line, inkDark)
		yPos += 28
	}

	drawDottedRule(img, 48, width-48, 440, ruleCol)
	drawBitmapText(img, 48, 468, 2, "SUBTOTAL:", inkMuted)
	drawBitmapText(img, 340, 468, 2, spec.Subtotal, inkDark)

	drawBitmapText(img, 48, 500, 2, "SALES TAX:", inkMuted)
	drawBitmapText(img, 340, 500, 2, spec.Tax, inkDark)

	// Highlighted Total bar
	draw.Draw(img, image.Rect(44, 540, width-44, 608), &image.Uniform{inkDark}, image.Point{}, draw.Src)
	drawBitmapText(img, 62, 563, 3, "TOTAL PAID", color.RGBA{167, 243, 208, 255})
	drawBitmapText(img, 330, 563, 3, spec.Total, color.RGBA{255, 255, 255, 255})

	// Footer barcode simulation & demo watermark
	for x := 64; x < width-64; x += 6 {
		barW := 2
		if (x+int(spec.ReceiptID)*7)%12 == 0 {
			barW = 4
		}
		draw.Draw(img, image.Rect(x, 634, min(x+barW, width-64), 664), &image.Uniform{inkDark}, image.Point{}, draw.Src)
	}
	drawBitmapText(img, 96, 680, 2, "DEMO DATA - SAFE TO EDIT OR REMOVE", inkMuted)

	f, err := os.Create(outPath)
	if err != nil {
		return "", "", err
	}
	if err := png.Encode(f, img); err != nil {
		f.Close()
		return "", "", err
	}
	f.Close()
	_ = os.Chmod(outPath, 0666)

	sumBytes, err := os.ReadFile(outPath)
	if err != nil {
		fallback := sha256.Sum256(fmt.Appendf(nil, "demo-receipt-%d-%s-%s", spec.ReceiptID, spec.Vendor, spec.Total))
		return outPath, hex.EncodeToString(fallback[:]), nil
	}
	sum := sha256.Sum256(sumBytes)
	return outPath, hex.EncodeToString(sum[:]), nil
}
