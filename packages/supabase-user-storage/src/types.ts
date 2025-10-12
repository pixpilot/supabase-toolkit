/**
 * Type Definitions for Supabase Storage Manager
 */

export interface FileMetadata {
  name: string;
  id: string;
  size?: number | undefined;
  contentType?: string | undefined;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
  fullPath: string;
}

export interface UploadResult {
  path: string;
  fullPath: string;
}

export interface MultipleUploadResult extends UploadResult {
  fileName: string;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  sortBy?: {
    column: string;
    order: 'asc' | 'desc';
  };
}

export interface SignedUrlData {
  signedUrl: string;
  path: string | null;
  error?: string | null;
}

export interface SignedUrlResult {
  signedUrl: string;
  expiresAt: Date;
}

export interface MultipleSignedUrlsResult {
  urls: SignedUrlData[];
}

export interface DeleteResult {
  deletedFiles: any[];
}

export interface UserStorageManagerOptions {
  bucketName: string;
}

export interface StorageUsageResult {
  totalBytes: number;
}
