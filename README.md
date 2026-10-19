# LinkedIn Content Automation

A governed workflow for Stephen Caruana's LinkedIn thought-leadership posts.

1. **Curation Intake**: pick Industry, then Topic (filtered by Industry), Audience, Recency (1 to 6 months), Management style, Audited sources, optional Publisher and notes.
2. **Agent curates** 1 to 3 real, dated, HTTPS-linked articles (Claude API with web search). Replies are validated; bad ones are retried once, then the run fails and approvers are alerted.
3. **Gate 1 (My To-Do)**: approve article 1/2/3, send back with comments (re-curates), or reject.
4. **Agent drafts** a 150 to 250 word post in Stephen's voice with the Source line and both mandatory footers (validated).
5. **Gate 2 (My To-Do)**: edit, request edits, or approve & publish. Publishing requires ticking the GenAI disclaimer acknowledgment.
6. **Publish** to LinkedIn, then email confirmation. Every step is in the audit trail and the run history.

Approvals expire after 48 hours (hourly check). Double actions on the same gate are refused.

## Run locally
```
npm install
npm run dev        # mock agent + dry-run publishing, sign-in link shown on the page
npm test
```

## Go live (what only you can supply)
Copy `.env.example`, set the values as secrets in your host (never commit them), and deploy the `Dockerfile` (`render.yaml` for Render and a `fly.toml` example for Fly.io are included). Mount a persistent volume at `/data` for the SQLite database.

| Needed | Why |
|---|---|
| `SESSION_SECRET` | signs sign-in links and sessions (required in production) |
| `BASE_URL` | public HTTPS address, used in emailed links |
| `ANTHROPIC_API_KEY` | the curation and drafting agent |
| `SMTP_URL`, `MAIL_FROM` | sign-in links, gate emails, alerts |
| `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_AUTHOR_URN` | publishing; needs a LinkedIn developer app with the `w_member_social` permission |

`PUBLISH_MODE` stays `dry-run` (nothing is posted) until you set it to `live`. Do a full dry run with all three approvers first.

### Deploy on Render
1. Render dashboard: New > Blueprint, choose this repo. It reads `render.yaml`.
2. Enter the secrets Render asks for (`BASE_URL`, `ANTHROPIC_API_KEY`, `SMTP_URL`, `MAIL_FROM`, and the two LinkedIn values; leave LinkedIn blank for the dry run).
3. After the first deploy, set `BASE_URL` to the service's `https://…onrender.com` address and redeploy.
4. Sign in, run a full cycle with all three approvers, then set `PUBLISH_MODE=live`.

## Security notes
- Sign-in is by emailed link, limited to the `APPROVERS` list. Sessions are signed, HttpOnly cookies.
- Keep this repository private if it will hold deployment config. Secrets belong only in host environment variables.
- Restarts mark interrupted runs as Failed so they are visible; resubmit them.
- Single instance, SQLite on one volume. Move to Postgres before running multiple instances.

## Layout
`src/` server, workflow state machine, agent, validators, mail, LinkedIn client · `public/` the web app · `test/` tests · `src/agent-instructions.md` the agent prompt.
