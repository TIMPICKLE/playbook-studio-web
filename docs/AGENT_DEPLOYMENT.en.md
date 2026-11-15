# AI Agent deployment guide

[简体中文](AGENT_DEPLOYMENT.md) · **English** · [Back to README](../README.en.md)

Give this section to an AI coding agent that can inspect files and run commands. Select the target first:

| Target | Current support | Storage and capabilities |
|---|---|---|
| Local demo | Node.js static workspace | Browser-local storage, roster management, editing, rehearsal, import/export and sample AI demo; no accounts or cloud sharing |
| GitHub Pages / static hosting | Included build script and Pages workflow | Same static capabilities; each visitor's data stays in their browser |
| Cloud collaboration | Current implementation uses ChatGPT Sites + Worker + D1 | Accounts, shared playbooks and AI analysis require your own Site, database and platform access |

**Before distributing a copy:** the `project_id` in `.openai/hosting.json` belongs to the original project. Do not use it to create another person's Site or overwrite the original. Cloud links in `web/landing.html` and `web/cloud.js` point to the original deployment. Replace them with your own URL, or remove/clearly label them when publishing a static-only copy. The MIT license does not cover the original Madden / Huddle.gg images; verify their terms before public redistribution.

### Prompt for your agent

```text
Deploy Playbook Studio following docs/AGENT_DEPLOYMENT.en.md.

Target: [local demo / GitHub Pages static version / my own ChatGPT Sites cloud version]
Repository or hosting account: [provide the destination; omit for local use]
Audience: [local only / specified audience / public]

Read the README, package.json, docs/CLOUD.md and relevant deployment configuration first.
Inspect the current branch and uncommitted changes; preserve existing files and data.
Choose the appropriate path for my target. Do not reuse the original owner's Site ID, database, cloud URL or credentials.
If the target, platform access or audience is unclear, ask me. Use the platform's secure authentication flow; do not ask me to paste passwords or API keys into chat.
Configure, build and validate, then publish to the destination I authorized. Verify the actual entry point, core operations, data persistence and capability boundaries.
Report the URL, deployed version, verification results, data location and any unfinished work. State blockers honestly; do not claim unverified features work.
```

### Path A: local static demo

Requires Git and **Node.js 24** (minimum 22.13.0). Inspect the branch and working tree before using an existing checkout.

```bash
git clone https://github.com/TIMPICKLE/playbook-studio-web.git
cd playbook-studio-web
npm run start:local
```

Open `http://localhost:3000/`. The script restores bundled Madden images; stop the server with `Ctrl+C`. This is a development static server, not a public production service. Data is stored in the current browser: export a JSON backup before clearing it or changing devices.

Verify that the page and Madden images load, player movement and route drawing work, both languages are selectable, edits survive refresh, and JSON export works. `/api/*` is not supplied by this static server.

### Path B: GitHub Pages / static hosting

1. Fork or prepare a repository you can publish from and resolve the original cloud links as described above.
2. Ensure GitHub Actions can run in the repository. In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**. The included `.github/workflows/pages.yml` publishes the static build. If your default branch is not `main`, adjust its branch condition first.
3. Changes to `web/**`, `scripts/prepare-pages.mjs` or the workflow on `main` trigger the workflow. You can also run **Deploy GitHub Pages** manually; README-only changes do not trigger it. Check the run and the actual URL in Pages settings.
4. For another static host, generate and publish the entire `github-pages/` directory:

   ```bash
   node scripts/prepare-pages.mjs
   ```

   `index.html` opens the card workspace, `local.html` opens the editor directly, and `landing.html` retains the migration guide. Include the generated image assets. See [GitHub's publishing-source documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

Open all three cards from the deployed root without signing in. Add a player, refresh, search for that player, and return to the workspace. Verify the `local.html` editor shortcut, language switching, editing, refresh persistence, Madden images, JSON export and workflow status. Static storage does not sync across users or devices and does not provide cloud accounts or sharing; verify the AI demo entry, sample matchup overlay and missing-key message. Browser data and language preferences are separate across origins.

### Path C: your own cloud collaboration Site

The current cloud implementation needs **Vinext / Cloudflare Worker, D1 bound as `DB`, database migrations, and a platform-verified identity entry point**. For ChatGPT Sites, an authorized deployer must create **their own new Site and database**; use the Sites workflow available in that environment to configure the new project, build, apply migrations, publish and check status. Do not initialize, reset or migrate an existing Site or database without identifying the target.

To initialize team accounts, configure a one-time `PLAYBOOK_SETUP_KEY` as a secure runtime secret. `POST /api/auth/bootstrap` requires `X-Playbook-Setup-Key` and a JSON `accounts` list: the first account is an `owner`, subsequent accounts are `editor` or `viewer`; each account includes `username`, `password`, `role`, and an optional display `name`. Usernames contain 3–32 lowercase letters, digits or underscores and start with a letter; passwords are 8–128 characters. The request's `Origin` must exactly match the Site origin. Initialization succeeds only once and is not a password-reset mechanism. Remove the setup secret afterward. Use secure platform inputs; never put credentials in the repository, logs, command arguments or chat. See `server/auth.mjs` and [cloud operations](CLOUD.md) for the implementation.

Verify HTTPS login, `/api/health`, anonymous denial of playbook access, and authenticated creation/read, autosave, refresh recovery and language switching. Where needed, test membership permissions with two authorized accounts. AI analysis requires separate provider/model credentials and validation. Report the Site URL, source version, database and checks without disclosing credentials.

`npm run build && npm start` starts a local Worker / Wrangler environment; it is **not** an already configured public production deployment. A turnkey VPS cloud deployment is not currently provided. Other Worker / D1 platforms require their own deployment configuration, migrations and verified authentication; never trust externally supplied Sites identity headers. If platform access is missing, report the blocker rather than presenting the static version as a complete cloud deployment.
