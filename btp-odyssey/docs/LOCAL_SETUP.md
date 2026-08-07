# Local setup

## Prerequisites

- Node.js 20+  
- npm 10+  

No SAP credentials. No commercial AI API keys.

## Install

```bash
cd btp-odyssey
npm install
```

## Validate content

```bash
npm run validate:content
```

## Test

```bash
npm test
```

## Run

Terminal 1:

```bash
npm run dev:api
```

Terminal 2:

```bash
npm run dev:web
```

Open http://localhost:5173

## Seed metadata (optional)

```bash
npm run seed
```

## Known local limits

See `KNOWN_LIMITATIONS.md`.
