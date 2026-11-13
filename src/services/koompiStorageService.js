import path from "path";

const DEFAULT_BASE_URL = "https://api-kconsole.koompi.cloud";

/**
 * Checks if KOOMPI Cloud Storage is configured.
 */
export const isKoompiStorageConfigured = () => {
  return Boolean(process.env.KOOMPI_STORAGE_API_KEY);
};

/**
 * Upload a file buffer to KOOMPI Cloud Object Storage.
 *
 * Steps:
 * 1. POST /api/storage/upload-token to get pre-signed upload URL & objectId
 * 2. PUT binary data directly to Cloudflare R2 with Content-Type & Cache-Control
 * 3. POST /api/storage/complete to confirm upload
 * 4. GET /api/storage/objects/{objectId}/url to fetch permanent public CDN URL
 *
 * @param {Object} params
 * @param {Buffer} params.buffer - Raw file buffer
 * @param {string} params.originalname - Original file name (e.g. car.jpg)
 * @param {string} params.mimetype - MIME type (e.g. image/jpeg)
 * @param {number} params.size - File size in bytes
 * @param {string} [params.path="cars"] - Virtual folder path
 * @returns {Promise<{ url: string, objectId: string, key: string }>}
 */
export const uploadFileToKoompi = async ({
  buffer,
  originalname,
  mimetype,
  size,
  path: folderPath = "cars",
}) => {
  const apiKey = process.env.KOOMPI_STORAGE_API_KEY;
  const baseUrl = (process.env.KOOMPI_STORAGE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");

  if (!apiKey) {
    throw new Error("KOOMPI_STORAGE_API_KEY is not configured");
  }

  const cleanFilename = path.basename(originalname || "image.jpg");
  const fileSize = size || buffer.length;

  // Step A: Request upload token
  const tokenRes = await fetch(`${baseUrl}/api/storage/upload-token`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filename: cleanFilename,
      contentType: mimetype || "application/octet-stream",
      size: fileSize,
      visibility: "public",
      path: folderPath,
      conflictResolution: "rename",
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.success || !tokenData.data?.uploadUrl) {
    throw new Error(
      `Failed to get KOOMPI upload token (${tokenRes.status}): ${
        tokenData.message || tokenData.error || JSON.stringify(tokenData)
      }`
    );
  }

  const { uploadUrl, objectId, key } = tokenData.data;

  // Step B: Upload raw binary to pre-signed URL (Cloudflare R2)
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimetype || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000",
    },
    body: buffer,
  });

  if (!putRes.ok) {
    throw new Error(`Failed to upload binary to storage URL (${putRes.status}): ${putRes.statusText}`);
  }

  // Step C: Confirm and complete upload
  const completeRes = await fetch(`${baseUrl}/api/storage/complete`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ objectId }),
  });

  const completeData = await completeRes.json();
  if (!completeRes.ok || !completeData.success) {
    throw new Error(
      `Failed to confirm KOOMPI upload (${completeRes.status}): ${
        completeData.message || completeData.error || JSON.stringify(completeData)
      }`
    );
  }

  // Step D: Retrieve permanent public URL
  const urlRes = await fetch(`${baseUrl}/api/storage/objects/${objectId}/url`, {
    headers: {
      "x-api-key": apiKey,
    },
  });

  const urlData = await urlRes.json();
  let publicUrl = urlData.data?.url;

  // Fallback: If not returned directly, fallback to known public CDN path or objectId
  if (!publicUrl && key) {
    publicUrl = `https://storage.koompi.cloud/${key}`;
  }

  return {
    url: publicUrl,
    objectId,
    key,
  };
};

/**
 * Delete an object from KOOMPI Cloud Storage by key or objectId.
 *
 * @param {string} identifier - Object URL, key, or objectId
 */
export const deleteFileFromKoompi = async (identifier) => {
  const apiKey = process.env.KOOMPI_STORAGE_API_KEY;
  const baseUrl = (process.env.KOOMPI_STORAGE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");

  if (!apiKey || !identifier) return;

  try {
    let targetKey = identifier;
    if (identifier.startsWith("http://") || identifier.startsWith("https://")) {
      const urlObj = new URL(identifier);
      targetKey = urlObj.pathname.replace(/^\/+/, "");
    }

    const res = await fetch(`${baseUrl}/api/storage/objects?key=${encodeURIComponent(targetKey)}`, {
      method: "DELETE",
      headers: {
        "x-api-key": apiKey,
      },
    });

    if (!res.ok) {
      if (/^[0-9a-fA-F]{24}$/.test(identifier)) {
        await fetch(`${baseUrl}/api/storage/objects/${identifier}`, {
          method: "DELETE",
          headers: {
            "x-api-key": apiKey,
          },
        });
      }
    }
  } catch (err) {
    console.warn(`[KOOMPI Storage] Failed to delete object (${identifier}):`, err.message);
  }
};
