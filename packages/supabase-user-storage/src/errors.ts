/* eslint-disable max-classes-per-file */
/**
 * Custom error classes for Supabase Storage operations
 */

/**
 * Base error class for all storage-related errors
 */
export class StorageError extends Error {
  public readonly operation: string;
  public override readonly cause?: unknown;

  constructor(message: string, operation: string, cause?: unknown) {
    super(message);
    this.name = 'StorageError';
    this.operation = operation;
    this.cause = cause;
    Object.setPrototypeOf(this, StorageError.prototype);
  }
}

/**
 * Error thrown when user is not authenticated
 */
export class AuthenticationError extends StorageError {
  constructor(message: string = 'User not authenticated', cause?: unknown) {
    super(message, 'authentication', cause);
    this.name = 'AuthenticationError';
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

/**
 * Error thrown during file upload operations
 */
export class UploadError extends StorageError {
  constructor(message: string, cause?: unknown) {
    super(message, 'upload', cause);
    this.name = 'UploadError';
    Object.setPrototypeOf(this, UploadError.prototype);
  }
}

/**
 * Error thrown during file download operations
 */
export class DownloadError extends StorageError {
  constructor(message: string, cause?: unknown) {
    super(message, 'download', cause);
    this.name = 'DownloadError';
    Object.setPrototypeOf(this, DownloadError.prototype);
  }
}

/**
 * Error thrown during file deletion operations
 */
export class DeleteError extends StorageError {
  constructor(message: string, cause?: unknown) {
    super(message, 'delete', cause);
    this.name = 'DeleteError';
    Object.setPrototypeOf(this, DeleteError.prototype);
  }
}

/**
 * Error thrown during file listing operations
 */
export class ListError extends StorageError {
  constructor(message: string, cause?: unknown) {
    super(message, 'list', cause);
    this.name = 'ListError';
    Object.setPrototypeOf(this, ListError.prototype);
  }
}

/**
 * Error thrown during URL generation operations
 */
export class UrlError extends StorageError {
  constructor(message: string, cause?: unknown) {
    super(message, 'url', cause);
    this.name = 'UrlError';
    Object.setPrototypeOf(this, UrlError.prototype);
  }
}

/**
 * Error thrown during file metadata operations
 */
export class MetadataError extends StorageError {
  constructor(message: string, cause?: unknown) {
    super(message, 'metadata', cause);
    this.name = 'MetadataError';
    Object.setPrototypeOf(this, MetadataError.prototype);
  }
}

/**
 * Error thrown when a file is not found
 */
export class FileNotFoundError extends StorageError {
  public readonly filePath: string;

  constructor(filePath: string, message: string = 'File not found', cause?: unknown) {
    super(message, 'file-not-found', cause);
    this.name = 'FileNotFoundError';
    this.filePath = filePath;
    Object.setPrototypeOf(this, FileNotFoundError.prototype);
  }
}

/**
 * Error thrown during file move/rename operations
 */
export class MoveError extends StorageError {
  constructor(message: string, cause?: unknown) {
    super(message, 'move', cause);
    this.name = 'MoveError';
    Object.setPrototypeOf(this, MoveError.prototype);
  }
}

/**
 * Error thrown during file copy operations
 */
export class CopyError extends StorageError {
  constructor(message: string, cause?: unknown) {
    super(message, 'copy', cause);
    this.name = 'CopyError';
    Object.setPrototypeOf(this, CopyError.prototype);
  }
}

/**
 * Error thrown when file path is invalid
 */
export class InvalidPathError extends StorageError {
  public readonly path: string;

  constructor(path: string, message: string = 'Invalid file path', cause?: unknown) {
    super(message, 'invalid-path', cause);
    this.name = 'InvalidPathError';
    this.path = path;
    Object.setPrototypeOf(this, InvalidPathError.prototype);
  }
}
