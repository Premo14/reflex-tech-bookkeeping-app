package constants

import "strings"

// Dropbox location for raw files to be processed
const InboxPath = "/app/documents/inbox"

// After processing this is where files are saved
const ProcessedPath = "/app/documents/processed"

/*
	Allowed receipt extensions.

If we make this map exportable it means it could be mutated.
That is why it is a map of structs that is only available by
calling IsAllowedReceiptExt()
*/
var allowedReceiptExt = map[string]struct{}{
	".png":  {},
	".jpg":  {},
	".jpeg": {},
	".heic": {},
	".pdf":  {},
}

// Checks if extension is allowed by receipts
func IsAllowedReceiptExt(ext string) bool {
	ext = strings.ToLower(strings.TrimSpace(ext))
	// Ensure extension starts with a dot (reject bare names like "png")
	if len(ext) == 0 || ext[0] != '.' {
		return false
	}
	_, ok := allowedReceiptExt[ext]
	return ok
}

/*
	Allowed bank statement extensions.

If we make this map exportable it means it could be mutated.
That is why it is a map of structs that is only available by
calling IsAllowedBankStatementExt()
*/
var allowedBankStatementExt = map[string]struct{}{
	".ofx": {},
	".qfx": {},
	".qbo": {},
}

// Checks if extension is allowed by bank statements
func IsAllowedBankStatementExt(ext string) bool {
	ext = strings.ToLower(strings.TrimSpace(ext))
	// Ensure extension starts with a dot (reject bare names like "ofx")
	if len(ext) == 0 || ext[0] != '.' {
		return false
	}
	_, ok := allowedBankStatementExt[ext]
	return ok
}
