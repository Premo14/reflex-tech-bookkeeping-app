package utils

import (
	"image/png"
	"os"

	"github.com/adrium/goheif"
)

/*
ConvertHeicToPng is a necessary utility because standard web browsers cannot natively display HEIC images
(the default photo format for modern iPhones), nor can image translators. When a user uploads an iPhone photo of a
receipt, we use this function to decode the HEIC file and encode it into a standard PNG format that our frontend
can render.
*/
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
