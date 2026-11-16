package controllers

import (
	"fmt"
	"os"
	"path/filepath"
	"reflex-tech-bookkeeping-app-api/constants"
	"reflex-tech-bookkeeping-app-api/db"
	"reflex-tech-bookkeeping-app-api/events"
	"reflex-tech-bookkeeping-app-api/models"
	"reflex-tech-bookkeeping-app-api/utils"
	"sort"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"gorm.io/gorm"
)

// allowedSettingsKeys defines the set of settings that can be updated via UpdateSettings.
// This prevents accidental or malicious overwrites of internal/unknown keys.
var allowedSettingsKeys = map[string]bool{
	"CompanyDefaultName":       true,
	"DocumentDropboxPath":      true,
	"BooksClosedDate":          true,
	"HostHomePath":             true,
	"CompanyName":              true,
	"Currency":                 true,
	"FiscalYearStart":          true,
}

// GetSettings retrieves all global settings.
func GetSettings(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "database not initialized"})
	}

	var settings []models.AppSetting
	if err := db.DB.Find(&settings).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch settings"})
	}

	// Convert slice to key-value map for frontend convenience
	settingsMap := make(map[string]string)
	for _, s := range settings {
		settingsMap[s.Key] = s.Value
	}

	// Also find earliest date across bank transactions and expenses
	var minTx *time.Time
	db.DB.Model(&models.BankTransaction{}).Where("review_status NOT IN ('DELETED')").Select("MIN(date)").Row().Scan(&minTx)
	var minExp *time.Time
	db.DB.Model(&models.Expense{}).Where("review_status NOT IN ('DELETED')").Select("MIN(timestamp)").Row().Scan(&minExp)

	var earliest *time.Time
	if minTx != nil {
		earliest = minTx
	}
	if minExp != nil && (earliest == nil || minExp.Before(*earliest)) {
		earliest = minExp
	}
	if earliest != nil && !earliest.IsZero() {
		settingsMap["EarliestDate"] = earliest.Format("2006-01-02")
	}

	// Ensure DocumentDropboxPath and HostHomePath are present
	if _, ok := settingsMap["DocumentDropboxPath"]; !ok || settingsMap["DocumentDropboxPath"] == "" {
		settingsMap["DocumentDropboxPath"] = constants.GetCurrentHostPath()
	}
	settingsMap["HostHomePath"] = constants.DetectHostHomeDir()

	return c.JSON(settingsMap)
}

// UpdateSettings updates a specific global setting.
func UpdateSettings(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "database not initialized"})
	}

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

	// Whitelist check: reject updates to non-allowed settings keys
	if !allowedSettingsKeys[input.Key] {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("setting key '%s' is not allowed for updates", input.Key),
		})
	}

	// Custom Validation and Dynamic Configuration for DocumentDropboxPath
	var movedOldContainer, movedNewContainer string
	if input.Key == "DocumentDropboxPath" {
		hostPath := strings.TrimSpace(input.Value)
		if hostPath == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Dropbox path cannot be empty"})
		}

		movedOldContainer = constants.GetCurrentContainerDir()
		containerDir, err := constants.MoveDropboxLocation(hostPath)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": fmt.Sprintf("Failed to move directory to '%s': %v", hostPath, err),
			})
		}
		movedNewContainer = containerDir

		// Ensure setting stores the normalized host path ending in document-data
		input.Value = constants.GetCurrentHostPath()

		if err := utils.RestartWatcher(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": fmt.Sprintf("Directory moved to %s, but file watcher failed to start: %v", containerDir, err),
			})
		}
	}

	// Custom Validation for BooksClosedDate
	if input.Key == "BooksClosedDate" && input.Value != "" {
		pf, err := computeClosePreflight(input.Value)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid closing date."})
		}
		if !pf.CanClose {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": fmt.Sprintf("Cannot close books: %d unlinked bank transaction(s), %d unlinked expense(s) and %d item(s) pending review fall on or before this date. Every item in a closed period must be linked or excluded.", pf.UnlinkedTxCount, pf.UnlinkedExpCount, pf.PendingCount),
			})
		}
	}

	// Fetch previous setting to determine action
	var prevSetting models.AppSetting
	prevValue := ""
	if err := db.DB.Where("key = ?", input.Key).First(&prevSetting).Error; err == nil {
		prevValue = prevSetting.Value
	}

	setting := models.AppSetting{
		Key:   input.Key,
		Value: input.Value,
	}

	tx := db.DB.Begin()

	// Update or Create the setting
	if err := tx.Save(&setting).Error; err != nil {
		tx.Rollback()
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update setting"})
	}

	// Insert Audit Log if BooksClosedDate changed
	if input.Key == "BooksClosedDate" && prevValue != input.Value {
		action := "MODIFIED"
		if input.Value == "" {
			action = "UNLOCKED"
		} else if prevValue == "" {
			action = "LOCKED"
		} else if input.Value > prevValue {
			action = "LOCKED (Advanced)"
		} else {
			action = "UNLOCKED (Rolled Back)"
		}

		auditLog := models.PeriodAuditLog{
			Action:       action,
			PreviousDate: prevValue,
			NewDate:      input.Value,
			Reason:       "Manual Update",
		}
		if err := tx.Create(&auditLog).Error; err != nil {
			tx.Rollback()
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to write audit log"})
		}
	}

	if movedOldContainer != "" && movedNewContainer != "" && movedOldContainer != movedNewContainer {
		if err := rewriteStoredURIsInTx(tx, movedOldContainer, movedNewContainer); err != nil {
			tx.Rollback()
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to update stored document paths after move"})
		}
	}

	tx.Commit()
	events.Broadcast("SETTINGS_UPDATED", nil)
	if input.Key == "BooksClosedDate" {
		events.Broadcast("QUEUE_UPDATED", nil)
	}
	return c.JSON(setting)
}

func rewriteStoredURIsInTx(tx *gorm.DB, oldBase, newBase string) error {
	if tx.Migrator().HasTable(&models.Receipt{}) {
		var receipts []models.Receipt
		if err := tx.Select("id", "document_uri").Find(&receipts).Error; err != nil {
			return err
		}
		for _, r := range receipts {
			if updated, ok := constants.RewriteStoredPathPrefix(r.DocumentURI, oldBase, newBase); ok {
				if err := tx.Model(&models.Receipt{}).Where("id = ?", r.ID).Update("document_uri", updated).Error; err != nil {
					return err
				}
			}
		}
	}
	if tx.Migrator().HasTable(&models.BankStatement{}) {
		var statements []models.BankStatement
		if err := tx.Select("id", "document_uri").Find(&statements).Error; err != nil {
			return err
		}
		for _, s := range statements {
			if updated, ok := constants.RewriteStoredPathPrefix(s.DocumentURI, oldBase, newBase); ok {
				if err := tx.Model(&models.BankStatement{}).Where("id = ?", s.ID).Update("document_uri", updated).Error; err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// GetAuditLogs retrieves history of BooksClosedDate changes.
func GetAuditLogs(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "database not initialized"})
	}

	var logs []models.PeriodAuditLog
	if err := db.DB.Order("created_at DESC").Find(&logs).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to fetch audit logs"})
	}
	return c.JSON(logs)
}

// ClosePreflight describes whether the books can be closed through a given date.
type ClosePreflight struct {
	Date                string      `json:"date"`
	CanClose            bool        `json:"canClose"`
	UnlinkedTxCount     int64       `json:"unlinkedTxCount"`
	UnlinkedExpCount    int64       `json:"unlinkedExpCount"`
	PendingCount        int64       `json:"pendingCount"`
	UnlinkedTxSamples   []GroupItem `json:"unlinkedTxSamples"`
	UnlinkedExpSamples  []GroupItem `json:"unlinkedExpSamples"`
	EarliestBlockerDate string      `json:"earliestBlockerDate"`
	ExcludedTxCount       int64        `json:"excludedTxCount"`
	ExcludedExpCount      int64        `json:"excludedExpCount"`
	ExcludedTxTotal       models.Money `json:"excludedTxTotal"`
	ExcludedExpTotal      models.Money `json:"excludedExpTotal"`
	UncategorizedTxCount  int64        `json:"uncategorizedTxCount"`
	UncategorizedExpCount int64       `json:"uncategorizedExpCount"`
}

const unresolvedCondition = "(review_status IS NULL OR review_status = '' OR review_status = 'APPROVED') AND (allocation_status IS NULL OR allocation_status != 'BALANCED')"

func computeClosePreflight(dateStr string) (ClosePreflight, error) {
	pf := ClosePreflight{Date: dateStr, UnlinkedTxSamples: []GroupItem{}, UnlinkedExpSamples: []GroupItem{}}
	closeDate, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		return pf, err
	}
	// Exclusive upper bound so items stamped any time on the closing day are included.
	before := closeDate.AddDate(0, 0, 1)

	var earliest time.Time
	track := func(t time.Time) {
		if earliest.IsZero() || t.Before(earliest) {
			earliest = t
		}
	}

	// Unlinked bank transactions
	var txs []models.BankTransaction
	db.DB.Where("date < ?", before).Where(unresolvedCondition).Order("date ASC").Find(&txs)
	pf.UnlinkedTxCount = int64(len(txs))
	for i, t := range txs {
		track(t.Date)
		if i < 5 {
			pf.UnlinkedTxSamples = append(pf.UnlinkedTxSamples, GroupItem{"transaction", t.ID, t.Description, t.Date, t.Amount, t.ReviewStatus})
		}
	}

	// Unlinked expenses
	var exps []models.Expense
	db.DB.Where("timestamp < ?", before).Where(unresolvedCondition).Where(notCashClause).Order("timestamp ASC").Find(&exps)
	pf.UnlinkedExpCount = int64(len(exps))
	for i, e := range exps {
		track(e.Timestamp)
		if i < 5 {
			pf.UnlinkedExpSamples = append(pf.UnlinkedExpSamples, GroupItem{"expense", e.ID, e.Vendor + " " + e.Description, e.Timestamp, e.Amount, e.ReviewStatus})
		}
	}

	// Items still awaiting closed-period review
	var pendTx, pendExp int64
	db.DB.Model(&models.BankTransaction{}).Where("date < ? AND review_status = ?", before, "PENDING").Count(&pendTx)
	db.DB.Model(&models.Expense{}).Where("timestamp < ? AND review_status = ?", before, "PENDING").Count(&pendExp)
	pf.PendingCount = pendTx + pendExp
	if pf.PendingCount > 0 {
		var t time.Time
		if err := db.DB.Model(&models.BankTransaction{}).Where("date < ? AND review_status = ?", before, "PENDING").Select("MIN(date)").Row().Scan(&t); err == nil && !t.IsZero() {
			track(t)
		}
		var e time.Time
		if err := db.DB.Model(&models.Expense{}).Where("timestamp < ? AND review_status = ?", before, "PENDING").Select("MIN(timestamp)").Row().Scan(&e); err == nil && !e.IsZero() {
			track(e)
		}
	}

	// Informational: excluded items in range (these never block closing).
	// SUM returns decimal dollars from the DB; wrap in models.Money for integer cents + dollar JSON serialization.
	var excludedTxFloat, excludedExpFloat float64
	db.DB.Model(&models.BankTransaction{}).Where("date < ? AND review_status = ?", before, "IGNORED").
		Select("COUNT(*), COALESCE(SUM(ABS(amount)), 0)").Row().Scan(&pf.ExcludedTxCount, &excludedTxFloat)
	pf.ExcludedTxTotal = models.NewMoney(excludedTxFloat)
	db.DB.Model(&models.Expense{}).Where("timestamp < ? AND review_status = ?", before, "IGNORED").
		Select("COUNT(*), COALESCE(SUM(amount), 0)").Row().Scan(&pf.ExcludedExpCount, &excludedExpFloat)
	pf.ExcludedExpTotal = models.NewMoney(excludedExpFloat)

	// Uncategorized items: in books but missing category (excluding confirmed-linked split transactions and LIABILITY card payment credits)
	db.DB.Model(&models.BankTransaction{}).
		Where("date < ?", before).
		Where(inBooksClause).
		Where("amount != 0").
		Where("category_account_id IS NULL").
		Where("(id NOT IN (SELECT bank_transaction_id FROM expense_bank_transactions WHERE status = 'confirmed') OR (amount < 0 AND allocation_status IN ('PARTIALLY_ALLOCATED', 'PARTIAL')))").
		Where("NOT (amount > 0 AND chart_account_id IN (SELECT id FROM chart_accounts WHERE type = 'LIABILITY'))").
		Count(&pf.UncategorizedTxCount)

	db.DB.Model(&models.Expense{}).
		Where("timestamp < ?", before).
		Where(inBooksClause).
		Where("chart_account_id IS NULL").
		Count(&pf.UncategorizedExpCount)

	if !earliest.IsZero() {
		pf.EarliestBlockerDate = earliest.Format("2006-01-02")
	}
	pf.CanClose = pf.UnlinkedTxCount == 0 && pf.UnlinkedExpCount == 0 && pf.PendingCount == 0
	return pf, nil
}

// GetClosePreflight reports what (if anything) prevents closing the books through ?date=YYYY-MM-DD.
func GetClosePreflight(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "database not initialized"})
	}

	date := c.Query("date")
	if date == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "date is required"})
	}
	pf, err := computeClosePreflight(date)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "date must be YYYY-MM-DD"})
	}
	return c.JSON(pf)
}

// BrowseDirectories lists subdirectories at the requested host path.
func BrowseDirectories(c fiber.Ctx) error {
	if db.DB == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "database not initialized"})
	}

	defaultHome := constants.DetectHostHomeDir()
	reqPath := strings.TrimSpace(c.Query("path"))
	if reqPath == "" {
		reqPath = defaultHome
	}

	cleaned := filepath.Clean(reqPath)
	if strings.HasPrefix(cleaned, "~") {
		cleaned = filepath.Join(defaultHome, strings.TrimPrefix(cleaned, "~"))
	}
	if strings.HasPrefix(cleaned, "home/") || strings.HasPrefix(cleaned, "Users/") {
		cleaned = "/" + cleaned
	}

	// Sandboxing: confine browsing strictly to the host user's home directory
	// Append "/" to prefix to prevent /Users/aj matching /Users/aj2
	if defaultHome != "" && defaultHome != "/" {
		safePrefix := defaultHome + "/"
		if cleaned != defaultHome && !strings.HasPrefix(cleaned, safePrefix) {
			cleaned = defaultHome
		}
	}

	containerPath := constants.ResolveHostToContainer(cleaned)

	fi, err := os.Stat(containerPath)
	if err != nil || !fi.IsDir() {
		// Fallback to detected host home if requested path is missing
		cleaned = defaultHome
		containerPath = constants.ResolveHostToContainer(cleaned)
		fi, err = os.Stat(containerPath)
		if err != nil || !fi.IsDir() {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot access user directory"})
		}
	}

	entries, err := os.ReadDir(containerPath)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": fmt.Sprintf("Cannot access path: %v", err)})
	}

	var dirs []string
	for _, e := range entries {
		// Only list non-hidden directories
		if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
			dirs = append(dirs, e.Name())
		}
	}
	sort.Strings(dirs)

	parent := filepath.Dir(cleaned)
	if parent == cleaned || cleaned == defaultHome || len(parent) < len(defaultHome) {
		parent = ""
	} else {
		// Also guard against prefix-suffix collision
		if !strings.HasPrefix(parent, defaultHome+"/") {
			parent = ""
		}
	}

	return c.JSON(fiber.Map{
		"currentPath": cleaned,
		"parentPath":  parent,
		"directories": dirs,
	})
}
