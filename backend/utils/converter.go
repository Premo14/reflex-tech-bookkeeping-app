package utils

import (
	"image/png"
	"log"
	"os"
	"strings"

	"github.com/adrium/goheif"
)

// ConvertHeicToPng reads a HEIC file at inputPath, converts it to PNG,
// saves it alongside the original, and returns the new file path.
func ConvertHeicToPng(inputPath string) (outputPath string, err error) {

	// 1. Open the input file
	file, err := os.Open(inputPath)
	if err != nil {
		return "", err
	}

	// 2. Defer closing the input file (close errors here are harmless, just log)
	defer func() {
		if err := file.Close(); err != nil {
			log.Println("Error closing input file:", err)
		}
	}()

	// 3. Call goheif.Decode() to get an image.Image
	imgDecoded, err := goheif.Decode(file)
	if err != nil {
		return "", err
	}

	// 4. Build the output path (same dir, .png extension)
	trimmedPath := strings.TrimSuffix(inputPath, ".heic")
	outputPath = trimmedPath + ".png"

	// 5. Create the output file
	createdFile, err := os.Create(outputPath)
	if err != nil {
		return "", err
	}

	// returns an error if failed to close the new created file
	defer func() {
		if cerr := createdFile.Close(); cerr != nil && err == nil {
			err = cerr
		}
	}()

	// 7. Write the PNG bytes into the output file
	err = png.Encode(createdFile, imgDecoded)
	if err != nil {
		return "", err
	}

	// 8. Return the output path (err is nil at this point)
	return outputPath, nil
}
