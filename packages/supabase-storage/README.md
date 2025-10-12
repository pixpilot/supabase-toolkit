# supabase-storage

A user-scoped file storage manager for Supabase Storage. Automatically handles user authentication and scopes all operations to the authenticated user's folder.

## Features

- 🔐 **Auto-scoped to user**: All operations automatically work within the authenticated user's folder
- 🚀 **Simple API**: Clean, intuitive methods for common storage operations
- 💪 **Type-safe**: Full TypeScript support with comprehensive type definitions
- 🎯 **Error handling**: Custom error classes for precise error handling
- ✅ **Well-tested**: 98%+ test coverage

## Installation

```bash
pnpm add supabase-storage @supabase/supabase-js
```

## Usage

### Initialize the Storage Manager

```typescript
import { createClient } from '@supabase/supabase-js';
import { UserStorageManager } from 'supabase-storage';

const supabase = createClient('https://your-project.supabase.co', 'your-anon-key');

const storage = new UserStorageManager(supabase, {
  bucketName: 'user-uploads',
});
```

### Upload Files

```typescript
// Upload a single file
try {
  const file = document.querySelector('input[type="file"]').files[0];
  const result = await storage.uploadFile(file);
  console.log('Uploaded:', result.path, result.fullPath);
} catch (error) {
  if (error instanceof UploadError) {
    console.error('Upload failed:', error.message);
  }
}

// Upload with custom filename
await storage.uploadFile(file, 'custom-name.pdf');

// Upload to a subdirectory
await storage.uploadFile(file, null, 'documents');

// Upload multiple files
const files = Array.from(document.querySelector('input[type="file"]').files);
const results = await storage.uploadMultipleFiles(files, 'photos');
```

### List Files

```typescript
// List all files in user's folder
const files = await storage.listFiles();

// List files in a subdirectory
const documents = await storage.listFiles('documents');

// List with options
const recentFiles = await storage.listFiles('', {
  limit: 50,
  offset: 0,
  sortBy: { column: 'created_at', order: 'desc' },
});

// Access file metadata
files.forEach((file) => {
  console.log(file.name, file.size, file.contentType, file.createdAt);
});
```

### Download Files

```typescript
// Download a file
const blob = await storage.downloadFile('document.pdf');

// Create a download link
const url = URL.createObjectURL(blob);
const link = document.createElement('a');
link.href = url;
link.download = 'document.pdf';
link.click();
```

### Get File URLs

```typescript
// Get public URL (for public buckets)
const publicUrl = await storage.getPublicUrl('image.jpg');

// Create signed URL (for private buckets)
const { signedUrl, expiresAt } = await storage.createSignedUrl('document.pdf');
console.log('URL expires at:', expiresAt);

// Create signed URL with custom expiration (in seconds)
const TWO_HOURS = 7200;
const { signedUrl: url } = await storage.createSignedUrl('file.pdf', TWO_HOURS);

// Create multiple signed URLs
const ONE_HOUR = 3600;
const { urls } = await storage.createSignedUrls(
  ['file1.pdf', 'file2.pdf', 'file3.pdf'],
  ONE_HOUR,
);
```

### File Operations

```typescript
// Delete a file
await storage.deleteFile('old-file.pdf');

// Delete multiple files
const result = await storage.deleteMultipleFiles(['file1.pdf', 'file2.pdf', 'file3.pdf']);
console.log('Deleted:', result.deletedFiles);

// Update/replace a file
const newFile = document.querySelector('input[type="file"]').files[0];
await storage.updateFile('document.pdf', newFile);

// Move/rename a file
await storage.moveFile('old-name.pdf', 'new-name.pdf');
await storage.moveFile('file.pdf', 'archive/file.pdf');

// Copy a file
await storage.copyFile('original.pdf', 'copy.pdf');
```

### File Metadata

```typescript
// Get file metadata
const metadata = await storage.getFileMetadata('document.pdf');
console.log(metadata.name, metadata.size, metadata.contentType);

// Check if file exists
const exists = await storage.fileExists('document.pdf');
if (exists) {
  console.log('File exists!');
}

// Get total storage used by user
const { totalBytes } = await storage.getTotalStorageUsed();
console.log(`Using ${totalBytes} bytes`);
```

## Error Handling

The library provides custom error classes for precise error handling:

```typescript
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
  StorageError,
  UploadError,
  UrlError,
} from 'supabase-storage';

try {
  await storage.uploadFile(file);
} catch (error) {
  if (error instanceof AuthenticationError) {
    console.error('User not authenticated');
  } else if (error instanceof UploadError) {
    console.error('Upload failed:', error.message);
    console.error('Caused by:', error.cause);
  } else if (error instanceof StorageError) {
    console.error('Storage operation failed:', error.operation);
  }
}

// Example: Handle file not found
try {
  const metadata = await storage.getFileMetadata('nonexistent.pdf');
} catch (error) {
  if (error instanceof FileNotFoundError) {
    console.error('File not found:', error.filePath);
  }
}

// Example: Handle invalid paths
try {
  await storage.getFileMetadata('');
} catch (error) {
  if (error instanceof InvalidPathError) {
    console.error('Invalid file path:', error.path);
  }
}
```

## API Reference

### Constructor

- `new UserStorageManager(client, options)`
  - `client`: SupabaseClient instance
  - `options.bucketName`: Name of the storage bucket

### Methods

#### Upload Operations

- `uploadFile(file, fileId?, subPath?)`: Upload a single file
- `uploadMultipleFiles(files, subPath?)`: Upload multiple files
- `updateFile(oldFilePath, newFile)`: Update/replace an existing file

#### List Operations

- `listFiles(subPath?, options?)`: List files in user's folder
- `getTotalStorageUsed()`: Get total storage used by user

#### Download Operations

- `downloadFile(filePath)`: Download a file as Blob

#### URL Operations

- `getPublicUrl(filePath)`: Get public URL for a file
- `createSignedUrl(filePath, expiresIn?)`: Create a signed URL
- `createSignedUrls(filePaths, expiresIn?)`: Create multiple signed URLs

#### File Operations

- `deleteFile(filePath)`: Delete a single file
- `deleteMultipleFiles(filePaths)`: Delete multiple files
- `moveFile(fromPath, toPath)`: Move/rename a file
- `copyFile(fromPath, toPath)`: Copy a file

#### Metadata Operations

- `getFileMetadata(filePath)`: Get file metadata
- `fileExists(filePath)`: Check if a file exists

## Path Handling

All file paths are relative to the user's folder:

```typescript
// User folder structure: userId/
//   ├── file.pdf
//   └── documents/
//       └── report.pdf

await storage.uploadFile(file, 'file.pdf'); // → userId/file.pdf
await storage.uploadFile(file, null, 'documents'); // → userId/documents/filename
await storage.listFiles('documents'); // Lists userId/documents/*
await storage.downloadFile('documents/report.pdf'); // Downloads userId/documents/report.pdf
```

## TypeScript Support

The library is written in TypeScript and includes comprehensive type definitions:

```typescript
import type {
  DeleteResult,
  FileMetadata,
  ListOptions,
  MultipleSignedUrlsResult,
  MultipleUploadResult,
  SignedUrlResult,
  StorageManagerOptions,
  StorageUsageResult,
  UploadResult,
} from 'supabase-storage';
```

## License

MIT
