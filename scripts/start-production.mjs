// Set production defaults before importing the server; no compiler is needed at runtime.
process.env.NODE_ENV = 'production'
await import('../server/dist/server/index.js')
