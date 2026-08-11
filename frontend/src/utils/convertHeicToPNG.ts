import heic2any from "heic2any";

/**
 * Converts a HEIC image URL to a PNG Object URL.
 * Returns a string that can be used directly in an <img src={...} /> tag.
 */
const convertHeicToPng = async (heicImageUrl: string): Promise<string> => {
  try {
    // 1. Fetch the HEIC file and turn it into a Blob
    const response = await fetch(heicImageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch HEIC image from ${heicImageUrl}`);
    }
    const blob = await response.blob();

    // 2. Convert the HEIC Blob to a PNG Blob
    const conversionResult = await heic2any({
      blob,
      toType: "image/png",
    });

    // 3. Handle the return type (heic2any can sometimes return an array of blobs)
    const pngBlob = Array.isArray(conversionResult) 
      ? conversionResult[0] 
      : conversionResult;

    // 4. Create and return a local browser URL that points to this new PNG
    return URL.createObjectURL(pngBlob);

  } catch (error) {
    console.error("HEIC Conversion Failed:", error);
    // Rethrow the error so your React component knows the conversion failed
    throw error; 
  }
};

export default convertHeicToPng;