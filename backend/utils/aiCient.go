package utils

import "github.com/gofiber/fiber/v3"

func PassImageOrPdfToAI(id uint, path string, c fiber.Ctx) {
	type payload struct {
		receiptId uint
		filePath  string
	}

}
