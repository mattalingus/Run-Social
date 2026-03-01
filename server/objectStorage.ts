import { Storage } from "@google-cloud/storage";

const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID!;
const storage = new Storage();
const bucket = storage.bucket(BUCKET_ID);

export async function uploadPhotoBuffer(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<string> {
  const objectPath = `public/photos/${filename}`;
  const file = bucket.file(objectPath);

  await file.save(buffer, {
    metadata: { contentType },
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
