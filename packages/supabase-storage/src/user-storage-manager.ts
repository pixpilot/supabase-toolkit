import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DeleteResult,
  FileMetadata,
  ListOptions,
  MultipleSignedUrlsResult,
  MultipleUploadResult,
  SignedUrlResult,
  StorageUsageResult,
  UploadResult,
  UserStorageManagerOptions,
} from './types';
import {
  AuthenticationError,
  CopyError,
  DeleteError,
  DownloadError,
  FileNotFoundError,
  InvalidPathError,
  ListError,
  MetadataError,
  MoveError,
  UploadError,
  UrlError,
} from './errors';

// Constants
const DEFAULT_LIMIT = 100;
const DEFAULT_OFFSET = 0;
const DEFAULT_EXPIRES_IN = 3600;
const MILLISECONDS_PER_SECOND = 1000;

/**
 * Storage Helper Class for user-uploads bucket
 * All operations automatically scope to the authenticated user's folder
 */
class UserStorageManager {
  private readonly bucketName!: string;
  private supabaseClient: SupabaseClient;

  constructor(client: SupabaseClient, options: UserStorageManagerOptions) {
    this.bucketName = options.bucketName;
    this.supabaseClient = client;
  }

  /**
   * Get the current user's ID
   */
  private async getUserId(): Promise<string> {
    const {
      data: { user },
      error,
    } = await this.supabaseClient.auth.getUser();
    if (error || !user) {
      throw new AuthenticationError('User not authenticated', error);
    }
    return user.id;
  }

  /**
   * Get the user's folder path
   */
  private async getUserFolder(): Promise<string> {
    const userId = await this.getUserId();
    return userId;
  }

  /**
   * Upload a file to user's folder
   * @param file - The file object from input
   * @param fileId - Optional custom filename (defaults to file.name)
   * @param subPath - Optional subdirectory within user folder
   * @returns Upload result with path and fullPath
   * @throws {UploadError} If upload fails
   */
  async uploadFile(
    file: File,
    fileId: string | null = null,
    subPath: string = '',
  ): Promise<UploadResult> {
    try {
      const userFolder = await this.getUserFolder();
      const finalFileName = fileId ?? file.name;

      // Construct path: userId/subPath/filename
      const filePath = subPath
        ? `${userFolder}/${subPath}/${finalFileName}`
        : `${userFolder}/${finalFileName}`;

      const { data, error } = await this.supabaseClient.storage
        .from(this.bucketName)
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (error) throw error;

      return {
        path: data.path,
        fullPath: data.fullPath,
      };
    } catch (error) {
      throw new UploadError(
        `Upload failed: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  /**
   * Upload multiple files
   * @param files - Array of files
   * @param subPath - Optional subdirectory
   * @returns Array of upload results
   * @throws {UploadError} If any upload fails
   */
  async uploadMultipleFiles(
    files: File[],
    subPath: string = '',
  ): Promise<MultipleUploadResult[]> {
    const results: MultipleUploadResult[] = [];

    for (const file of files) {
      // eslint-disable-next-line no-await-in-loop
      const result = await this.uploadFile(file, null, subPath);
      results.push({
        fileName: file.name,
        ...result,
      });
    }

    return results;
  }

  /**
   * List all files in user's folder
   * @param subPath - Optional subdirectory to list
   * @param options - Listing options (limit, offset, sortBy)
   * @returns Array of file metadata
   * @throws {ListError} If listing fails
   */
  async listFiles(
    subPath: string = '',
    options: ListOptions = {},
  ): Promise<FileMetadata[]> {
    try {
      const userFolder = await this.getUserFolder();
      const searchPath = subPath ? `${userFolder}/${subPath}` : userFolder;

      const { data, error } = await this.supabaseClient.storage
        .from(this.bucketName)
        .list(searchPath, {
          limit: options.limit ?? DEFAULT_LIMIT,
          offset: options.offset ?? DEFAULT_OFFSET,
          sortBy: options.sortBy || { column: 'name', order: 'asc' },
        });

      if (error) throw error;

      const files: FileMetadata[] = data.map((file) => ({
        name: file.name,
        id: file.id,
        size: file.metadata?.['size'] as number | undefined,
        contentType: file.metadata?.['mimetype'] as string | undefined,
        createdAt: file.created_at,
        updatedAt: file.updated_at,
        lastAccessedAt: file.last_accessed_at,
        fullPath: `${searchPath}/${file.name}`,
      }));

      return files;
    } catch (error) {
      throw new ListError(
        `Failed to list files: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  /**
   * Download a file
   * @param filePath - Relative path from user's folder (e.g., 'file.pdf' or 'subfolder/file.pdf')
   * @returns File blob
   * @throws {DownloadError} If download fails
   */
  async downloadFile(filePath: string): Promise<Blob> {
    try {
      const userFolder = await this.getUserFolder();
      const fullPath = `${userFolder}/${filePath}`;

      const { data, error } = await this.supabaseClient.storage
        .from(this.bucketName)
        .download(fullPath);

      if (error) throw error;

      return data;
    } catch (error) {
      throw new DownloadError(
        `Failed to download file: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  /**
   * Get a public URL for a file (if bucket is public)
   * Note: This won't work with RLS setup unless bucket is public
   * @param filePath - Relative path from user's folder
   * @returns Public URL
   * @throws {UrlError} If URL generation fails
   */
  async getPublicUrl(filePath: string): Promise<string> {
    try {
      const userFolder = await this.getUserFolder();
      const fullPath = `${userFolder}/${filePath}`;

      const { data } = this.supabaseClient.storage
        .from(this.bucketName)
        .getPublicUrl(fullPath);

      return data.publicUrl;
    } catch (error) {
      throw new UrlError(
        `Failed to get public URL: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  /**
   * Create a signed URL for temporary access (recommended for private buckets)
   * @param filePath - Relative path from user's folder
   * @param expiresIn - Expiration time in seconds (default: 1 hour)
   * @returns Signed URL and expiration date
   * @throws {UrlError} If signed URL creation fails
   */
  async createSignedUrl(
    filePath: string,
    expiresIn: number = DEFAULT_EXPIRES_IN,
  ): Promise<SignedUrlResult> {
    try {
      const userFolder = await this.getUserFolder();
      const fullPath = `${userFolder}/${filePath}`;

      const { data, error } = await this.supabaseClient.storage
        .from(this.bucketName)
        .createSignedUrl(fullPath, expiresIn);

      if (error) throw error;

      return {
        signedUrl: data.signedUrl,
        expiresAt: new Date(Date.now() + expiresIn * MILLISECONDS_PER_SECOND),
      };
    } catch (error) {
      throw new UrlError(
        `Failed to create signed URL: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  /**
   * Create signed URLs for multiple files
   * @param filePaths - Array of file paths
   * @param expiresIn - Expiration time in seconds
   * @returns Array of signed URLs
   * @throws {UrlError} If signed URLs creation fails
   */
  async createSignedUrls(
    filePaths: string[],
    expiresIn: number = DEFAULT_EXPIRES_IN,
  ): Promise<MultipleSignedUrlsResult> {
    try {
      const userFolder = await this.getUserFolder();
      const fullPaths = filePaths.map((path) => `${userFolder}/${path}`);

      const { data, error } = await this.supabaseClient.storage
        .from(this.bucketName)
        .createSignedUrls(fullPaths, expiresIn);

      if (error) throw error;

      return {
        urls: data,
      };
    } catch (error) {
      throw new UrlError(
        `Failed to create signed URLs: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  /**
   * Delete a file
   * @param filePath - Relative path from user's folder
   * @throws {DeleteError} If deletion fails
   */
  async deleteFile(filePath: string): Promise<void> {
    try {
      const userFolder = await this.getUserFolder();
      const fullPath = `${userFolder}/${filePath}`;

      const { error } = await this.supabaseClient.storage
        .from(this.bucketName)
        .remove([fullPath]);

      if (error) throw error;
    } catch (error) {
      throw new DeleteError(
        `Failed to delete file: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  /**
   * Delete multiple files
   * @param filePaths - Array of file paths relative to user's folder
   * @returns Information about deleted files
   * @throws {DeleteError} If deletion fails
   */
  async deleteMultipleFiles(filePaths: string[]): Promise<DeleteResult> {
    try {
      const userFolder = await this.getUserFolder();
      const fullPaths = filePaths.map((path) => `${userFolder}/${path}`);

      const { data, error } = await this.supabaseClient.storage
        .from(this.bucketName)
        .remove(fullPaths);

      if (error) throw error;

      return {
        deletedFiles: data,
      };
    } catch (error) {
      throw new DeleteError(
        `Failed to delete files: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  /**
   * Update/Replace a file (delete old, upload new)
   * @param oldFilePath - Path to existing file
   * @param newFile - New file to upload
   * @returns Upload result
   * @throws {UploadError} If update fails
   */
  async updateFile(oldFilePath: string, newFile: File): Promise<UploadResult> {
    try {
      const userFolder = await this.getUserFolder();
      const fullPath = `${userFolder}/${oldFilePath}`;

      // Use upsert to replace the file
      const { data, error } = await this.supabaseClient.storage
        .from(this.bucketName)
        .upload(fullPath, newFile, {
          cacheControl: '3600',
          upsert: true,
        });

      if (error) throw error;

      return {
        path: data.path,
        fullPath: data.fullPath,
      };
    } catch (error) {
      throw new UploadError(
        `Failed to update file: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  /**
   * Move/Rename a file within user's folder
   * @param fromPath - Current file path
   * @param toPath - New file path
   * @throws {MoveError} If move fails
   */
  async moveFile(fromPath: string, toPath: string): Promise<void> {
    try {
      const userFolder = await this.getUserFolder();
      const fullFromPath = `${userFolder}/${fromPath}`;
      const fullToPath = `${userFolder}/${toPath}`;

      const { error } = await this.supabaseClient.storage
        .from(this.bucketName)
        .move(fullFromPath, fullToPath);

      if (error) throw error;
    } catch (error) {
      throw new MoveError(
        `Failed to move file: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  /**
   * Copy a file within user's folder
   * @param fromPath - Source file path
   * @param toPath - Destination file path
   * @throws {CopyError} If copy fails
   */
  async copyFile(fromPath: string, toPath: string): Promise<void> {
    try {
      const userFolder = await this.getUserFolder();
      const fullFromPath = `${userFolder}/${fromPath}`;
      const fullToPath = `${userFolder}/${toPath}`;

      const { error } = await this.supabaseClient.storage
        .from(this.bucketName)
        .copy(fullFromPath, fullToPath);

      if (error) throw error;
    } catch (error) {
      throw new CopyError(
        `Failed to copy file: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  /**
   * Get file metadata
   * @param filePath - File path relative to user's folder
   * @returns File metadata
   * @throws {MetadataError} If metadata retrieval fails
   * @throws {FileNotFoundError} If file doesn't exist
   * @throws {InvalidPathError} If file path is invalid
   */
  async getFileMetadata(filePath: string): Promise<Omit<FileMetadata, 'fullPath'>> {
    try {
      if (!filePath || filePath.trim() === '') {
        throw new InvalidPathError(filePath, 'File path cannot be empty');
      }

      const userFolder = await this.getUserFolder();
      const fullPath = `${userFolder}/${filePath}`;

      // List the specific file to get its metadata
      const pathParts = fullPath.split('/');
      const fileName = pathParts.pop();
      const folderPath = pathParts.join('/');

      if (fileName == null || fileName === '') {
        throw new InvalidPathError(filePath, 'Invalid file path');
      }

      const { data, error } = await this.supabaseClient.storage
        .from(this.bucketName)
        .list(folderPath, {
          search: fileName,
        });

      if (error) throw error;

      const file = data.find((f) => f.name === fileName);

      if (!file) {
        throw new FileNotFoundError(filePath, 'File not found');
      }

      return {
        name: file.name,
        id: file.id,
        size: file.metadata?.['size'] as number | undefined,
        contentType: file.metadata?.['mimetype'] as string | undefined,
        createdAt: file.created_at,
        updatedAt: file.updated_at,
        lastAccessedAt: file.last_accessed_at,
      };
    } catch (error) {
      if (error instanceof FileNotFoundError || error instanceof InvalidPathError) {
        throw error;
      }
      throw new MetadataError(
        `Failed to get file metadata: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  /**
   * Check if a file exists
   * @param filePath - File path relative to user's folder
   * @returns True if file exists, false otherwise
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      await this.getFileMetadata(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get total storage used by user
   * @returns Total bytes used
   * @throws {ListError} If storage calculation fails
   */
  async getTotalStorageUsed(): Promise<StorageUsageResult> {
    try {
      const files = await this.listFiles();
      const totalBytes = files.reduce((sum, file) => sum + (file.size ?? 0), 0);

      return {
        totalBytes,
      };
    } catch (error) {
      throw new ListError(
        `Failed to calculate storage usage: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }
}

export default UserStorageManager;
