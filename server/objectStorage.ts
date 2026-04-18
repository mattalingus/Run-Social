import { Storage } from "@google-cloud/storage";
import sharp from "sharp";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID!;

const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  } as any,
  projectId: "",
});

const bucket = objectStorageClient.bucket(BUCKET_ID);

async function stripExif(buffer: Buffer, contentType: string): Promise<{ buffer: Buffer; contentType: string }> {
  try {
    const image = sharp(buffer);
    const metadata = await image.metadata();
    const format = metadata.format;
    if (!format || ["gif", "svg"].includes(format)) {
      return { buffer, contentType };
    }

    // HEIC/HEIF images (from iPhone cameras) must be converted to JPEG so that
    // Android devices and web browsers can render them.  The conversion also
    // strips EXIF GPS metadata in the same pass.
    const isHeic =
      format === "heif" ||
      contentType === "image/heic" ||
      contentType === "image/heif";

    if (isHeic) {
      const converted = await image
        .rotate()
        .jpeg({ quality: 85 })
        .withMetadata({ exif: {} })
        .toBuffer();
      return { buffer: converted, contentType: "image/jpeg" };
    }

    const stripped = await image
      .rotate()
      .withMetadata({ exif: {} })
      .toBuffer();
    const outContentType = format === "jpeg" ? "image/jpeg" : format === "png" ? "image/png" : format === "webp" ? "image/webp" : contentType;
    return { buffer: stripped, contentType: outContentType };
  } catch {
    return { buffer, contentType };
  }
}

export async function uploadPhotoBuffer(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  const { buffer: cleanBuffer, contentType: cleanContentType } = await stripExif(buffer, contentType);

  const objectPath = `public/photos/${filename}`;
  const file = bucket.file(objectPath);

  await file.save(cleanBuffer, {
    metadata: { contentType: cleanContentType },
    resumable: false,
  });

  try {
    await file.makePublic();
    return `https://storage.googleapis.com/${BUCKET_ID}/${objectPath}`;
  } catch {
    return `/api/objects/${objectPath}`;
  }
}

export async function streamObject(objectPath: string) {
  const file = bucket.file(objectPath);
  const [metadata] = await file.getMetadata();
  const contentType = (metadata.contentType as string) || "application/octet-stream";
  const stream = file.createReadStream();
  return { stream, contentType };
}
