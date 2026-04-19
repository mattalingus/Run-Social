/**
 * One-time migration: copies every object from Replit's GCS bucket to Cloudflare R2.
 * Must be run from INSIDE Replit (uses the Replit GCS sidecar to auth GCS reads).
 *
 * Usage (in Replit shell):
 *   npx tsx scripts/migrate-photos-to-r2.ts
 *
 * Required env vars (set in Replit Secrets before running):
 *   DEFAULT_OBJECT_STORAGE_BUCKET_ID  (already set in Replit)
 *   R2_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET
 */

import { Storage } from "@google-cloud/storage";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const GCS_BUCKET = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID!;

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID!;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;
const R2_BUCKET = process.env.R2_BUCKET!;

const gcs = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  } as any,
  projectId: "",
});

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

async function main() {
  const bucket = gcs.bucket(GCS_BUCKET);
  const [files] = await bucket.getFiles();

  console.log(`Found ${files.length} objects to migrate`);

  let done = 0;
  let failed = 0;
  const concurrency = 8;

  async function worker(file: (typeof files)[number]) {
    try {
      const [buffer] = await file.download();
      const [metadata] = await file.getMetadata();
      const contentType = (metadata.contentType as string) || "application/octet-stream";

      await r2.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: file.name,
          Body: buffer,
          ContentType: contentType,
        }),
      );

      done++;
      if (done % 25 === 0 || done === files.length) {
        console.log(`  Migrated ${done}/${files.length}`);
      }
    } catch (err: any) {
      failed++;
      console.error(`  FAILED ${file.name}: ${err.message}`);
    }
  }

  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    await Promise.all(batch.map(worker));
  }

  console.log(`\nDone. ${done} migrated, ${failed} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
