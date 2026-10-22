# Shablam Squash

A Cambridge squash ladder for a group of friends. Parchment, bottle green, burgundy, traditional type, and a little friendly rivalry.

Challenge anyone in the club, agree a game, record the result, and climb an Elo ladder. This is an ongoing ladder rather than a knockout bracket.

## Try it first

**On this Windows computer:** double-click `preview.cmd`, then open **http://localhost:4173**. It uses Node if installed, or the existing VS Code runtime. Keep the terminal open while using the preview. Close it to stop the server.

**With Node 22 or newer:**

```sh
npm run dev
```

Open the printed local address. Opening `site/index.html` directly as a file will not run its JavaScript modules; use the preview server.

No installation is needed to run the website. The only npm dependency is for database tests.

The initial page is a clearly labelled **demonstration**. Its eight members and matches are fictional, and its data stays in that browser. Open the member button to switch identities or add yourself. You can run through a complete challenge and confirm the result as the opponent. Reset the demo from the same menu.

## What works

- Responsive player ladder, search, ratings, win/loss counts, and last-five-match form.
- Challenges between any two members, with acceptance, decline, and withdrawal.
- Results from accepted challenges or games arranged independently.
- Best-of-three and best-of-five scores with date validation.
- Opponent confirmation before any Elo change; disputed results leave ratings unchanged.
- A match ledger, pending-result notices, and CSV export.
- In shared mode: email sign-in, invitation-code membership, and database-enforced permissions.
- GitHub Actions checks and GitHub Pages deployment.

The website records challenges. Players arrange court bookings and times separately. It does not send opponent email notifications; check the noticeboard for challenges and pending results. The live board refreshes every 30 seconds while visible, when the tab regains focus, or when you press its refresh button.

## Publish on GitHub Pages

The website itself runs on GitHub Pages. Supabase provides shared storage and sign-in because GitHub Pages only serves static files. Without Supabase configuration, a published site remains a browser-local demo.

1. Create a GitHub repository called `shablam-squash`. A public repository supports GitHub Pages on GitHub Free. Choose repository visibility deliberately: source files in a public repository are public.
2. Upload this project's source files, including `.github/workflows/pages.yml`. Do **not** upload `.tools/`, `test-results/`, or any real invitation codes. Those directories are ignored by `.gitignore` when using Git.
3. Ensure the default branch is `main`, or change the workflow's branch names to yours.
4. Open the repository's **Settings → Pages → Build and deployment**, and select **GitHub Actions**.
5. Push to `main`, or open **Actions → Test and publish Shablam Squash → Run workflow**.
6. The workflow checks the application and database rules, then uploads only `site/`. Its deployment reports the real published URL. For a normal project repository it will have the form `https://YOUR-USERNAME.github.io/shablam-squash/`.

All website paths are relative, so GitHub Pages project subdirectories work without a separate build configuration. You can publish the demo first, then enable the shared club.

GitHub reference: [Custom workflows for GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Enable the shared club

Use a **new Supabase project**. The schema creates tables and functions and is intended to be installed once in an empty project; it is not an upgrade script for an existing application.

1. Create a project at [Supabase](https://supabase.com/). Review the plan and any limits before choosing it.
2. Open its **SQL Editor**, paste `supabase/schema.sql`, and run it.
3. In a fresh SQL editor query, copy `supabase/configure-club.sql`, replace the placeholder with a long random invitation code (at least 16 characters), and run it. Keep the real code out of GitHub and `site/config.js`. Share it privately with your friends.
4. Open the project's **Connect** dialog or **Settings → API Keys** and copy the project URL and **publishable** key. Put these two public values into `site/config.js`:

   ```js
   window.SHABLAM_CONFIG = Object.freeze({
     clubName: 'Shablam Squash',
     location: 'Cambridge, England',
     supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
     supabasePublishableKey: 'sb_publishable_YOUR-PUBLIC-KEY',
   });
   ```

5. Under **Authentication → URL Configuration**, set **Site URL** to the exact GitHub Pages URL, including the repository path and trailing slash. Add that same URL to allowed **Redirect URLs**. For development, add `http://localhost:4173/` separately.
6. Ensure the email provider and new user sign-ups are enabled. Keep the magic-link email template using its confirmation URL. Configure an email provider in Supabase for dependable group sign-ins; its built-in development mail service has restrictions. See [Supabase SMTP setup](https://supabase.com/docs/guides/auth/auth-smtp).
7. Commit the configuration to `main`. When the workflow finishes, visit the site, sign in by email, follow the emailed link, then enter your display name and the invitation code.
8. Send the published club link to your friends and share the invitation code separately. Each member signs in with their own email address. Everyone starts at 1,200; demo data is never uploaded to the live club.

Only members can read the live ladder, challenges, or matches. An authenticated person who has not joined cannot read club records. The browser cannot read the invitation code or directly write player ratings. Authentication emails stay in Supabase Auth and do not appear in player records or exports.

Use only a **publishable key** in the website; never use a `service_role`, `sb_secret_...`, database password, or GitHub token. Leave the `private` schema out of Supabase's exposed API schemas. The database tests check the access policies and privileged functions.

To rotate the invitation code, run the configuration query again with a new random value. Existing memberships stay in place. Confirmed records have no delete/edit control in the website; check scores before confirming. An organiser can make a deliberate correction in the database if required, accounting for all later rating changes.

Supabase references: [API keys](https://supabase.com/docs/guides/getting-started/api-keys), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), [Email magic links](https://supabase.com/docs/guides/auth/auth-email-passwordless).

## Rating rules

Every member starts at **1,200**. For player A against player B:

```text
Expected(A) = 1 / (1 + 10 ^ ((Rating(B) - Rating(A)) / 400))
Change(A)   = round(32 × (Actual(A) - Expected(A)))
Change(B)   = -Change(A)
```

`Actual(A)` is 1 for a win and 0 for a loss. An evenly matched winner gains 16 points. A 1,200 player beating a 1,400 player gains 24 points. The number of games won does not change the Elo calculation.

Ratings change **once, when the other player confirms**, using the players' ratings at that moment. Backdated matches do not rewrite later history. Confirming twice is rejected. Total rating points are conserved between the two players. Players with equal ratings are ordered by total wins, then by name.

Server writes run in database transactions and use a shared transaction lock for result and challenge state changes. This keeps confirmations atomic for a small club. No client-supplied rating is trusted.

## Tests

Install the development-only Postgres test engine and run the checks:

```sh
npm install --ignore-scripts
npm run check
```

The suite checks rating arithmetic, score/date validation, the full match flow, self-confirmation and duplicate protection, disputes, invitation membership, private data access, and direct-write prevention. Database tests run the actual schema in an isolated in-memory Postgres instance, with a minimal Supabase Auth stub. They do not contact or modify a live club.

On Windows with Edge installed, an optional browser smoke test checks the demo flow and desktop/mobile layout:

```sh
node scripts/browser-check.mjs
```

It starts and closes its own preview server and headless browser. Screenshots appear in `test-results/`. Use `EDGE_PATH` for an alternative Edge executable path. The live Supabase email and redirect flow still needs an end-to-end check after configuring your own project.

## Project files

```text
site/                         The only directory published to GitHub Pages
  index.html                  Page structure
  styles.css                  Cambridge club styling and responsive layouts
  app.mjs                     Rendering, dialogs, and user interactions
  core.mjs                    Elo, validation, rankings, and demo fixtures
  data.mjs                    Local demo and shared Supabase data adapters
  config.js                   Public connection settings
  assets/                     Original SVG crest, rackets, and skyline
supabase/schema.sql           Tables, permissions, and transactional operations
supabase/configure-club.sql   Invitation-code setup template
tests/                        Domain and database tests
scripts/                      Local preview and optional browser checks
.github/workflows/pages.yml   Checks and Pages publishing
preview.cmd                   Windows preview using Node or existing VS Code
```

The live client loads Supabase JS v2.118.0 from jsDelivr only when configured. Google Fonts supplies Cormorant Garamond and DM Sans; the page has local font fallbacks. Demo mode makes no database requests.

The supplied source is ready for GitHub. Publishing and real shared play require your GitHub repository and Supabase project; no hosted deployment or live database is included by default.
