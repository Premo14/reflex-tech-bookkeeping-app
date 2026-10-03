package controllers

import (
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"

	"github.com/gofiber/fiber/v3"
)

// GetSettings retrieves all global settings.
func GetSettings(c fiber.Ctx) error {
	var settings []models.AppSetting
	if err := db.DB.Find(&settings).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch settings"})
	}

	// Convert slice to key-value map for frontend convenience
	settingsMap := make(map[string]string)
	for _, s := range settings {
		settingsMap[s.Key] = s.Value
	}

	return c.JSON(settingsMap)
}

// UpdateSettings updates a specific global setting.
func UpdateSettings(c fiber.Ctx) error {
	var input struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	if err := c.Bind().JSON(&input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid input format"})
	}
	if input.Key == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Key is required"})
	}

	setting := models.AppSetting{
		Key:   input.Key,
		Value: input.Value,
	}

	// Update or Create the setting
	if err := db.DB.Save(&setting).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update setting"})
	}

	return c.JSON(setting)
}
