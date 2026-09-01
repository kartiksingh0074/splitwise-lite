# API

All routes are prefixed `/api/v1`. Auth via `Authorization: Bearer <accessToken>`.

## Error shape

Every error response has this shape:

```json
{ "error": { "code": "SPLIT_MISMATCH", "message": "...", "details": {} } }
```

## Endpoints

### `GET /health`

Liveness check, no auth required.

**Response `200`**
```json
{ "status": "ok" }
```

### `POST /auth/register`

Rate limited (10/min/IP).

**Body** `{ email, name, password }`

**Response `201`** `{ user, accessToken, refreshToken }`

Errors: `409 EMAIL_TAKEN`, `422 VALIDATION_ERROR`.

### `POST /auth/login`

Rate limited (10/min/IP).

**Body** `{ email, password }`

**Response `200`** `{ user, accessToken, refreshToken }`

Errors: `401 INVALID_CREDENTIALS`, `422 VALIDATION_ERROR`.

### `POST /auth/refresh`

Rate limited (10/min/IP). Rotates the refresh token — the token passed in is revoked and a new
access + refresh pair is issued. Reusing an already-rotated (or expired/revoked) refresh token
is rejected.

**Body** `{ refreshToken }`

**Response `200`** `{ accessToken, refreshToken }`

Errors: `401 REFRESH_TOKEN_INVALID`, `422 VALIDATION_ERROR`.

### `POST /auth/logout`

Rate limited (10/min/IP). Revokes the given refresh token. Idempotent — always `204` even if the
token was already revoked or unknown.

**Body** `{ refreshToken }`

**Response `204`** (no body)

### `GET /users/me`

Requires auth.

**Response `200`** `{ id, email, name, avatarUrl, createdAt }`

Errors: `401 UNAUTHORIZED`.

### `PATCH /users/me`

Requires auth.

**Body** `{ name?, avatarUrl? }`

**Response `200`** `{ id, email, name, avatarUrl, createdAt }`

Errors: `401 UNAUTHORIZED`, `422 VALIDATION_ERROR`.

## Error codes reference

| Code | Status | Where |
|---|---|---|
| `NOT_FOUND` | 404 | any unmatched route |
| `VALIDATION_ERROR` | 422 | request body fails Zod validation |
| `EMAIL_TAKEN` | 409 | register with an existing email |
| `INVALID_CREDENTIALS` | 401 | login with wrong email/password |
| `REFRESH_TOKEN_INVALID` | 401 | refresh with an unknown/expired/already-rotated token |
| `UNAUTHORIZED` | 401 | missing/invalid/expired access token |
| `INTERNAL_ERROR` | 500 | unhandled error |
