package constants

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
}

// Checks if extension is allowed by bank statements
func IsAllowedBankStatementExt(ext string) bool {
	_, ok := allowedBankStatementExt[ext]
	return ok
}
