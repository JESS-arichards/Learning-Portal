# Learning Portal

A separate remote-learning application built on the Applications Portal's central
user directory, roles, branding, Entra configuration and shared navigation.
React/Vite and an Express/TypeScript API deploy together as one Node.js 22+ service.
Learning data is stored in its **own SQL Server / Azure SQL database**; resources
use a **private Azure Blob Storage container**.

## What is included

- All users sign in **on Applications Portal**, not in Learning. Staff/students use
  the Portal's Microsoft Entra sign-in; parents use its email one-time-code sign-in.
  Learning redirects unauthenticated visitors there and restores the requested Learning
  page after successful sign-in. An existing Portal session skips the login form.
  Independent Learning cookies never share Portal session tokens.
- Students land on their weekly timetable, including breaks, lesson descriptions,
  downloadable files, external resources and Microsoft Teams links.
- Parents select an attached child in the left-hand list to see that child's timetable
  on the right. Small screens stack the child selector above the timetable.
- Assigned teachers manage lessons and view their class rosters. A lesson can occupy
  one or more weekly periods on the same or different days.
- **Learn Admin** and **Full Admin** can import classes, maintain weekly day structures,
  and manage all learning classes and lessons. Unassigned staff can sign in but cannot
  manage someone else's class.
- Central Full Admins continue to administer users, activation, roles and parent links
  in Applications Portal. Learning does not create another user database or role editor.

## Setup

1. Deploy the companion Applications Portal platform API changes first. Configure its
   `PLATFORM_LEARN_KEY` with a randomly generated secret of at least 32 characters.
   The Admissions key must be different. Set `LEARNING_PORTAL_URL` on Applications
   Portal to the Learning site's exact origin (for development `http://localhost:5174`).
   Set the Portal's own `PUBLIC_BASE_URL` as well. The central SSO callback is fixed to
   `LEARNING_PORTAL_URL` + `/api/auth/callback`; arbitrary callback URLs are not accepted.
   Central startup migrations create the persistent, short-lived SSO request/code store.
2. Create a separate learning database. Do **not** point this app at the Portal database.
   Run [database/schema.sql](database/schema.sql) in that database with a schema-owner
   SQL login, or allow the app to create/update the schema at startup. The same script
   is used by startup and copied into the production build. It creates
   `dbo.LearningDocuments`, repairs missing constraints on earlier versions, re-enables
   disabled/untrusted constraints and preserves rows. Incompatible columns, keys or
   invalid existing data fail explicitly and roll back; there is no destructive rebuild.
   Initialization and learning writes share an application lock across app instances.
3. Copy `.env.example` to `.env` and set:
   - `PUBLIC_BASE_URL`: this application's URL.
   - `APPLICATIONS_PORTAL_URL`: the matching central Portal URL, not a browser/Vite variable.
   - `PLATFORM_API_KEY`: the matching central `PLATFORM_LEARN_KEY`.
   - `SESSION_SECRET`: a separate random secret of at least 32 characters.
   - `SQL_SERVER` / `SQL_DATABASE` / `SQL_USER` / `SQL_PASSWORD`, all required for SQL
     authentication; alternatively use `SQL_CONNECTION_STRING` containing SQL login credentials.
     **No database managed identity or integrated authentication is used.**
   - `AZURE_STORAGE_CONNECTION_STRING`: the **HTTPS account-key connection string**
     copied from Storage account > Access keys. Set a private `AZURE_STORAGE_CONTAINER`
     (default `learning-files`). **No storage managed identity, account-URL authentication
     or local-disk fallback is used, including in development.**
4. Configure Entra and the Microsoft 365 mail sender **only on Applications Portal**.
   Learning does not use MSAL, accept ID tokens/passwords/OTP codes, or need an Entra
   redirect URI. Remove any Learning-specific SPA redirect URI left from the previous
   direct-sign-in setup if no other application needs it. Allowed domains and token
   validation remain central. Portal URLs must be origins without paths or credentials.
5. Install and start:

   ```powershell
   npm ci
   npm run dev
   ```

   The UI runs at `http://localhost:5174`, with the API at `http://localhost:8081`.
   Configure the central Portal separately, typically at `http://localhost:8080`.
   Use one hostname consistently; cookies and redirects distinguish localhost
   from 127.0.0.1. Azure Blob Storage credentials are required in every environment.

Production:

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm start
```

Set `NODE_ENV=production` and all configuration through the hosting platform.
The existing development Azure deployment workflow now uses `npm ci` and requires
typecheck, tests and build. No credentials or example student data are committed.
`GET /api/health` checks the learning database, central integration and private Blob
container. Startup also refuses to serve the app if schema or storage initialization fails.

## Azure Web App setup (SQL login + storage access key)

### Learning Web App settings

Use a Linux Node.js **24 LTS** App Service, HTTPS Only enabled, minimum TLS 1.2,
64-bit runtime and startup command **`npm start`**. Set Always On where the plan
supports it. Disable App Service Authentication ("Easy Auth") unless a deliberate
exception allows the app's public SSO start/callback endpoints: authentication is
handled by Applications Portal. Configure the health-check path as `/api/health`.
The application binds to Azure's `PORT`; do not override it with the local Vite port.

Set these in **Settings > Environment variables > App settings**, not in source control
or browser/Vite variables. Use separate values for dev and production and mark
environment-specific database/storage/URL/secret settings as deployment-slot settings
when using slots.

| App setting | Value / purpose |
| --- | --- |
| `NODE_ENV` | `production` |
| `PUBLIC_BASE_URL` | Exact Learning origin, e.g. `https://learn.example.org` |
| `APPLICATIONS_PORTAL_URL` | Matching central Portal origin, e.g. `https://portal.example.org` |
| `PLATFORM_API_KEY` | Same random 32+ character value as the central Portal's `PLATFORM_LEARN_KEY` |
| `SESSION_SECRET` | Independent, random 32+ character secret, stable across Learning instances |
| `SQL_SERVER` | Azure SQL hostname, e.g. `school-sql.database.windows.net` |
| `SQL_DATABASE` | Separate Learning database name |
| `SQL_USER` | SQL-authenticated database login/user; not an Entra identity |
| `SQL_PASSWORD` | That SQL user's password |
| `SQL_ENCRYPT` | `true` |
| `SQL_TRUST_SERVER_CERTIFICATE` | `false` |
| `AZURE_STORAGE_CONNECTION_STRING` | `DefaultEndpointsProtocol=https;AccountName=<account>;AccountKey=<key>;EndpointSuffix=core.windows.net` |
| `AZURE_STORAGE_CONTAINER` | Private dedicated container, e.g. `learning-files` |

`SQL_CONNECTION_STRING` is an alternative to the four discrete SQL credentials; when
present it takes precedence, including encryption options. Use, for example:

```text
Server=tcp:<server>.database.windows.net,1433;Database=<learning-database>;User ID=<sql-user>;Password=<password>;Encrypt=true;TrustServerCertificate=false;
```

Set it as an **App setting** named `SQL_CONNECTION_STRING`; do not rely on Azure's
separately prefixed Connection strings settings. Managed-identity/Entra connection
strings are rejected. Do not set `AZURE_STORAGE_ACCOUNT_URL`, managed-identity settings,
`LOCAL_STORAGE_PATH` or `STORAGE_ALLOW_LOCAL_DISK` for Learning: those paths are not supported.

### Database provisioning

- Use Azure SQL / SQL Server 2016+ with database compatibility level **130 or newer**
  (`ISJSON` is required). Create the database before running the script.
- Run [database/schema.sql](database/schema.sql) in **Learning's database**.
  The current learning schema has one JSON-backed table for classes, lessons and the
  weekly structure; user accounts, role assignments, parent links, branding and SSO
  requests remain in the central database. JSON is validated by SQL constraints and
  application schemas, not stored as blob files.
- The script can be rerun on an empty or existing compatible database. It does not
  create logins, change the target database, grant permissions or seed example users.
- If the app creates/upgrades the schema itself, its SQL login needs `CREATE TABLE`
  and `ALTER` on the `dbo` schema in addition to table read/write access. Prefer DBA
  provisioning: after running the script, grant the runtime SQL user
  `SELECT`, `INSERT`, `UPDATE` and `DELETE` on `dbo.LearningDocuments`. Existing correct
  schema startup performs validation without DDL. For later schema upgrades, run the
  updated script as the DBA first. `sp_getapplock` uses the normal `public` principal.
- Restrict Azure SQL firewall rules to the Web App's outbound addresses or use VNet
  integration/private endpoints. Allow outbound TCP 1433 (and the configured Azure SQL
  connection-policy ports). Do not enable broad internet access just to bypass networking.
- Back up the Learning and central databases independently. Run the central Portal's
  own schema/migrations in **its** database for the SSO store; never run the Learning
  script there.

### Blob Storage provisioning

- Create/select an Azure Storage account with Blob support, **Shared Key access enabled**,
  Secure transfer required and minimum TLS 1.2. Managed identities are not required.
- Create a dedicated container with anonymous access **Private (no anonymous access)**.
  Prefer disabling anonymous blob access at the account as well. The app can create
  the private container when missing, and refuses public containers.
- Copy an account-key connection string into `AZURE_STORAGE_CONNECTION_STRING`.
  The key grants account-level permissions: restrict access to app settings, use a
  dedicated account when appropriate, and rotate keys through the two Azure account
  keys without committing credentials.
- Permit the Web App's outbound access to the Blob endpoint over HTTPS 443; configure
  storage firewall/VNet/private DNS to match. No browser CORS rule or public SAS URL
  is needed; downloads pass through the authorized API.
- All persisted uploaded lesson files, including optimized images, live only in Blob
  Storage under random keys. SQL stores metadata/references, never file bytes.
  CSV class imports are parsed in memory and not retained as files. There is no disk
  fallback on storage failure. Existing local development files, if any, must be
  migrated or re-uploaded before relying on this Blob-only configuration.
- Enable appropriate backup/versioning/soft-delete, malware scanning and retention
  policies. Do not expire live lesson blobs with a blanket lifecycle rule: SQL
  references would become broken downloads.

### Central Applications Portal settings

Keep the Portal's existing Entra, mail and branding configuration. Add/check:

| Central Portal setting | Required value |
| --- | --- |
| `PUBLIC_BASE_URL` | Central Portal origin |
| `LEARNING_PORTAL_URL` | Learning origin matching its `PUBLIC_BASE_URL` exactly |
| `PLATFORM_LEARN_KEY` | Matching Learning `PLATFORM_API_KEY` |
| `SQL_AUTH` | `sql` when using discrete SQL settings |
| `SQL_SERVER`, `SQL_DATABASE`, `SQL_USER`, `SQL_PASSWORD` | Central database's SQL login settings (or its SQL-authenticated `SQL_CONNECTION_STRING`) |
| `AZURE_STORAGE_CONNECTION_STRING` | Central branding/profile storage account-key connection string |
| `AZURE_STORAGE_CONTAINER` | Central private container, separate from Learning's |

The central Portal still supports other authentication methods in code, but this
deployment must configure SQL credentials and a storage connection string; do not
configure its managed-identity SQL/storage options. Its branding images remain in
the central private storage container and are served via the Portal's asset API.

Deploy the central Portal first, then Learning. Build on Linux (the existing workflow
uses Ubuntu) so Sharp's native image-processing dependencies match the Linux App
Service; do not upload Windows `node_modules`. The build includes the schema script
at `dist/database/schema.sql`. Use the deployment workflow's service principal/OIDC
credentials as already configured; deployment identity is separate from runtime
database/storage authentication.

After restarting, verify `/api/health`, a full central sign-in/return, CSV import,
lesson creation, image upload/download and access as teacher/student/parent. Missing
credentials, blocked networking, public containers and invalid images must fail
explicitly rather than succeed with missing data.

## Class CSV contract

Download a blank template from **Admin > Class imports**. UTF-8 CSV headers must be
exactly these, in order:

```csv
Class Name,Teacher Display Name,Teacher Email,Student Display Name,Student Email,Year Group,Division
```

Use one row per class/teacher/student combination. To associate several teachers,
include a row for each teacher with at least one student; repeat student memberships
as needed. Duplicate combinations and inconsistent names within a class are errors.
Quoted commas and multiline fields are supported. Limits: 2 MB and 5,000 data rows.

Teacher email must match an active central **Staff** user; the teacher's central ID
is persisted locally. Students are enrolled by trimmed, case-insensitive email and
uploaded display name, **without requiring a central user ID or an existing account**.
Students missing from the active central directory generate nonblocking preview
warnings, even if every student in the class is new. Returned inactive/non-Student
accounts are errors, as are missing/inactive/non-Staff teachers. **No student users
or roles are created by an upload.** Student access requires an active central
**Student** account with the enrolled email; it works on first sign-in without
re-importing. Email changes require updating enrolments and central parent links.

Parent uploads remain exclusively in **Applications Portal**, using its existing CSV:

```csv
Display Name,Email,Forename,Surname,Student Email
```

Repeat a parent on separate rows for multiple children. Central parent imports merge
child email links; they do not remove links absent from the file. Links can be stored
before the student exists. Learning reads these central links and lets parents view
their children's published timetables as soon as class data exists, before the
children first sign in. There is no separate parent import in Learning.

Click **Validate & preview**, correct all errors, then confirm **Import**. The server
revalidates directory matches on import, using deduplicated batches of up to 200 emails.
Any invalid row rejects the entire import. There is no partial success.
Pending-student warnings do not prevent import. These all-or-nothing rules apply to
Learning class uploads; the existing central parent upload has its own preview and
created/updated/skipped results.

Existing class JSON containing student user IDs remains readable; the class schema
now uses only each student's email and display name and ignores legacy IDs.
Existing classes and lessons need no SQL table migration or re-import. The
`database/schema.sql` table structure is unchanged because memberships are stored
inside class JSON. New imports persist only email-based student memberships.

Class identity is the case-insensitive combination of Class Name, Year Group and
Division. Importing an existing class **replaces its complete teacher/student roster**
while preserving its ID and lessons. Classes omitted from the CSV are unchanged.
Renaming a class/year/division creates a different class. Existing lesson clashes caused
by membership changes reject the import. Remove a class's lessons before deleting it.

## Timetables and resources

Administrators set periods for each Monday–Sunday independently under **Admin > Day
structure**. Times use 24-hour **school local time**, without browser timezone conversion.
Periods cannot overlap on a day. There is one shared weekly day structure; different
year groups/divisions can leave unneeded periods unscheduled. This version has no
date-specific exceptions, term calendars, rotating weeks or separate division bells.

Teachers use **My classes > Create lesson**, enter a name/description, select one or
more lesson periods and add named HTTPS or Teams links. Save first to attach files.
Changes are immediately visible; there is no draft/publish stage. The same lesson and
resources repeat in every selected weekly period until edited or deleted.

The server rejects scheduling a class, shared teacher or shared student into two lessons
in the same period. Breaks cannot host lessons. Used period IDs cannot be removed or
converted to breaks; changing their times moves the associated lessons.

Resources support PDF, Office, text/CSV, common images, MP3 and MP4, up to 25 MB per
file / 20 files per lesson, and 30 HTTPS links. Teams links must use known Microsoft
Teams domains. External resources open in a separate tab. Files are stored under random
keys, never public URLs, and downloaded as attachments only after live authorization.
PNG, JPEG, GIF and WebP lesson uploads use the **same Sharp reduction policy as the
Applications Portal**: validate/decode the image, auto-orient still images, strip
metadata, resize within 2048 x 2048 without upscaling, and encode WebP at quality 80.
Like the Portal, already compact metadata-free artwork is retained when conversion
would increase its size (even if it exceeds 2048 pixels); otherwise the saved filename
changes to `.webp` and the saved size is the optimized byte count. Transparency and
animation timing are preserved. Limits are 40 million decoded pixels, 100 animation
frames, and two concurrent image-processing jobs per process; corrupt/mislabeled
images are rejected before storage. Document/media resources are not recompressed.
This only processes new uploads; existing blobs are unchanged. Core branding images
continue to be processed by the central Portal, not copied/re-encoded in Learning.
File type extensions are restricted, but this app does **not** provide malware scanning;
configure organizational scanning/retention policies on storage before production use.
If post-commit Blob deletion fails, the API reports an error and logs it; the unreferenced
blob remains inaccessible through the API and may need operational cleanup.

## Central integration and access

Server-to-server requests use `x-platform-key` over HTTPS in production. Secrets never
enter browser config. Sign-in uses a random browser-bound state and S256 PKCE verifier,
a five-minute signed HttpOnly transaction cookie, and a short-lived, single-use opaque
code redeemed server-to-server. Portal session tokens and Entra tokens are never put
in Learning URLs. The callback strips the code/state through a redirect to the saved
safe local path; responses use `no-store` and `no-referrer`.

The consumer uses:

| Central platform endpoint | Purpose |
| --- | --- |
| `GET /api/platform/v1/learning/config` | Central branding and central profile URL; no Learning identity-provider configuration |
| `POST /api/platform/v1/learning/sso/start` | Register state/PKCE challenge and get the Portal authorization URL |
| `POST /api/platform/v1/learning/sso/redeem` | Redeem the one-use code with its PKCE verifier for a central profile |
| `GET /api/platform/v1/users/:id` | Live account status, session version, roles and parent links |
| `POST /api/platform/v1/users/lookup` | Match CSV emails to active central users in batches |

Every protected request checks the central account live. Disabled/deleted accounts,
session-version changes and parent-link removal take effect on the next request.
Central outages fail closed: there is no local user or cached authorization fallback.
Student/parent responses exclude other students' roster entries. A teacher sees complete
rosters only for assigned classes. All learning API responses are `no-store`.

Expired or missing Learning sessions redirect back through the Portal. Signing out of
Learning clears its session and takes the user to the central Portal home; it does not
silently sign out of other applications. Use the Portal's sign-out to end that session.
Legacy Learning `/api/auth/entra` and `/api/auth/otp/*` endpoints return 410.

## Branding is central-only

Learning has **no branding editor, branding database or per-app theme configuration**.
It reads **Applications Portal > Admin > Branding** at runtime for the organisation,
primary/background/accent/text colors, logo, icon, background image, footer logo and
website link. Clearing a central asset or text override clears it in Learning too.
Branding reloads on page load, learning-data refresh and browser focus.

The previous Learning-specific green palette, login screen and promotional footer
have been removed. Components derive their colors from central tokens; brand buttons
use the Portal's shared contrast helper. Layout and status colors remain application UI,
not independent branding. As in the Portal, check custom text/background combinations
for readability.

The shared navigation files are checked-in copies of the Portal's canonical component:

```powershell
# Run from Applications-Portal:
node scripts\sync-navigation.mjs ..\Learning-Portal
node scripts\sync-navigation.mjs --check ..\Learning-Portal
```

The same sync command also copies the canonical branding color-token helper and tests.
Do not edit consumer navigation or color-token copies directly. Shared tests run with
this app's test suite. Profile and central user administration link back to Applications Portal.

## Validation

`npm test` covers weekly structure, scheduling clashes, link rules, CSV import
matching/replacement, student/parent/teacher data scoping, session invalidation,
lesson CRUD, protected downloads, resource upload, admin permissions and shared navigation.
Infrastructure tests cover SQL-login-only settings, private Blob-only storage, the
canonical startup schema, optimized upload filenames/byte counts, orientation and
metadata stripping, animation limits and measured image-size reduction. The schema
is also suitable for offline T-SQL syntax validation; executing it twice against a
test database is still required to validate your actual SQL version and permissions.
HTTP API tests use an in-memory repository and mocked platform/storage services; they
do not provision SQL, Entra, mail or Azure storage. Validate those integrations in the
configured deployment before making the application available to families.