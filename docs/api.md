# API

All routes are prefixed `/api/v1`. Auth via `Authorization: Bearer <access>` (added in Phase 1).

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
