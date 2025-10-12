import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
} from '../src/errors';
import UserStorageManager from '../src/user-storage-manager';

describe('storageManager', () => {
  let mockSupabaseClient: SupabaseClient;
  let storageManager: UserStorageManager;
  const mockUserId = 'test-user-id';
  const bucketName = 'test-bucket';

  beforeEach(() => {
    // Create mock Supabase client
    mockSupabaseClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: mockUserId } },
          error: null,
        }),
      },
      storage: {
        from: vi.fn().mockReturnThis(),
        upload: vi.fn(),
        list: vi.fn(),
        download: vi.fn(),
        getPublicUrl: vi.fn(),
        createSignedUrl: vi.fn(),
        createSignedUrls: vi.fn(),
        remove: vi.fn(),
        move: vi.fn(),
        copy: vi.fn(),
      },
    } as unknown as SupabaseClient;

    storageManager = new UserStorageManager(mockSupabaseClient, { bucketName });
  });

  describe('constructor', () => {
    it('should create an instance with correct bucket name', () => {
      expect(storageManager).toBeInstanceOf(UserStorageManager);
    });
  });

  describe('uploadFile', () => {
    it('should upload a file successfully', async () => {
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });
      const mockUploadResponse = {
        data: {
          path: `${mockUserId}/test.txt`,
          fullPath: `${bucketName}/${mockUserId}/test.txt`,
        },
        error: null,
      };

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        upload: vi.fn().mockResolvedValue(mockUploadResponse),
      } as any);

      const result = await storageManager.uploadFile(mockFile);

      expect(result).toEqual({
        path: `${mockUserId}/test.txt`,
        fullPath: `${bucketName}/${mockUserId}/test.txt`,
      });
    });

    it('should upload a file with custom file ID', async () => {
      const mockFile = new File(['content'], 'original.txt', { type: 'text/plain' });
      const customId = 'custom-name.txt';
      const mockUploadResponse = {
        data: {
          path: `${mockUserId}/${customId}`,
          fullPath: `${bucketName}/${mockUserId}/${customId}`,
        },
        error: null,
      };

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        upload: vi.fn().mockResolvedValue(mockUploadResponse),
      } as any);

      const result = await storageManager.uploadFile(mockFile, customId);

      expect(result.path).toBe(`${mockUserId}/${customId}`);
    });

    it('should upload a file with subPath', async () => {
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });
      const subPath = 'documents';
      const mockUploadResponse = {
        data: {
          path: `${mockUserId}/${subPath}/test.txt`,
          fullPath: `${bucketName}/${mockUserId}/${subPath}/test.txt`,
        },
        error: null,
      };

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        upload: vi.fn().mockResolvedValue(mockUploadResponse),
      } as any);

      const result = await storageManager.uploadFile(mockFile, null, subPath);

      expect(result.path).toBe(`${mockUserId}/${subPath}/test.txt`);
    });

    it('should throw UploadError on upload failure', async () => {
      const mockFile = new File(['content'], 'test.txt', { type: 'text/plain' });
      const mockError = new Error('Upload failed');

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        upload: vi.fn().mockResolvedValue({ data: null, error: mockError }),
      } as any);

      await expect(storageManager.uploadFile(mockFile)).rejects.toThrow(UploadError);
      await expect(storageManager.uploadFile(mockFile)).rejects.toThrow('Upload failed');
    });
  });

  describe('uploadMultipleFiles', () => {
    it('should upload multiple files successfully', async () => {
      const mockFiles = [
        new File(['content1'], 'test1.txt', { type: 'text/plain' }),
        new File(['content2'], 'test2.txt', { type: 'text/plain' }),
      ];

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        upload: vi
          .fn()
          .mockResolvedValueOnce({
            data: {
              path: `${mockUserId}/test1.txt`,
              fullPath: `${bucketName}/${mockUserId}/test1.txt`,
            },
            error: null,
          })
          .mockResolvedValueOnce({
            data: {
              path: `${mockUserId}/test2.txt`,
              fullPath: `${bucketName}/${mockUserId}/test2.txt`,
            },
            error: null,
          }),
      } as any);

      const results = await storageManager.uploadMultipleFiles(mockFiles);

      expect(results).toHaveLength(2);
      expect(results[0]?.fileName).toBe('test1.txt');
      expect(results[1]?.fileName).toBe('test2.txt');
    });
  });

  describe('listFiles', () => {
    it('should list files successfully', async () => {
      const mockFileData = [
        {
          name: 'test1.txt',
          id: 'file-id-1',
          metadata: { size: 100, mimetype: 'text/plain' },
          created_at: '2024-01-01',
          updated_at: '2024-01-02',
          last_accessed_at: '2024-01-03',
        },
        {
          name: 'test2.txt',
          id: 'file-id-2',
          metadata: { size: 200, mimetype: 'text/plain' },
          created_at: '2024-01-01',
          updated_at: '2024-01-02',
          last_accessed_at: '2024-01-03',
        },
      ];

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        list: vi.fn().mockResolvedValue({ data: mockFileData, error: null }),
      } as any);

      const files = await storageManager.listFiles();

      expect(files).toHaveLength(2);
      expect(files[0]?.name).toBe('test1.txt');
      expect(files[0]?.size).toBe(100);
      expect(files[1]?.name).toBe('test2.txt');
    });

    it('should list files with subPath', async () => {
      const subPath = 'documents';
      const mockFileData = [
        {
          name: 'doc.txt',
          id: 'file-id-1',
          metadata: { size: 100, mimetype: 'text/plain' },
          created_at: '2024-01-01',
          updated_at: '2024-01-02',
          last_accessed_at: '2024-01-03',
        },
      ];

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        list: vi.fn().mockResolvedValue({ data: mockFileData, error: null }),
      } as any);

      const files = await storageManager.listFiles(subPath);

      expect(files).toHaveLength(1);
      expect(files[0]?.fullPath).toContain(subPath);
    });

    it('should list files with custom options', async () => {
      const mockFileData: any[] = [];

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        list: vi.fn().mockResolvedValue({ data: mockFileData, error: null }),
      } as any);

      await storageManager.listFiles('', {
        limit: 50,
        offset: 10,
        sortBy: { column: 'created_at', order: 'desc' },
      });

      expect(mockSupabaseClient.storage.from).toHaveBeenCalled();
    });

    it('should throw ListError on list failure', async () => {
      const mockError = new Error('List failed');

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        list: vi.fn().mockResolvedValue({ data: null, error: mockError }),
      } as any);

      await expect(storageManager.listFiles()).rejects.toThrow(ListError);
    });
  });

  describe('downloadFile', () => {
    it('should download a file successfully', async () => {
      const mockBlob = new Blob(['file content'], { type: 'text/plain' });

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        download: vi.fn().mockResolvedValue({ data: mockBlob, error: null }),
      } as any);

      const blob = await storageManager.downloadFile('test.txt');

      expect(blob).toBe(mockBlob);
    });

    it('should throw DownloadError on download failure', async () => {
      const mockError = new Error('Download failed');

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        download: vi.fn().mockResolvedValue({ data: null, error: mockError }),
      } as any);

      await expect(storageManager.downloadFile('test.txt')).rejects.toThrow(
        DownloadError,
      );
    });
  });

  describe('getPublicUrl', () => {
    it('should get public URL successfully', async () => {
      const mockUrl = 'https://example.com/file.txt';

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: mockUrl } }),
      } as any);

      const url = await storageManager.getPublicUrl('test.txt');

      expect(url).toBe(mockUrl);
    });

    it('should throw UrlError on getPublicUrl failure', async () => {
      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        getPublicUrl: vi.fn().mockImplementation(() => {
          throw new Error('URL generation failed');
        }),
      } as any);

      await expect(storageManager.getPublicUrl('test.txt')).rejects.toThrow(UrlError);
    });
  });

  describe('createSignedUrl', () => {
    it('should create signed URL successfully', async () => {
      const mockSignedUrl = 'https://example.com/signed/file.txt';

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        createSignedUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: mockSignedUrl },
          error: null,
        }),
      } as any);

      const result = await storageManager.createSignedUrl('test.txt');

      expect(result.signedUrl).toBe(mockSignedUrl);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('should create signed URL with custom expiration', async () => {
      const mockSignedUrl = 'https://example.com/signed/file.txt';
      const customExpiry = 7200;

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        createSignedUrl: vi.fn().mockResolvedValue({
          data: { signedUrl: mockSignedUrl },
          error: null,
        }),
      } as any);

      const result = await storageManager.createSignedUrl('test.txt', customExpiry);

      expect(result.signedUrl).toBe(mockSignedUrl);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('should throw UrlError on createSignedUrl failure', async () => {
      const mockError = new Error('Signed URL creation failed');

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        createSignedUrl: vi.fn().mockResolvedValue({ data: null, error: mockError }),
      } as any);

      await expect(storageManager.createSignedUrl('test.txt')).rejects.toThrow(UrlError);
    });
  });

  describe('createSignedUrls', () => {
    it('should create multiple signed URLs successfully', async () => {
      const mockUrls = [
        { signedUrl: 'https://example.com/file1.txt', path: 'file1.txt', error: null },
        { signedUrl: 'https://example.com/file2.txt', path: 'file2.txt', error: null },
      ];

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        createSignedUrls: vi.fn().mockResolvedValue({ data: mockUrls, error: null }),
      } as any);

      const result = await storageManager.createSignedUrls(['file1.txt', 'file2.txt']);

      expect(result.urls).toHaveLength(2);
      expect(result.urls[0]?.signedUrl).toBe('https://example.com/file1.txt');
    });

    it('should throw UrlError on createSignedUrls failure', async () => {
      const mockError = new Error('Multiple signed URLs creation failed');

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        createSignedUrls: vi.fn().mockResolvedValue({ data: null, error: mockError }),
      } as any);

      await expect(storageManager.createSignedUrls(['file1.txt'])).rejects.toThrow(
        UrlError,
      );
    });
  });

  describe('deleteFile', () => {
    it('should delete a file successfully', async () => {
      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        remove: vi.fn().mockResolvedValue({ data: [{ name: 'test.txt' }], error: null }),
      } as any);

      await expect(storageManager.deleteFile('test.txt')).resolves.not.toThrow();
    });

    it('should throw DeleteError on delete failure', async () => {
      const mockError = new Error('Delete failed');

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        remove: vi.fn().mockResolvedValue({ data: null, error: mockError }),
      } as any);

      await expect(storageManager.deleteFile('test.txt')).rejects.toThrow(DeleteError);
    });
  });

  describe('deleteMultipleFiles', () => {
    it('should delete multiple files successfully', async () => {
      const deletedFiles = [{ name: 'file1.txt' }, { name: 'file2.txt' }];

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        remove: vi.fn().mockResolvedValue({ data: deletedFiles, error: null }),
      } as any);

      const result = await storageManager.deleteMultipleFiles(['file1.txt', 'file2.txt']);

      expect(result.deletedFiles).toEqual(deletedFiles);
    });

    it('should throw DeleteError on deleteMultipleFiles failure', async () => {
      const mockError = new Error('Delete multiple failed');

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        remove: vi.fn().mockResolvedValue({ data: null, error: mockError }),
      } as any);

      await expect(storageManager.deleteMultipleFiles(['file1.txt'])).rejects.toThrow(
        DeleteError,
      );
    });
  });

  describe('updateFile', () => {
    it('should update a file successfully', async () => {
      const mockFile = new File(['new content'], 'test.txt', { type: 'text/plain' });
      const mockUploadResponse = {
        data: {
          path: `${mockUserId}/test.txt`,
          fullPath: `${bucketName}/${mockUserId}/test.txt`,
        },
        error: null,
      };

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        upload: vi.fn().mockResolvedValue(mockUploadResponse),
      } as any);

      const result = await storageManager.updateFile('test.txt', mockFile);

      expect(result.path).toBe(`${mockUserId}/test.txt`);
    });

    it('should throw UploadError on update failure', async () => {
      const mockFile = new File(['new content'], 'test.txt', { type: 'text/plain' });
      const mockError = new Error('Update failed');

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        upload: vi.fn().mockResolvedValue({ data: null, error: mockError }),
      } as any);

      await expect(storageManager.updateFile('test.txt', mockFile)).rejects.toThrow(
        UploadError,
      );
      await expect(storageManager.updateFile('test.txt', mockFile)).rejects.toThrow(
        'Failed to update file',
      );
    });
  });

  describe('moveFile', () => {
    it('should move a file successfully', async () => {
      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        move: vi.fn().mockResolvedValue({ data: { message: 'Moved' }, error: null }),
      } as any);

      await expect(storageManager.moveFile('old.txt', 'new.txt')).resolves.not.toThrow();
    });

    it('should throw MoveError on move failure', async () => {
      const mockError = new Error('Move failed');

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        move: vi.fn().mockResolvedValue({ data: null, error: mockError }),
      } as any);

      await expect(storageManager.moveFile('old.txt', 'new.txt')).rejects.toThrow(
        MoveError,
      );
    });
  });

  describe('copyFile', () => {
    it('should copy a file successfully', async () => {
      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        copy: vi.fn().mockResolvedValue({ data: { message: 'Copied' }, error: null }),
      } as any);

      await expect(
        storageManager.copyFile('source.txt', 'destination.txt'),
      ).resolves.not.toThrow();
    });

    it('should throw CopyError on copy failure', async () => {
      const mockError = new Error('Copy failed');

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        copy: vi.fn().mockResolvedValue({ data: null, error: mockError }),
      } as any);

      await expect(
        storageManager.copyFile('source.txt', 'destination.txt'),
      ).rejects.toThrow(CopyError);
    });
  });

  describe('getFileMetadata', () => {
    it('should get file metadata successfully', async () => {
      const mockFileData = [
        {
          name: 'test.txt',
          id: 'file-id-1',
          metadata: { size: 100, mimetype: 'text/plain' },
          created_at: '2024-01-01',
          updated_at: '2024-01-02',
          last_accessed_at: '2024-01-03',
        },
      ];

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        list: vi.fn().mockResolvedValue({ data: mockFileData, error: null }),
      } as any);

      const metadata = await storageManager.getFileMetadata('test.txt');

      expect(metadata.name).toBe('test.txt');
      expect(metadata.size).toBe(100);
      expect(metadata.contentType).toBe('text/plain');
    });

    it('should throw FileNotFoundError when file does not exist', async () => {
      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        list: vi.fn().mockResolvedValue({ data: [], error: null }),
      } as any);

      await expect(storageManager.getFileMetadata('nonexistent.txt')).rejects.toThrow(
        FileNotFoundError,
      );
    });

    it('should throw InvalidPathError for invalid path', async () => {
      // Empty path will cause fileName to be undefined after split/pop
      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        list: vi.fn().mockResolvedValue({ data: [], error: null }),
      } as any);

      await expect(storageManager.getFileMetadata('')).rejects.toThrow(InvalidPathError);
    });

    it('should throw InvalidPathError for whitespace-only path', async () => {
      await expect(storageManager.getFileMetadata('   ')).rejects.toThrow(
        InvalidPathError,
      );
      await expect(storageManager.getFileMetadata('   ')).rejects.toThrow(
        'File path cannot be empty',
      );
    });

    it('should throw MetadataError on metadata retrieval failure', async () => {
      const mockError = new Error('Metadata failed');

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        list: vi.fn().mockResolvedValue({ data: null, error: mockError }),
      } as any);

      await expect(storageManager.getFileMetadata('test.txt')).rejects.toThrow(
        MetadataError,
      );
    });
  });

  describe('fileExists', () => {
    it('should return true when file exists', async () => {
      const mockFileData = [
        {
          name: 'test.txt',
          id: 'file-id-1',
          metadata: { size: 100, mimetype: 'text/plain' },
          created_at: '2024-01-01',
          updated_at: '2024-01-02',
          last_accessed_at: '2024-01-03',
        },
      ];

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        list: vi.fn().mockResolvedValue({ data: mockFileData, error: null }),
      } as any);

      const exists = await storageManager.fileExists('test.txt');

      expect(exists).toBe(true);
    });

    it('should return false when file does not exist', async () => {
      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        list: vi.fn().mockResolvedValue({ data: [], error: null }),
      } as any);

      const exists = await storageManager.fileExists('nonexistent.txt');

      expect(exists).toBe(false);
    });
  });

  describe('getTotalStorageUsed', () => {
    it('should calculate total storage used successfully', async () => {
      const mockFileData = [
        {
          name: 'file1.txt',
          id: 'id-1',
          metadata: { size: 100, mimetype: 'text/plain' },
          created_at: '2024-01-01',
          updated_at: '2024-01-02',
          last_accessed_at: '2024-01-03',
        },
        {
          name: 'file2.txt',
          id: 'id-2',
          metadata: { size: 200, mimetype: 'text/plain' },
          created_at: '2024-01-01',
          updated_at: '2024-01-02',
          last_accessed_at: '2024-01-03',
        },
      ];

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        list: vi.fn().mockResolvedValue({ data: mockFileData, error: null }),
      } as any);

      const result = await storageManager.getTotalStorageUsed();

      expect(result.totalBytes).toBe(300);
    });

    it('should handle files without size', async () => {
      const mockFileData = [
        {
          name: 'file1.txt',
          id: 'id-1',
          metadata: {},
          created_at: '2024-01-01',
          updated_at: '2024-01-02',
          last_accessed_at: '2024-01-03',
        },
        {
          name: 'file2.txt',
          id: 'id-2',
          metadata: null,
          created_at: '2024-01-01',
          updated_at: '2024-01-02',
          last_accessed_at: '2024-01-03',
        },
      ];

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        list: vi.fn().mockResolvedValue({ data: mockFileData, error: null }),
      } as any);

      const result = await storageManager.getTotalStorageUsed();

      expect(result.totalBytes).toBe(0);
    });

    it('should throw ListError on storage calculation failure', async () => {
      const mockError = new Error('List failed');

      vi.spyOn(mockSupabaseClient.storage, 'from').mockReturnValue({
        list: vi.fn().mockResolvedValue({ data: null, error: mockError }),
      } as any);

      await expect(storageManager.getTotalStorageUsed()).rejects.toThrow(ListError);
    });
  });

  describe('authentication errors', () => {
    it('should throw ListError containing AuthenticationError when user is not authenticated', async () => {
      const mockClient = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: new Error('Not authenticated'),
          }),
        },
        storage: {
          from: vi.fn().mockReturnThis(),
        },
      } as unknown as SupabaseClient;

      const manager = new UserStorageManager(mockClient, { bucketName });

      await expect(manager.listFiles()).rejects.toThrow(ListError);
      await expect(manager.listFiles()).rejects.toThrow('User not authenticated');
    });

    it('should throw UploadError containing AuthenticationError when auth returns error', async () => {
      const mockClient = {
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: new Error('Auth error'),
          }),
        },
        storage: {
          from: vi.fn().mockReturnThis(),
        },
      } as unknown as SupabaseClient;

      const manager = new UserStorageManager(mockClient, { bucketName });

      await expect(manager.uploadFile(new File(['content'], 'test.txt'))).rejects.toThrow(
        UploadError,
      );
      await expect(manager.uploadFile(new File(['content'], 'test.txt'))).rejects.toThrow(
        'User not authenticated',
      );
    });
  });
});
