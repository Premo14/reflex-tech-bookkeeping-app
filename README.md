# reflex-tech-bookkeeping-app
Bookkeeping project for Reflex Technologies

## How to Run

#### 1. Clone the repo
```bash
git clone <SSH Key>
```

#### 2. Install dependencies
```bash
cd reflex-bookkeeping-app/frontend
npm install
```

#### 3. Run the app
```bash
npm run dev
```

## Current Notes

### Frontend

- Currently use heic2any library to convert .heic files to PNGs because they are browser friendly and PNGs are the highest quality of compressed image file extensions (outside of SVGs). Also, both Tesseract and Textract only support JPEG, JPG, PNG, PDF, TIF, and TIFF.

#### How to use heic2any

```typescript
import heic2any from "heic2any";
// or
const heic2any = require("heic2any");
// skip the lines above if you're not using a module bundler

// fetching the heic image
fetch("./my-image.heic")
	.then((res) => res.blob())
	.then((blob) => heic2any({ blob }))
	.then((conversionResult) => {
		// conversionResult is a BLOB
		// of the PNG formatted image
	})
	.catch((e) => {
		// see error handling section
	});
```

#### Important

- Embedding HTML is a XSS security risk, to ensure there is no risk, embedded HTML emails need to be put in `<iframe sandbox="">` tags. the `sandbox=""` makes sure scripts cannot be run.
