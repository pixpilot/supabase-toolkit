# supabase-camel# supabase-camel

TypeScript utilities for Supabase with automatic camelCase/snake_case conversion. Keep your code camelCase while your database stays snake_case.## Usage Add usage instructions here.

## Installation

```bash
npm install supabase-camel
```

## Quick Start

```typescript
import type { Database } from './database.types';
import { createClient } from '@supabase/supabase-js';
import { createCamelCaseDb } from 'supabase-camel';

// Create your Supabase client
const supabase = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
);

// Wrap database operations
const db = createCamelCaseDb(supabase);

// Use camelCase everywhere!
const { data: jobs } = await db
  .from('jobs')
  .select('*')
  .eq('isActive', true)
  .order('createdAt', { ascending: false });
```

## Usage Examples

### Select Queries

```typescript
// Simple select
const { data } = await db.from('jobs').select('*');

// With filters
const { data: activeJobs } = await db
  .from('jobs')
  .select('*')
  .eq('isActive', true)
  .like('title', '%Developer%')
  .limit(10);
```

### Insert

```typescript
const newJob = {
  jobId: 'unique-id',
  title: 'Senior Developer',
  shortDescription: 'Great opportunity',
  isActive: true,
};

const { data } = await db.from('jobs').insert(newJob);
```

### Update

```typescript
await db.from('jobs').update({ isActive: false }).eq('jobId', 'some-id');
```

### Delete

```typescript
await db.from('jobs').delete().eq('jobId', 'some-id');
```

### Upsert

```typescript
const { data } = await db.from('jobs').upsert([
  { jobId: 'id-1', title: 'Job 1' },
  { jobId: 'id-2', title: 'Job 2' },
]);
```

## Type Safety

```typescript
import type { CamelCaseInsert, CamelCaseRow } from 'supabase-camel';

// Typed row data
type Job = CamelCaseRow<Database, 'jobs'>;

// Typed insert data
const newJob: CamelCaseInsert<Database, 'jobs'> = {
  jobId: 'id',
  title: 'Developer',
  // TypeScript autocomplete works!
};
```

## Using Auth, Storage, etc.

Only database operations are wrapped. Use your regular Supabase client for everything else:

```typescript
// Database queries with camelCase
const { data: jobs } = await db.from('jobs').select('*');

// Auth, storage, etc. - use original client
const {
  data: { user },
} = await supabase.auth.getUser();
const { data: files } = await supabase.storage.from('avatars').list();
```

## Available Methods

All standard Supabase query methods work with camelCase:

- **Filters**: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `is`, `in`, `contains`
- **Modifiers**: `order`, `limit`, `range`
- **Operations**: `select`, `insert`, `upsert`, `update`, `delete`

## Utility Functions

```typescript
import { keysToCamelCase, keysToSnakeCase } from 'supabase-camel';

// Manual conversion if needed
const camel = keysToCamelCase({ user_name: 'John', created_at: '2024-01-01' });
// { userName: 'John', createdAt: '2024-01-01' }

const snake = keysToSnakeCase({ userName: 'John', createdAt: '2024-01-01' });
// { user_name: 'John', created_at: '2024-01-01' }
```

## Features

- ✅ Automatic case conversion for all database operations
- ✅ Full TypeScript support with Supabase-generated types
- ✅ Method chaining with type-safe filters
- ✅ Zero dependencies (built-in conversion)
- ✅ Works with existing Supabase client configuration

## License

MIT

---

Made with ❤️ by [PixPilot](https://pixpilot.ai)
