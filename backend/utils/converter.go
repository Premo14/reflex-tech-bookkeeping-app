package utils

import (
	"image/png"
	"os"

	"github.com/adrium/goheif"
)

// ConvertHeicToPng decodes iphone HEIC images and saves them as PNGs
// so they can be viewed in a standard browser.
func ConvertHeicToPng(inputPath, outputPath string) error {

	// Open the original HEIC file
	file, err := os.Open(inputPath)
	if err != nil {
		return err
	}
	defer file.Close()

	// Decode the HEIC byte stream into a generic Go image.Image object
	imgDecoded, err := goheif.Decode(file)
	if err != nil {
		return err
	}

	// Create the new empty output file for the PNG
	createdFile, err := os.Create(outputPath)
	if err != nil {
		return err
	}
	defer createdFile.Close()

	// Take the generic image.Image object and encode it into the empty file using PNG formatting
	err = png.Encode(createdFile, imgDecoded)
	if err != nil {
		return err
	}

	return nil
}
