package utils

import (
	"image/png"
	"os"

	"github.com/adrium/goheif"
)

// ConvertHeicToPng reads a HEIC file at inputPath, converts it to PNG,
// saves it alongside the original, and returns the new file path.
func ConvertHeicToPng(inputPath, outputPath string) error {

	// Open the input file
	file, err := os.Open(inputPath)
	if err != nil {
		return err
	}

	// Defer closing the input file
	file.Close()

	// Call goheif.Decode() to get an image.Image
	imgDecoded, err := goheif.Decode(file)
	if err != nil {
		return err
	}

	// Create the output file
	createdFile, err := os.Create(outputPath)
	if err != nil {
		return err
	}

	// returns an error if failed to close the new created file
	createdFile.Close()

	// Write the PNG bytes into the output file
	err = png.Encode(createdFile, imgDecoded)
	if err != nil {
		return err
	}

	return nil
}
