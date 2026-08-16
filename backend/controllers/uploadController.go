package controllers

import (
	"path/filepath"
	"reflex-tech-bookkeeping-app-api/constants"

	"github.com/gofiber/fiber/v3"
	"github.com/google/uuid"
)

// UploadFile receives a file from the frontend and saves it to the inbox.
// Thanks to watcher.go, we just need to save it and return success.
func UploadFile(c fiber.Ctx) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "No file uploaded"})
	}

	ext := filepath.Ext(file.Filename)

	if !constants.IsAllowedReceiptExt(ext) && !constants.IsAllowedBankStatementExt(ext) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Unsupported file type"})
	}

	safeFileName := uuid.New().String() + ext
	savePath := filepath.Join(constants.InboxPath, safeFileName)

	if err := c.SaveFile(file, savePath); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to save file"})
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":  "success",
		"message": "File uploaded and sent to the processing queue.",
	})
}
