import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "@/lib/config";
import type { Storage } from "./types";

export function createR2Storage(): Storage {
  const r2 = config.r2();
  const client = new S3Client({
    region: "auto",
    endpoint: r2.endpoint,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
    forcePathStyle: true,
  });

  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: r2.bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async presignedGetUrl(key, ttlSeconds = 3600) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: r2.bucket, Key: key }), { expiresIn: ttlSeconds });
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key }));
    },
  };
}
