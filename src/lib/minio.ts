import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

let _s3Client: S3Client | null = null;

export const getS3Client = () => {
    if (_s3Client) return _s3Client;

    const accessKeyId = process.env.MINIO_ACCESS_KEY;
    const secretAccessKey = process.env.MINIO_SECRET_KEY;
    const endpoint = process.env.MINIO_ENDPOINT;

    if (!accessKeyId || !secretAccessKey || !endpoint) {
        throw new Error(`Faltan variables de entorno de MinIO. Verifica que MINIO_ACCESS_KEY, MINIO_SECRET_KEY y MINIO_ENDPOINT estén configuradas en Vercel o en tu .env.local (actuales: accessKey=${!!accessKeyId}, secretKey=${!!secretAccessKey}, endpoint=${!!endpoint})`);
    }

    _s3Client = new S3Client({
        region: process.env.MINIO_REGION || "us-east-1",
        endpoint: endpoint,
        credentials: {
            accessKeyId: accessKeyId,
            secretAccessKey: secretAccessKey,
        },
        forcePathStyle: true, // Required for MinIO
    });

    return _s3Client;
}

export const BUCKET_NAME = process.env.MINIO_BUCKET || "diagnostiq-results"

export async function uploadToMinio(filePath: string, fileBuffer: Buffer, contentType: string) {
    const client = getS3Client()
    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: filePath,
        Body: fileBuffer,
        ContentType: contentType,
    })

    await client.send(command)
    return filePath
}

export async function getPresignedDownloadUrl(filePath: string, expiresIn: number = 3600) {
    const client = getS3Client()
    const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: filePath,
        ResponseContentDisposition: 'attachment', // Force download
    })

    return getSignedUrl(client, command, { expiresIn })
}
