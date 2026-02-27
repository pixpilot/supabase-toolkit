# supabase-toolkit

> A modern TypeScript monorepo managed with pnpm and TurboRepo.

## 🚀 Getting Started

### Development

Build all packages:

```sh
pnpm build
```

Run tests:

```sh
pnpm test
```

Lint and format:

```sh
pnpm lint
pnpm format
```

### Create a New Package

Generate a new package in the monorepo:

```sh
pnpm run turbo:gen:init
```

## 📦 Packages

### [supabase-camel](./packages/supabase-camel/README.md)

TypeScript utilities for Supabase with automatic camelCase/snake_case conversion.

### [supabase-edge-kit](./packages/supabase-edge-kit/README.md)

A lightweight, type-safe toolkit for building robust Supabase Edge Functions with built-in authentication, validation, error handling, and timeout protection

### [supabase-functions-client](./packages/supabase-functions-client/README.md)

A client library for Supabase Functions, providing a simple and efficient way to interact with serverless functions deployed on the Supabase platform.

### [supabase-user-storage](./packages/supabase-user-storage/README.md)

A user-scoped file storage manager for Supabase Storage. Automatically handles user authentication and scopes all operations to the authenticated user's folder.


## 🚢 Releases

This project uses [Changesets](https://github.com/changesets/changesets) for version management and publishing.

## 📄 License

[MIT](LICENSE)
