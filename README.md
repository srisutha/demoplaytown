# nextjs-playtown

Next.js replacement for the PHP backend of `app_playtown/`. The database schema,
DynamoDB tables, S3 bucket, JSON data files and every URL stay the same. The
existing HTML/JS frontends work unchanged.

## How it works

- `app/app_playtown/[[...path]]/route.ts` handles everything under `/app_playtown`.
  - Former PHP endpoints keep their URLs (`/app_playtown/common-ajax.php`,
    `/app_playtown/upload.php`, …) and are handled by the TypeScript ports in `handlers/`.
  - All other paths (HTML, JS, CSS, images, videos, `assets/json/*.json`) are
    served from the existing `app_playtown` folder (`PLAYTOWN_APP_DIR`), with
    directory index, trailing-slash redirects, Range requests and the old
    `.htaccess` rules. PHP sources, `vendor/` and dot-files are never served.
- `lib/php.ts` re-implements the PHP behaviour the code depends on (loose `==`,
  `json_encode` escaping, IST `date()`/`strtotime()`, `uniqid()`), so responses
  match the PHP originals.
- `lib/db.ts`: `query()` returns all columns as strings (like `mysqli::query`),
  `execute()` returns native numbers (like prepared statements / PDO).

| PHP file | Port |
|---|---|
| common-ajax.php (76 actions) | `handlers/common-ajax/*` |
| upload.php, dynamodb_upload.php, upload_dynamodb.php, uploadchain.php | `handlers/uploads.ts` |
| admin/common-ajax.php, admin/login.php, print pages, app_ui/*.php | `handlers/misc.ts`, `handlers/pages.ts` |
| candid_live, souvenir-wall-upload, human_chain_employee uploads, fetch_humanchainusers, get_wishes | `handlers/misc.ts` |
| functions.php, welcome_messages.php, db.php | `lib/functions.ts`, `lib/welcome-messages.ts`, `lib/config.ts` |
| mPDF certificate (email_template.php) | `lib/pdf.ts` (pdfkit + DancingScript-Bold) |

## Setup

```bash
npm install
cp .env.example .env.local   # fill in credentials (see below)
npm run dev                  # http://localhost:3000/app_playtown/
npm run build && npm start   # production
```

`.env.local` holds every credential that used to be hardcoded in the PHP files.

## Deploying

Run `npm run build && npm start` (Node 20+). Then send `/app_playtown/*` from
Apache/nginx to the Node process (e.g. `ProxyPass /app_playtown http://127.0.0.1:3000/app_playtown`).
`PLAYTOWN_APP_DIR` must point at the `app_playtown` folder, and the Node user
needs write access to it (uploads, `assets/json`, `pdf/`).

## Not ported (unused or unsafe)

- Backups and copies: `*-bkp.php`, `*copy*.php`, `commonajaxcopylatest.php`, `dbcopy.php`, `uploadcopy.php`, `upload_dynodbbkp.php`, `common-ajax-bkp.php`, `index-bkp.php`.
- Developer test scripts: `test.php`, `list_tables.php`, `s3.php`, `ai_caricature/{test,upload,process,lineart,download}.php`.
- `collabverse/info.php` (`phpinfo()`, which leaks server configuration).
- `tamilpreneur/` stays disabled: its `.htaccess` made Apache return 500.
