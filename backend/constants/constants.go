package constants

const InboxPath = "/app/documents/inbox"
const ProcessedPath = "/app/documents/processed"

var allowedReceiptExt = map[string]struct{}{
	".png":  {},
	".jpg":  {},
	".jpeg": {},
	".heic": {},
	".pdf":  {},
	".html": {},
}

func IsAllowedReceiptExt(ext string) bool {
	_, ok := allowedReceiptExt[ext]
	return ok
}

var allowedBankStatementExt = map[string]struct{}{
	".ofx": {},
	".qfx": {},
	".csv": {},
}

func IsAllowedBankStatementExt(ext string) bool {
	_, ok := allowedBankStatementExt[ext]
	return ok
}
