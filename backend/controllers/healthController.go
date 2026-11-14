package controllers

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"reflex-tech-bookkeeping-app-api/constants"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/models"

	"github.com/gofiber/fiber/v3"
)

// SystemHealthResponse provides a comprehensive runtime health report
// covering the database, AI vision/text services, and storage directories.
type SystemHealthResponse struct {
	Status        string                 `json:"status"`
	Company       string                 `json:"company"`
	Timestamp     string                 `json:"timestamp"`
	Database      map[string]interface{} `json:"database"`
	FileProcessor map[string]interface{} `json:"fileProcessor"`
	AiEngine      map[string]interface{} `json:"aiEngine"`
	Storage       map[string]interface{} `json:"storage"`
}

// GetSystemHealth returns detailed status of all subsystems.
func GetSystemHealth(c fiber.Ctx) error {
	companyName := getCompanyName()

	dbStatus := checkDatabaseHealth()
	storageStatus := checkStorageHealth()
	fpStatus := checkFileProcessorHealth()
	aiStatus := checkOllamaHealth()

	overallStatus := computeOverallStatus(dbStatus, storageStatus, fpStatus, aiStatus)

	return c.JSON(SystemHealthResponse{
		Status:        overallStatus,
		Company:       companyName,
		Timestamp:     time.Now().UTC().Format(time.RFC3339),
		Database:      dbStatus,
		FileProcessor: fpStatus,
		AiEngine:      aiStatus,
		Storage:       storageStatus,
	})
}

// getCompanyName fetches the company name from settings or returns the default.
func getCompanyName() string {
	if db.DB != nil {
		var setting models.AppSetting
		if err := db.DB.Where("key = ?", "CompanyName").First(&setting).Error; err == nil && setting.Value != "" {
			return setting.Value
		}
	}
	return "Unnamed Company"
}

// checkDatabaseHealth pings the database and returns status.
func checkDatabaseHealth() map[string]interface{} {
	result := map[string]interface{}{"status": "connected"}
	if db.DB == nil {
		result["status"] = "disconnected"
		return result
	}
	sqlDB, err := db.DB.DB()
	if err != nil || sqlDB.Ping() != nil {
		result["status"] = "error"
		result["error"] = "ping failed"
	}
	return result
}

// checkStorageHealth verifies inbox and processed directories are writable.
func checkStorageHealth() map[string]interface{} {
	inboxPath := constants.GetInboxPath()
	processedPath := constants.GetProcessedPath()

	status := map[string]interface{}{
		"inboxPath":         inboxPath,
		"processedPath":     processedPath,
		"inboxWritable":     isDirWritable(inboxPath),
		"processedWritable": isDirWritable(processedPath),
		"status":            "ready",
	}
	if !isDirWritable(inboxPath) || !isDirWritable(processedPath) {
		status["status"] = "warning"
	}
	return status
}

// isDirWritable creates a temp file and verifies the directory is writable.
func isDirWritable(dir string) bool {
	if dir == "" {
		return false
	}
	_ = os.MkdirAll(dir, 0755)
	testFile := dir + "/.write_test_" + time.Now().Format("150405")
	if err := os.WriteFile(testFile, []byte("ok"), 0644); err != nil {
		return false
	}
	_ = os.Remove(testFile)
	return true
}

// checkFileProcessorHealth checks if the dedicated OCR microservice is reachable.
func checkFileProcessorHealth() map[string]interface{} {
	fpURL := os.Getenv("FILE_PROCESSOR_URL")
	if fpURL == "" {
		fpURL = "http://file-processor:8081/process"
	}
	return checkHTTPHealth(strings.Replace(fpURL, "/process", "/health", 1), 2*time.Second)
}

// checkOllamaHealth queries the Ollama /api/tags endpoint for loaded models.
func checkOllamaHealth() map[string]interface{} {
	ollamaHost := os.Getenv("OLLAMA_HOST")
	if ollamaHost == "" {
		ollamaHost = "ollama:11434"
	}
	if !strings.HasPrefix(ollamaHost, "http://") && !strings.HasPrefix(ollamaHost, "https://") {
		ollamaHost = "http://" + ollamaHost
	}
	return checkOllamaTags(ollamaHost+"/api/tags", 2*time.Second)
}

// computeOverallStatus returns the aggregate health status.
func computeOverallStatus(db, storage, fp, ai map[string]interface{}) string {
	if db["status"] != "connected" {
		return "degraded"
	}
	if storage["status"] == "warning" {
		return "degraded"
	}
	return "healthy"
}

// checkHTTPHealth performs a simple GET health check.
func checkHTTPHealth(url string, timeout time.Duration) map[string]interface{} {
	resp, err := httpGet(url, timeout)
	if err != nil {
		return map[string]interface{}{"status": "unavailable"}
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return map[string]interface{}{"status": "connected", "code": resp.StatusCode}
	}
	return map[string]interface{}{"status": "error", "code": resp.StatusCode}
}

// checkOllamaTags queries Ollama's /api/tags and returns model info.
func checkOllamaTags(url string, timeout time.Duration) map[string]interface{} {
	resp, err := httpGet(url, timeout)
	if err != nil {
		return map[string]interface{}{
			"status": "connecting",
			"ready":  false,
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return map[string]interface{}{
			"status": "degraded",
			"ready":  false,
		}
	}

	var tagsData struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tagsData); err != nil {
		return map[string]interface{}{
			"status": "connected",
			"ready":  true,
		}
	}

	var modelNames []string
	hasVision, hasText := false, false
	for _, m := range tagsData.Models {
		modelNames = append(modelNames, m.Name)
		if strings.Contains(m.Name, "qwen2.5vl") {
			hasVision = true
		}
		if strings.Contains(m.Name, "llama3.1") {
			hasText = true
		}
	}

	ready := hasVision && hasText
	status := "ready"
	if !ready {
		if len(modelNames) == 0 {
			status = "no_models_loaded"
		} else {
			status = "downloading_models"
		}
	}

	return map[string]interface{}{
		"status":       status,
		"ready":        ready,
		"models":       modelNames,
		"hasVision":    hasVision,
		"hasTextModel": hasText,
	}
}

// httpGet is a helper that performs an HTTP GET with timeout.
func httpGet(url string, timeout time.Duration) (*http.Response, error) {
	client := http.Client{Timeout: timeout}
	return client.Get(url)
}
