# ts-sdk-error-page

A minimal React 19 + Aptos wallet repro app for checking transaction behavior on Aptos Testnet, especially differences between:

- `signAndSubmitTransaction` (payload path)
- `signTransaction` + `submitTransaction` (built transaction path)
- `withFeePayer = false | true`

## Requirements

- Node.js 20+
- pnpm 10+
- Petra wallet extension (set to Aptos Testnet)

## Local Run

```bash
pnpm install
pnpm run dev
```

Open the local URL shown by Vite (usually `http://localhost:5173`).

## Build

```bash
pnpm run build
```

## What This Page Provides

- Connect wallet button (Petra via wallet adapter)
- 7 test buttons:
  - Normal + SignAndSubmit
  - FeePayer + SignAndSubmit
  - Normal + SignThenSubmit
  - FeePayer + SignThenSubmit
  - FeePayer + SignThenSubmit (SDK v5)
  - Build(v6)+FeePayer to Sign(v5)
  - Build(v6)+FeePayer to Sign(v6)
- Debug panel for last request/build summary
- Result panel for status/hash/error details

## GitHub Pages

This repo is configured for GitHub Pages Actions deploy.

- Vite base: `/ts-sdk-error-page/`
- Workflow file: `.github/workflows/deploy-pages.yml`

After you enable Pages with **GitHub Actions** in repository settings, push to `main` to trigger deployment.
