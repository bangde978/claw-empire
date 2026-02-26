# API Contract Baseline

This document defines a contributor-facing API baseline for Claw-Empire.
It is intentionally compact and focused on frequently used endpoints.

## Base

- Base URL (local): `http://127.0.0.1:8790`
- API prefix: `/api`
- Health endpoint: `/healthz`
- Swagger UI: `/api/docs`
- OpenAPI JSON: `/api/openapi.json`

## Authentication

- Loopback/local usage usually works without extra headers.
- Remote/non-loopback deployments can require:
  - `Authorization: Bearer <API_AUTH_TOKEN>`
- Inbox webhook endpoint requires:
  - `x-inbox-secret: <INBOX_WEBHOOK_SECRET>`
- Browser session bootstrap (`GET /api/auth/session`) returns `csrf_token`.
  - For cookie-authenticated mutation requests (`POST/PUT/PATCH/DELETE`), send:
    - `x-csrf-token: <csrf_token>`
- Interrupt injection endpoint (`POST /api/tasks/:id/inject`) additionally requires:
  - `session_id`
  - `interrupt_token` (or header `x-task-interrupt-token`)
  - Terminal API (`GET /api/tasks/:id/terminal`) exposes `interrupt.session_id` + `interrupt.control_token`
- Swagger note:
  - `/api/docs` opens with an automatic `/api/auth/session` bootstrap attempt (loopback/local case).
  - If you still get `401 unauthorized`, set `Bearer <API_AUTH_TOKEN>` via Swagger `Authorize`.

## Common Error Shape

Error payloads can vary by route, but API clients should handle:

```json
{
  "error": "error_code",
  "message": "human-readable detail"
}
```

The frontend client wraps non-2xx responses with `ApiRequestError` (`status`, `code`, `details`, `url`).

## Core Endpoint Groups

### Runtime / Org

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/departments` | List departments |
| POST | `/api/departments` | Create department |
| PATCH | `/api/departments/:id` | Update department |
| PATCH | `/api/departments/reorder` | Reorder departments |
| GET | `/api/agents` | List agents |
| POST | `/api/agents` | Create agent |
| PATCH | `/api/agents/:id` | Update agent |
| DELETE | `/api/agents/:id` | Delete agent |
| GET | `/api/stats` | Dashboard/company stats |
| GET | `/api/settings` | Read settings |
| PUT | `/api/settings` | Save settings |

### Tasks / Execution

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/tasks` | List tasks (supports filters) |
| GET | `/api/tasks/:id` | Task detail |
| POST | `/api/tasks` | Create task |
| PATCH | `/api/tasks/:id` | Update task |
| DELETE | `/api/tasks/:id` | Delete task |
| POST | `/api/tasks/:id/assign` | Assign agent |
| POST | `/api/tasks/:id/run` | Start task |
| POST | `/api/tasks/:id/stop` | Cancel or pause task |
| POST | `/api/tasks/:id/resume` | Resume paused task |
| POST | `/api/tasks/:id/inject` | Queue sanitized interrupt prompt (paused session) |
| GET | `/api/tasks/:id/terminal` | Task terminal logs |
| GET | `/api/tasks/:id/meeting-minutes` | Meeting minutes |
| GET | `/api/subtasks?active=1` | Active subtasks |
| POST | `/api/tasks/:id/subtasks` | Create subtask |
| PATCH | `/api/subtasks/:id` | Update subtask |

### Messaging / Inbox / Decision

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/messages` | Message history |
| POST | `/api/messages` | Send message |
| POST | `/api/announcements` | Broadcast announcement |
| POST | `/api/directives` | Send directive |
| DELETE | `/api/messages` | Clear messages |
| POST | `/api/inbox` | External webhook ingestion |
| GET | `/api/decision-inbox` | Decision inbox items |
| POST | `/api/decision-inbox/:id/reply` | Decision reply |

### Skills / Providers / OAuth

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/skills` | Skill catalog |
| GET | `/api/skills/detail` | Skill detail |
| POST | `/api/skills/learn` | Start learn job |
| GET | `/api/skills/learn/:jobId` | Learn job status |
| GET | `/api/skills/history` | Learn history |
| POST | `/api/skills/unlearn` | Unlearn skill |
| POST | `/api/skills/custom` | Upload custom skill |
| GET | `/api/skills/custom` | List custom skills |
| DELETE | `/api/skills/custom/:skillName` | Delete custom skill |
| GET | `/api/api-providers` | List API providers |
| POST | `/api/api-providers` | Create API provider |
| PUT | `/api/api-providers/:id` | Update API provider |
| DELETE | `/api/api-providers/:id` | Delete API provider |
| GET | `/api/oauth/status` | OAuth status |
| POST | `/api/oauth/disconnect` | OAuth disconnect |
| POST | `/api/oauth/refresh` | OAuth token refresh |

### Project / GitHub / Update

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Create project |
| PATCH | `/api/projects/:id` | Update project |
| DELETE | `/api/projects/:id` | Delete project |
| GET | `/api/projects/path-check` | Validate project path |
| GET | `/api/projects/path-suggestions` | Suggested paths |
| POST | `/api/projects/path-native-picker` | Native path picker |
| GET | `/api/github/status` | GitHub integration status |
| GET | `/api/github/repos` | Repositories |
| POST | `/api/github/clone` | Clone repository |
| GET | `/api/update-status` | Update status |
| POST | `/api/update-auto-config` | Toggle auto update |

## Known Follow-up

- Promote this baseline to OpenAPI (`/api/*.yaml`) in incremental slices:
  1. auth/session + settings
  2. tasks/subtasks
  3. inbox/directives
  4. project/github/update routes
