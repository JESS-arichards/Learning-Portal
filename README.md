# Learning Portal

My timetable highlights the current school period with a #FF8200 outline and a
"Now" label, including breaks and periods without lessons. School time uses
Asia/Dubai regardless of the viewer's device timezone. The highlight updates
automatically, applies only to today, and ends when the period ends; other days
and gaps between periods are not highlighted.
Day tabs count teaching periods separately from slots whose configured period type
is named "Registration" (case-insensitive), for example "6 periods" plus
"1 registration". Registration remains schedulable; scheduled lesson totals are
unchanged.
Dated day tabs display a single bold heading such as "Wed - 28/10", with period
and registration counts underneath. On narrow screens the tab strip scrolls.
Date-navigation buttons and the date input share a 44px height and align along
their bottom edges, with the input label above.
The day timeline is keyboard-focusable and scrolls independently within 65% of
the viewport height. On opening a day or entering a new period it positions the
current period at the top, retaining all earlier/later periods for manual scrolling.
It does not snap back on routine clock updates. End spacing lets even the final
period align at the top without clipping its orange outline.
Scrolling within the periods region does not chain into scrolling the page at its
edges; the headings and controls move only when the page itself is scrolled.
The selected-day heading uses UK dates, for example "Wednesday 28/10/2026".

On screens up to 600px wide, the shared navigation title wraps rather than
truncating. The logo is capped at 80px wide and information/menu controls retain
their touch targets. Longer titles can increase the header height.
Period configuration stacks fields on narrow phones and places save/delete actions
on their own row, preventing native time inputs from overlapping action buttons.
On screens up to 900px wide, the new-period Days selector occupies a full row below
the time fields, and its dropdown stays within that row's width.
Mobile period-type cards share equal widths and heights, with aligned 44px edit/delete
buttons and wrapping names so longer labels do not change the card alignment.

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
- Students land on their dated timetable, including breaks, lesson descriptions,
  downloadable files, external resources and Microsoft Teams links.
- Parents select an attached child in the left-hand list to see that child's timetable
  on the right. Small screens stack the child selector above the timetable.
- Assigned teachers manage lessons and view their class rosters. A lesson can occupy
  one or more periods on a teaching date, once, daily or weekly within a term.
- **Learn Admin** and **Full Admin** can import classes, maintain weekly day structures,
  and manage all learning classes and lessons. Unassigned staff can sign in but cannot
  manage someone else's class.
- Central Full Admins continue to administer users, activation, roles and parent links
  in Applications Portal. Learning does not create another user database or role editor.

## Academic calendar and dated lessons

1. In **Administration > Academic calendar**, add an academic year, its terms and
   holiday/closure ranges. Start/end dates are inclusive; equal dates represent
   a single day. Academic years and terms cannot overlap; terms and holidays must
   fit inside their academic year. Teaching dates are Monday-Friday inside a term,
   excluding holidays. Inter-term dates and weekends remain visible as non-teaching
   dates. Dates are derived from ranges, not manually entered one by one.
2. Keep **Day structure** as the weekday period template. Daily recurrence matches
   the selected periods by start/end time and period type in each weekday template.
   Missing matching periods produce an error rather than silently dropping lessons.
3. Teachers choose an actual start date, one or more periods on that day, and
   **One-off**, **Daily** (1-366 calendar days) or **Weekly** (1-53 weeks).
   Skipped weekends/holidays count toward the requested duration, without extending
   the series. A maximum of 500 period occurrences is allowed per lesson.
4. Preview shows skipped dates, term end and the actual final teaching date. A
   series never crosses its starting term's end; teachers explicitly confirm
   truncation before saving. Students/parents can browse actual dates and weeks,
   and only see lessons scheduled for the selected date.

Schema version 2 adds calendar, occurrence and live-meeting tables without deleting
existing data. Legacy weekly lessons remain readable before a calendar is configured;
afterwards they must be converted to dated schedules to appear in the dated timetable.
For the requested **fresh development schedules**, temporarily set
`ALLOW_SCHEDULE_RESET=true` on the **development Learning web app only**, then use
the admin calendar's reset action and type `CLEAR DEVELOPMENT LESSONS`. It deletes
lessons/resources, but retains classes, rosters, period templates and the calendar.
Cancel live meetings first. Turn the setting off afterwards. Deployment never
automatically clears a database; do not enable this action on production.

Calendar edits that would change existing occurrences are rejected. Reschedule or
remove affected lessons first. Period templates used by any occurrence are locked.
Date-aware conflict checks protect shared classes, teachers and students.

## Teacher-owned Teams meetings

On the existing Entra app registration, add **delegated** `User.Read`,
`Calendars.ReadWrite` and `OnlineMeetings.ReadWrite`, grant tenant admin consent and configure a **Web** redirect:
`<Learning PUBLIC_BASE_URL>/api/teams/callback`. The flow also requests `openid`,
`profile` and `offline_access`; application calendar permissions are not used.
The development callback is:
`https://jess-learn-dev-ctdqcjhkb7c3f9cp.westus3-01.azurewebsites.net/api/teams/callback`.
For Vite development use `http://localhost:5174/api/teams/callback`.

Set these **Learning web app** settings. Reuse the existing Entra app registration
and credentials; no new registration or separate Teams client secret is needed.
App Service settings are per web app, so credentials present on Applications Portal
must also be configured on Learning (or use shared Key Vault references).
Leave `TEAMS_TOKEN_KEY` unset to disable Teams, even when Entra credentials exist.

| Setting | Value |
| --- | --- |
| `ENTRA_TENANT_ID` | Existing school Entra tenant UUID |
| `ENTRA_CLIENT_ID` | Existing application/client UUID |
| `ENTRA_CLIENT_SECRET` | Existing valid secret for that app registration; keep server-side |
| `TEAMS_TOKEN_KEY` | Base64-encoded random 32-byte encryption key; keep stable and secret |

Teachers need an Exchange Online mailbox, a Teams licence and a policy permitting
meeting scheduling. While setting up a dated lesson, an assigned Staff teacher chooses
**Teams**, enters a meeting name and chooses **Allow breakout rooms** as needed.
Choose **Connect / reconnect my Microsoft calendar**, then **Add Teams meetings on save**.
The dialog only stages the meeting settings; **Save lesson** creates the meetings
after saving the lesson details, links and files.
The connection opens in another tab to preserve the lesson editor. Existing connections
must reconnect to approve the additional `OnlineMeetings.ReadWrite` scope before
creating meetings with options. The account
must be a tenant Member whose Microsoft sign-in name (UPN) matches the central
teacher's email in the configured school tenant. Matching only the `mail` attribute
is not sufficient; UPN/email aliases that differ need identity mapping before use.
Tokens are encrypted in SQL, never returned to the browser. OAuth uses PKCE and an
expiring state cookie bound to the teacher session.

Each period occurrence creates its own Teams-enabled calendar event (not an Outlook
recurrence series), with the teacher as organiser and the class's server-side roster
as required attendees. Microsoft sends real invitations; test with test accounts.
Invitations support up to 500 unique students after removing duplicates and the
teacher's own address; larger rosters must be split before meeting creation.
Students get the meeting's named join link only on the matching occurrence date.
The teacher's class lesson also lists the named meeting links with their dates.
Portal lessons/resources remain usable when Teams is unconfigured.

The breakout-room option enables or disables rooms via Microsoft Graph; the organiser
creates rooms and assigns student groups in Teams itself. It cannot change a meeting
already in progress. Calendar creation and meeting-option application are separate:
the calendar event is durably saved before updating meeting options. If the options
cannot be confirmed, the dialog reports the partial creation and offers retry or
cancellation without sending another invitation. The portal only publishes the join
link after the options have been confirmed. Schema version 3 adds meeting titles,
options and their application status without changing existing meetings.

Meeting creation records durable pending state and uses the occurrence ID as Graph
`transactionId`. Ambiguous network failures remain visible; retry the same occurrence
to resolve them before cancellation. Completed meetings are not recreated on retry.
Creation is teacher-triggered; no background poller keeps serverless SQL awake.
Cancel live meetings before editing/deleting their lesson or changing its roster.
Only the original organiser can cancel. Calendar changes never silently reschedule
Microsoft invitations. School Teams policies still govern lobby, presenters,
recording and student participation; the app does not override those policies.

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
   is used by startup and copied into the production build. It creates relational
   tables for classes, rosters, lessons, resources and day structures, and migrates
   existing document-based data transactionally. Invalid legacy data fails explicitly
   and rolls back; there is no destructive rebuild. See the migration precautions below.
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
4. Configure sign-in and the Microsoft 365 mail sender on Applications Portal.
   Learning sign-in remains central and does not accept passwords/OTP codes.
   The optional Teams feature separately authorises a teacher's calendar, requiring
   a Learning **Web** callback URI as described below, not a SPA redirect URI.
   Portal URLs must be origins without paths or credentials.
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
`GET /api/live` checks only that this process can serve HTTP; it never queries SQL,
the central Portal or Blob Storage. `GET /api/health` retains the deep learning database,
central integration and private Blob container checks. By default startup refuses to
serve the app if schema or storage initialization fails.

## Azure Web App setup (SQL login + storage access key)

### Learning Web App settings

Use a Linux Node.js **24 LTS** App Service, HTTPS Only enabled, minimum TLS 1.2,
64-bit runtime and startup command **`npm start`**. Set Always On where the plan
supports it. Disable App Service Authentication ("Easy Auth") unless a deliberate
exception allows the app's public SSO start/callback endpoints: authentication is
handled by Applications Portal. For normal SQL, keep the health-check path as
`/api/health`; for auto-pausing development SQL, use `/api/live` as described below.
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
| `SQL_SERVERLESS_ENABLED` | Optional `true` or `false`; default `false`. Enable only on a webapp using auto-pausing Azure SQL serverless. |
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

### Optional development SQL serverless auto-pause

Set **`SQL_SERVERLESS_ENABLED=true` on the Learning development Web App** in
Settings > Environment variables > App settings. This is a per-webapp setting, not
a SQL server setting or browser variable. Leave it absent or `false` on production
and other provisioned-SQL webapps: their pool defaults and fail-fast startup remain
unchanged. Only the exact strings `true` and `false` are accepted. Provision the fresh
development database and configure its own SQL credentials; no data copy or special
serverless migration is needed. The normal startup schema script still runs.
The development GitHub Actions workflow automatically sets this flag and
`healthCheckPath=/api/live` on **`jess-learn-dev` only**, after Azure login and before
deployment. It discovers the resource group and fails if the app cannot be uniquely
found; its identity needs permission to update that webapp's configuration. You must
still supply the correct development SQL connection settings/credentials and other
required app settings yourself. The workflow never changes SQL credentials, database
names or other app settings. After deployment it performs bounded GET checks of
liveness and deep health; the deliberate deep check can wake SQL.

The four `SQL_SERVER` / `SQL_DATABASE` / `SQL_USER` / `SQL_PASSWORD` settings are used
unless `SQL_CONNECTION_STRING` is set, in which case that entire string takes
precedence (including encryption settings). Remove a stale connection string when
switching to discrete settings. SQL username/password authentication remains mandatory;
serverless mode does not enable Entra, managed identity or integrated authentication.
Do not point development at the production database.

In serverless mode, connection establishment retries only recognized transient SQL
connection errors (including Azure SQL 40613), with exponential backoff and an
approximately 90-second total wake budget per connection cycle. Login, permission and
query errors are not retried. Pool minimum is forced to **0** with **30-second idle
timeout**, including when settings come from a connection string. Failed connections
are discarded and disconnected cached pools can reconnect. No application write or
migration batch is automatically replayed. A failed/ambiguous save must be checked
before the user resubmits; clients must not automatically retry POST/PUT/DELETE.

The server listens immediately in this mode while initial connection readiness and
transient Blob Storage readiness failures are retried. Startup intentionally waits
persistently across transient outages (a 10-second delay between failed readiness
cycles); this is distinct from the bounded 90-second connection wake budget of each
pool cycle. No requests are replayed while waiting, and permanent failures still stop
startup. Until schema and private storage
initialization complete, dependent `/api` endpoints (including `/api/health` and auth)
return **503 with `Retry-After: 10`**. `/api/live` remains available without touching any
dependency. Permanent configuration errors or a failed migration remain fatal rather
than silently enabling an incomplete app. After startup in serverless mode, transient SQL failures and
central Portal outages return recoverable 503 responses with `Retry-After`, without
clearing valid Learning sessions. The central Portal request timeout remains 15 seconds;
timeouts do not trigger automatic SSO exchange/other POST retries.

Set the development Azure **Health Check path to `/api/live`**, and change any uptime
probes to use it. It reports process liveness, **not** database or application readiness.
Keep deep `/api/health` for deliberate diagnostic checks: regularly polling it, real
API traffic, database monitoring tools, other apps sharing the database, or open SQL
sessions can wake SQL or prevent auto-pause. Avoid synthetic deep checks on a schedule
if auto-pause is required. Always On can keep HTTP responsive without itself touching
SQL when the probe uses `/api/live`. Monitor initialization failures, 503s, wake latency
and Azure SQL sessions separately; do not treat a green liveness probe as proof that
the application is ready. Auto-pause is also subject to Azure SQL's configured delay
and eligibility restrictions.

### Database provisioning

- Use Azure SQL / SQL Server 2016+ with database compatibility level **130 or newer**
  (`OPENJSON` is required for migration and parameterized batch writes). Create the database before running the script.
- Run [database/schema.sql](database/schema.sql) in **Learning's database**.
  Learning uses these relational tables; user accounts, role assignments, parent
  links, branding and SSO requests remain in the central database:

  | Table | Data |
  | --- | --- |
  | `LearningClasses` | Class name, year group and division |
  | `LearningClassTeachers` | Assigned central user IDs, teacher emails and display names |
  | `LearningClassStudents` | Student emails and display names, including pending users |
  | `LearningPeriodTypes` | Admin-defined period types and lesson/break behaviour |
  | `LearningPeriods` | Day, name, start/end times and period type |
  | `LearningLessons` | Class, lesson name, description and update time |
  | `LearningLessonPeriods` | One or more timetable periods assigned to a lesson |
  | `LearningLessonLinks` | External and Teams resource links |
  | `LearningLessonFiles` | Blob file IDs, names and sizes, not file bytes |
  | `LearningSchemaMigrations` | Completed migration versions |

  Foreign keys protect class, lesson and period relationships. Roster/resource order
  is retained. Central user IDs/emails are external references, not cross-database
  foreign keys. JSON is used only as transient SQL batch input and to read the old
  migration archive, not for ongoing Learning record storage.
- The script can be rerun on an empty or existing compatible database. It does not
  create logins, change the target database, grant permissions or seed example users.
- If the app creates/upgrades the schema itself, its SQL login needs `CREATE TABLE`
  and `ALTER` on the `dbo` schema in addition to table read/write access. Prefer DBA
  provisioning: after running the script, grant the runtime SQL user
  `SELECT`, `INSERT`, `UPDATE` and `DELETE` on the Learning tables above, and `SELECT`
  on the legacy `dbo.LearningDocuments` table if present. For later schema upgrades, run the
  updated script as the DBA first. `sp_getapplock` uses the normal `public` principal.
- Restrict Azure SQL firewall rules to the Web App's outbound addresses or use VNet
  integration/private endpoints. Allow outbound TCP 1433 (and the configured Azure SQL
  connection-policy ports). Do not enable broad internet access just to bypass networking.
- Back up the Learning and central databases independently. Run the central Portal's
  own schema/migrations in **its** database for the SSO store; never run the Learning
  script there.

### Migrating an existing document-based Learning database

1. Back up the Learning database before changing the schema. Keep the matching old
   application release available. Test the script on a restored copy first.
2. Stop all old Learning instances and prevent automatic scale-out/slot traffic while
   migrating. Do not run old and new application versions together: the old version
   writes documents while the new version writes relational tables.
3. Run the new schema with an appropriately privileged SQL login, or let the new
   application execute it before accepting requests. Schema changes and data migration
   run in one transaction under the same application lock as Learning writes.
4. The migration copies classes, complete teacher/student rosters, periods, period
   types, lessons, assigned periods and resources. Existing record IDs and Blob references
   are retained. Legacy array-only structures receive the original Lesson/Break types.
   Unsupported or inconsistent data stops migration rather than being silently dropped.
5. `dbo.LearningDocuments`, when present, remains unchanged as an archive. A completed
   migration marker prevents stale documents being reimported after subsequent edits.
   New installations do not need that table. There is no runtime fallback to documents.
6. Verify timetable/class/resource access before restoring traffic. For rollback after
   relational writes, restore a coordinated database backup and old application release;
   simply deploying old code would expose stale archive data and lose new changes.

No Azure setting changes, new managed identities, resource reuploads or central-database
changes are required. Retain the archive until your backup/retention policy permits its
removal; the application does not delete it automatically.

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

Legacy student user IDs are ignored during migration: memberships use only each
student's email and display name. Classes and lessons are migrated automatically;
CSV re-import is not required. New imports persist email-based memberships in
`LearningClassStudents`.

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

Teachers use **My classes > Create lesson**, enter a name/description and choose a dated
schedule and periods. Before saving, use the three resource buttons:
**Files** opens a file-selection/download/remove dialog backed by private Azure Blob Storage;
**External Link** opens a named HTTPS link dialog with add/edit/remove actions;
**Teams** opens the meeting-name and breakout-room dialog described above.
Files, link edits and new Teams setup are staged until **Save lesson**, which stays
at the bottom. No file uploads or new invitations happen while configuring a dialog.
Closing the editor prompts before discarding pending changes. Unsaved selections
are held in browser memory, not persisted as draft lessons or blobs.
Saving validates the schedule and Teams connection first, saves the lesson and links,
then applies file changes, then creates the meeting series. These external operations
cannot be atomic: partial failures explicitly report what remains and keep pending
work for retry. Stable lesson/file IDs and occurrence transaction IDs prevent
duplicates when a successful response was lost. Completed uploads are removed from
the pending queue. Cancelling an existing Teams invitation remains an explicitly
confirmed, immediate action, rather than a staged addition.
Resource-only saves are allowed while live meetings exist; lesson details and
schedules remain protected against invitation drift. A resource-only save never
recreates cancelled occurrences. Shared files and external links appear on every occurrence;
Teams links are specific to their matching dated occurrence.

### Global UK display-date policy

All three portals use the shared `dateFormatting` helpers: short dates are
`DD/MM/YYYY` (for example `28/10/2026`), long dates are `D Month YYYY`
(`28 October 2026`), and date/time displays use the same UK date ordering.
The canonical policy is `Applications-Portal/shared/dateFormatting.ts`.
After changing that one policy, run `node scripts/sync-date-formatting.mjs`
from Applications-Portal to update the checked-in copies in Learning and Admissions.
Use `node scripts/sync-date-formatting.mjs --check` to verify consistency, then
commit and deploy the affected repositories together. This is a shared code policy,
not a per-user or runtime administrator setting.

Use the helpers for screens, human-readable exports and generated emails. Preserve
ISO dates in database/API values, date calculations, logs, import contracts and native
`type="date"` values. Native date-picker rendering follows browser/OS preferences
even with document language `en-GB`; textual display dates always use the policy.
Date-only values never shift with timezone, while timestamp displays preserve their
existing explicit timezone or device timezone.

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
| `GET /api/platform/v1/learning/navigation/:id` | Central, role-filtered Portal feature links, expandable Learning group and account destinations |
| `GET /api/platform/v1/learning/assets/:asset` | Central branding image bytes for same-origin proxying |
| `GET /api/platform/v1/learning/users/:id/avatar` | Active central user's avatar bytes; Learning exposes only the current authenticated user's avatar |
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
primary/background/text colors, logo, icon and background image. Learning does not
render a footer, organisation caption or bottom divider. Clearing a central asset
or text override clears it in Learning too.
Branding, navigation and avatar metadata reload on page load, learning-data refresh
and browser focus. Accent contrast is derived from the primary colour using the
same helper as Applications Portal.

Branding asset URLs are rewritten to `/api/branding/assets/:asset` on Learning,
and avatars use the protected `/api/me/avatar` endpoint. Only image bytes are
proxied from the central service; no platform key, central session cookie or Blob
credential reaches the browser. Versioned asset URLs refresh after central updates.
Missing avatars use the Portal's first/last-name initials; failed image loads are
reported rather than introducing a different local logo or branding configuration.

The header now uses the central application name/logo, avatar and account destinations.
The logo remains centrally branded; the text beside it follows the current page:
**Learning Portal - My Timetable**, **Learning Portal - My Classes**, or
**Learning Portal - Administration**. This updates on navigation without a reload
and does not change central branding settings.
Above 1,400px, the same collapsible **Applications Portal left sidebar** appears,
with **Learning Portal** expanded to show **My timetable**, **My classes** for staff/admins
and **Learning Portal admin** for **Full Admin / Learn Admin only**. Other application
admin roles do not grant Learning administration. Smaller screens use the shared
hamburger menu. Learn links are no longer displayed across the top bar.
Home, Streaming and eligible Portal features link back to the matching central
environment; Learning routes remain local. The central menu is authoritative,
including trip attachment, staff absence and task-role eligibility.

The info button uses the Applications Portal's identical **Build and support
information** dialog, including the selectable report, privacy warning, copy action
and explicit clipboard-failure guidance. The report identifies the Learning frontend
build actually loaded and labels authentication **Applications Portal SSO**, rather
than guessing the upstream Entra/OTP method. It excludes URL queries, fragments,
tokens and cookies. Account details are shown only on request, never sent automatically.
The three-dot menu uses the same account markup, typography and keyboard handling,
including **Parking Release (bay)** when eligible. Profile and eligible central Admin
links perform full-page navigation back to Applications Portal.

The Portal's checked-in `glass.css` is shared, not a separately tuned Learning palette.
It supplies the Fluent-informed translucent gradients, highlights, blur, shadows,
animated background and reduced-motion behaviour. Solid fallback surfaces are used
when backdrop filtering is unavailable. Deploy the central platform API first;
no new database tables or environment settings are needed for this shell update.

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

The same sync command also copies the canonical branding color-token helper, support
dialog/report/modal/styles, build-metadata helper and their shared tests.
Do not edit consumer navigation or color-token copies directly. Shared tests run with
this app's test suite. Profile and central user administration link back to Applications Portal.

## Manual class creation and editing

Full Admin and Learn Admin users can use **Learning Portal admin > Classes >
Create class**, or **Edit** beside a current class. Enter the class name, year group,
division, and one or more teachers and students with display names and email addresses.
Teachers are matched to active central Staff accounts; students are enrolled by
normalized email and may be added before their accounts exist. Existing inactive
or non-Student accounts cannot be enrolled as students.

Select **Validate class** to check the roster without writing anything, review errors
and pending-enrolment warnings, then **Save class**. Any edit invalidates the preview;
saving repeats directory validation and checks timetable clashes before committing.
Duplicate name/year group/division identities are rejected, not silently merged.
Editing replaces the roster while preserving the class ID, lessons, links and files.
Removed teachers/students lose access to that class unless another role or parent
link independently grants it. Changes that introduce shared teacher/student clashes
are rejected atomically. CSV import remains available and uses the same validation.
No new SQL schema or Azure configuration is required.

## Period types and multi-day periods

In **Learning Portal admin > Day structure**, Full Admin and Learn Admin users can
use **Add type** to open a dialog and enter a type name and **Lesson**
(schedulable) or **Break** (not schedulable) behaviour. **Save type** commits
immediately to the database and updates both period Type dropdowns. Types have
compact read-only summaries with edit/delete icons; editing uses the same dialog.
Types used by periods cannot be removed, and types used by timetable lessons
cannot be edited.

The new-period row contains name, type, start/end times, a **Days** multi-select
dropdown and a **save icon**. Choose one or more days (including weekends), or use
**All week (Monday-Friday)** inside the dropdown. Each selected day gets an
independent period with identical details. Saving commits the new period and all
pending existing-period edits/deletions across days in one transaction. Leave the
new-period name blank to save edits only. **Discard edits** restores saved periods;
it does not undo already committed type changes. There is no Save whole week button.

Periods referenced by any timetable lesson are locked against all edits and
deletion in both the UI and API, including name, times, day and type. Remove or
reschedule the lessons first. If any selected day overlaps, a used period was
changed, or the weekly 140-period limit is exceeded, nothing is committed.

The structure and types are saved atomically in `LearningPeriods` and
`LearningPeriodTypes`. Legacy structure documents are migrated by the schema script.
No new Azure settings are required. The structure API accepts `{ slots, periodTypes }`;
legacy slot-array requests retain the currently saved type list.
`PUT /api/admin/period-types` independently commits the type list against the
current persisted periods without committing any unsaved period edits.

## Validation

`npm test` covers weekly structure, scheduling clashes, link rules, CSV import
matching/replacement, student/parent/teacher data scoping, session invalidation,
lesson CRUD, protected downloads, resource upload, admin permissions and shared navigation.
Infrastructure tests cover SQL-login-only settings, private Blob-only storage, the
canonical startup schema, optimized upload filenames/byte counts, orientation and
metadata stripping, animation limits and measured image-size reduction.

On Windows with SQL Server LocalDB and `sqlcmd` installed, run the opt-in executable
migration/repository suite:

```powershell
$env:LEARNING_LOCALDB_TESTS = '1'
npm test -- server/relational.integration.test.ts
Remove-Item Env:\LEARNING_LOCALDB_TESTS
```

It creates a uniquely named disposable LocalDB instance and temporary database, then
cleans them up. It never uses application SQL settings or a live database. It covers
fresh installs, repeated migration, legacy array/object structures, custom types,
rosters/resources, long descriptions, invalid-data rollback, archive retention and
relational CRUD/foreign-key safeguards. Also rehearse migration on a restored copy
of the target database to validate your actual SQL version, data and permissions.
HTTP API tests use an in-memory repository and mocked platform/storage services; they
do not provision SQL, Entra, mail or Azure storage. Validate those integrations in the
configured deployment before making the application available to families.