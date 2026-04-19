import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { Readable } from "stream";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID!;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;
const R2_BUCKET = process.env.R2_BUCKET!;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!;

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

async function stripExif(buffer: Buffer, contentType: string): Promise<{ buffer: Buffer; contentType: string }> {
  try {
    const image = sharp(buffer);
    const metadata = await image.metadata();
    const format = metadata.format;
    if (!format || ["gif", "svg"].includes(format)) {
      return { buffer, contentType };
    }

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

  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: objectPath,
      Body: cleanBuffer,
      ContentType: cleanContentType,
    }),
  );

  return `${R2_PUBLIC_URL}/${objectPath}`;
}

export async function streamObject(objectPath: string) {
  const result = await s3.send(
    new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: objectPath,
    }),
  );

  const contentType = result.ContentType || "application/octet-stream";
  const stream = result.Body as Readable;
  return { stream, contentType };
}
