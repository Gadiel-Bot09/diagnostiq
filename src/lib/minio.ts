import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

export const s3Client = new S3Client({
    region: process.env.MINIO_REGION || "us-east-1",
    endpoint: process.env.MINIO_ENDPOINT,
    credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY!,
        secretAccessKey: process.env.MINIO_SECRET_KEY!,
    },
    forcePathStyle: true, // Required for MinIO
})

export const BUCKET_NAME = process.env.MINIO_BUCKET || "diagnostiq-results"

export async function uploadToMinio(filePath: string, fileBuffer: Buffer, contentType: string) {
    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: filePath,
        Body: fileBuffer,
        ContentType: contentType,
    })

    await s3Client.send(command)
    return filePath
}

export async function getPresignedDownloadUrl(filePath: string, expiresIn: number = 3600) {
    const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: filePath,
        ResponseContentDisposition: 'attachment', // Force download
    })

    return getSignedUrl(s3Client, command, { expiresIn })
}
