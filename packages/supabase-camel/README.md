# supabase-camel

TypeScript utilities for Supabase with automatic camelCase/snake_case conversion. Keep your code camelCase while your database stays snake_case.

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
const { data: users } = await db
  .from('users')
  .select('*')
  .eq('isActive', true)
  .order('createdAt', { ascending: false });

// users is an array of user objects
```

## Usage Examples

### Select Queries

```typescript
// Simple select
const { data: users } = await db.from('users').select('*');

// With filters
const { data: activeUsers } = await db
  .from('users')
  .select('*')
  .eq('isActive', true)
  .like('name', '%John%')
  .limit(10);
```

### Insert

```typescript
const newUser = {
  userId: 'unique-id',
  name: 'John Doe',
  email: 'john@example.com',
  isActive: true,
};

const { data: insertedUsers } = await db.from('users').insert(newUser);
// insertedUsers is an array containing the inserted user(s)
```

### Update

```typescript
const { data: updatedUsers } = await db
  .from('users')
  .update({ isActive: false })
  .eq('userId', 'some-id');
// updatedUsers is an array of updated user(s)
```

### Delete

```typescript
const { data: deletedUsers } = await db.from('users').delete().eq('userId', 'some-id');
// deletedUsers is an array of deleted user(s)
```

### Upsert

```typescript
const { data: upsertedUsers } = await db.from('users').upsert([
  { userId: 'id-1', name: 'User 1' },
  { userId: 'id-2', name: 'User 2' },
]);
// upsertedUsers is an array of upserted user(s)
```

## Type Safety

```typescript
import type { CamelCaseInsert, CamelCaseRow } from 'supabase-camel';

// Typed row data
type User = CamelCaseRow<Database, 'users'>;

// Typed insert data
const newUser: CamelCaseInsert<Database, 'users'> = {
  userId: 'id',
  name: 'John Doe',
  // TypeScript autocomplete works!
};
```

## Using Auth, Storage, etc.

Only database operations are wrapped. Use your regular Supabase client for everything else:

```typescript
// Database queries with camelCase
const { data: users } = await db.from('users').select('*');
// users is an array of user objects

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
- ✅ **Optimized for edge functions** (5-15ms overhead per query)
- ✅ **Smart caching** for column name conversions
- ✅ **Memory efficient** (< 50KB overhead)

## Performance

This library is optimized for production use, including edge functions:

- **Minimal overhead:** 5-15ms per query (including long chains)
- **Smart caching:** Column name conversions are cached for ~50x faster repeated access
- **Memory efficient:** < 50KB total overhead
- **Edge function ready:** Tested and optimized for Supabase Edge Functions

### Benchmarks

| Query Type         | Expected Overhead |
| ------------------ | ----------------- |
| Simple select      | 2-3ms             |
| With filters (2-3) | 4-8ms             |
| Long chains (5+)   | 10-15ms           |

For detailed performance analysis, see [PERFORMANCE.md](./PERFORMANCE.md).

## License

MIT

---

Made with ❤️ by [PixPilot](https://pixpilot.ai)
