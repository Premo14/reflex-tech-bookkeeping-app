import { useEffect, useState } from "react";
import convertHeicToPng from "./utils/convertHeicToPNG";

interface HeicViewerProps {
  heicUrl: string;
}

export function HeicViewer({ heicUrl }: HeicViewerProps) {
  const [imgSrc, setImgSrc] = useState<string | undefined>(undefined);
  
  const [hasError, setHasError] = useState<boolean>(false);

  useEffect(() => {
    const loadAndConvertImage = async () => {
      try {
        const pngUrl = await convertHeicToPng(heicUrl);
        setImgSrc(pngUrl);
      } catch (err) {
        console.error("Failed to load HEIC receipt:", err);
        setHasError(true);
      }
    };

    loadAndConvertImage();
  }, [heicUrl]);

  // Loading state while heic2any does its job
  if (!imgSrc && !hasError) {
    return <p className="text-black animate-pulse py-12">Converting iPhone receipt...</p>;
  }

  // Error fallback
  if (hasError) {
    return <p className="text-red-500 py-12">Error loading HEIC file.</p>;
  }

  // Final render 
  return (
    <img
      src={imgSrc}
      alt="Converted HEIC receipt"
      className="max-h-150 w-auto object-contain rounded shadow-sm"
    />
  );
}

function App() {

    return (
    // Main background wrapper
    <div className="min-h-screen bg-gray-50 p-8 font-sans">
      
      {/* Centered container to constrain the maximum width */}
      <div className="max-w-4xl mx-auto space-y-12">

        {/* 1. Image Receipt Card */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-black mb-4">Mobile Image Capture</h2>
          {/* A soft background pad to frame the image nicely */}
          <div className="flex justify-center bg-gray-100 rounded-lg p-4 border border-gray-200">
            <img
              src="/mock_receipts/walmart-receipt.png"
              alt="Walmart receipt"
              // object-contain ensures it never stretches weirdly, max-h keeps it manageable 
              className="max-h-150 w-auto object-contain rounded shadow-sm"
            />
          </div>
        </section>

        {/* 2. HEIC Image Receipt Card */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-black mb-4">Mobile Image Capture (.heic)</h2>
          {/* We added min-h-[200px] and items-center here so the "Converting..." text sits nicely in the middle */}
          <div className="flex justify-center items-center bg-gray-100 rounded-lg p-4 border border-gray-200 min-h-50">
            
            {/* Inject our new component and pass the local path */}
            <HeicViewer heicUrl="/mock_receipts/image1.heic" />
            
          </div>
        </section>

        {/* 3. Standard PDF Card */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-black mb-4">PDF Document</h2>
          {/* overflow-hidden ensures the iframe doesn't break out of our rounded corners */}
          <div className="rounded-lg overflow-hidden border border-gray-300">
            <iframe
              src="/mock_receipts/apremo_resume.pdf"
              title="PDF Receipt"
              className="w-full h-200"
            />
          </div>
        </section>

        {/* 4. Email HTML Card (Sandboxed) */}
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-black mb-4">Email HTML (Sandboxed)</h2>
          <div className="rounded-lg overflow-hidden border border-gray-300">
            <iframe 
              src="/mock_receipts/email-html.html" 
              sandbox=""
              title="Email Receipt"
              // Forced white background inside the frame just in case the raw HTML has no background set
              className="w-full h-200 bg-white" 
            />
          </div>
        </section>

      </div>
    </div>
  )
}

export default App