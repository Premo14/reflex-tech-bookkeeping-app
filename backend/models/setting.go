package models

import "time"

// AppSetting stores global application configuration (e.g., BooksClosedDate)
type AppSetting struct {
	Key       string `gorm:"primaryKey" json:"key"`
	Value     string `json:"value"`
	UpdatedAt time.Time `json:"updatedAt"`
}
