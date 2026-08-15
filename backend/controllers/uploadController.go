package controllers

import "github.com/gofiber/fiber/v3"

// UploadFile receives a file from the frontend and saves it to the inbox.
// Thanks to watcher.go, we just need to save it and return success!
func UploadFile(c fiber.Ctx) error {
	// 1. Extract the file from the form data: file, err := c.FormFile("file")
	// 2. Save it to constants.InboxPath + file.Filename using c.SaveFile()

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "not implemented",
	})
}
