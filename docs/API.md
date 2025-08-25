# API Documentation

This document provides comprehensive documentation for the Strava Running Bot REST API endpoints.

## Base URL

```
http://localhost:3000
```

For production, replace with your deployed domain.

## Authentication

Most endpoints are public for simplicity, but in production you may want to add authentication. The bot uses internal validation for webhook signatures.

## Response Format

All responses are in JSON format. Successful responses return data objects, while errors return error objects:

```json
// Success Response
{
  "success": true,
  "data": { ... },
  "message": "Operation completed successfully"
}

// Error Response
{
  "success": false,
  "error": "Error description",
  "details": "Additional error details"
}
```

## Endpoints

### Health & Status

#### `GET /health`

Returns the health status of the bot.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-08-16T15:30:00.000Z",
  "service": "Strava Running Bot",
  "version": "1.0.0"
}
```

**Status Codes:**
- `200` - Service is healthy
- `503` - Service is unhealthy

---

### Member Management

#### `GET /members`

Returns a list of all registered team members.

**Response:**
```json
{
  "total": 5,
  "members": [
    {
      "athleteId": 12345678,
      "discordUserId": "246990374969540618",
      "name": "John Doe",
      "registeredAt": "2024-08-16T12:00:00.000Z",
      "isActive": true,
      "city": "San Francisco",
      "country": "United States"
    }
  ]
}
```

**Status Codes:**
- `200` - Success
- `500` - Internal server error

---

#### `POST /members/{athleteId}/delete`

Permanently removes a team member by their Strava athlete ID.

**Parameters:**
- `athleteId` (path) - Strava athlete ID

**Response:**
```json
{
  "success": true,
  "message": "Removed member: John Doe",
  "member": {
    "athleteId": 12345678,
    "name": "John Doe",
    "discordUserId": "246990374969540618"
  }
}
```

**Status Codes:**
- `200` - Member removed successfully
- `404` - Member not found
- `500` - Internal server error

---

#### `POST /members/discord/{discordId}/delete`

Permanently removes a team member by their Discord user ID.

**Parameters:**
- `discordId` (path) - Discord user ID

**Response:**
```json
{
  "success": true,
  "message": "Removed member: John Doe",
  "member": {
    "athleteId": 12345678,
    "name": "John Doe",
    "discordUserId": "246990374969540618"
  }
}
```

**Status Codes:**
- `200` - Member removed successfully
- `404` - Member not found
- `500` - Internal server error

---

#### `POST /members/{athleteId}/deactivate`

Temporarily deactivates a team member (stops posting their activities).

**Parameters:**
- `athleteId` (path) - Strava athlete ID

**Response:**
```json
{
  "success": true,
  "message": "Deactivated member with athlete ID: 12345678"
}
```

**Status Codes:**
- `200` - Member deactivated successfully
- `404` - Member not found
- `500` - Internal server error

---

#### `POST /members/{athleteId}/reactivate`

Reactivates a previously deactivated team member.

**Parameters:**
- `athleteId` (path) - Strava athlete ID

**Response:**
```json
{
  "success": true,
  "message": "Reactivated member with athlete ID: 12345678"
}
```

**Status Codes:**
- `200` - Member reactivated successfully
- `404` - Member not found
- `500` - Internal server error

---

### Strava Integration

#### `GET /webhook/strava`

Webhook verification endpoint for Strava. Used during webhook subscription setup.

**Query Parameters:**
- `hub.challenge` (required) - Challenge string from Strava
- `hub.verify_token` (required) - Verification token

**Response:**
```json
{
  "hub.challenge": "challenge_string_here"
}
```

**Status Codes:**
- `200` - Verification successful
- `403` - Invalid verification token

---

#### `POST /webhook/strava`

Receives webhook events from Strava when activities are created, updated, or deleted.

**Request Body:**
```json
{
  "object_type": "activity",
  "aspect_type": "create",
  "object_id": 1234567890,
  "owner_id": 12345678,
  "subscription_id": 98765,
  "event_time": 1629123456
}
```

**Response:**
```json
{
  "received": true
}
```

**Status Codes:**
- `200` - Event received and processed
- `500` - Processing error

---

### Authentication Flow

#### `GET /auth/strava`

Initiates the Strava OAuth flow for member registration.

**Query Parameters:**
- `user_id` (required) - Discord user ID

**Response:**
Redirects to Strava authorization URL.

**Status Codes:**
- `302` - Redirect to Strava
- `400` - Missing user_id parameter

---

#### `GET /auth/strava/callback`

Handles the OAuth callback from Strava after user authorization.

**Query Parameters:**
- `code` (required) - Authorization code from Strava
- `state` - Discord user ID passed through OAuth flow
- `error` - Error from Strava (if authorization failed)

**Response:**
HTML page indicating success or failure.

**Status Codes:**
- `200` - Authorization successful or failed (HTML response)
- `400` - Missing authorization code
- `500` - Internal error during token exchange

---

## Error Handling

### Error Response Format

```json
{
  "error": "Error message",
  "details": "Detailed error description",
  "timestamp": "2024-08-16T15:30:00.000Z"
}
```

### Common Error Codes

| Status Code | Description |
|-------------|-------------|
| `400` | Bad Request - Invalid parameters or request format |
| `401` | Unauthorized - Invalid or missing authentication |
| `403` | Forbidden - Access denied |
| `404` | Not Found - Resource not found |
| `429` | Too Many Requests - Rate limit exceeded |
| `500` | Internal Server Error - Server-side error |
| `503` | Service Unavailable - Service is down or unhealthy |

## Rate Limiting

The API implements basic rate limiting to prevent abuse:

- **Member operations**: 10 requests per minute per IP
- **Webhook endpoints**: 100 requests per minute
- **Health checks**: Unlimited

Rate limit headers are included in responses:

```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 9
X-RateLimit-Reset: 1629123456
```

## Example Usage

### cURL Examples

```bash
# Get all members
curl -X GET http://localhost:3000/members

# Remove member by athlete ID
curl -X POST http://localhost:3000/members/12345678/delete

# Remove member by Discord ID
curl -X POST http://localhost:3000/members/discord/246990374969540618/delete

# Deactivate member
curl -X POST http://localhost:3000/members/12345678/deactivate

# Reactivate member
curl -X POST http://localhost:3000/members/12345678/reactivate

# Check health
curl -X GET http://localhost:3000/health
```

### JavaScript Examples

```javascript
// Get all members
const response = await fetch('http://localhost:3000/members');
const data = await response.json();
console.log(data.members);

// Remove member
const removeResponse = await fetch('http://localhost:3000/members/12345678/delete', {
  method: 'POST'
});
const result = await removeResponse.json();
console.log(result.message);

// Check health
const healthResponse = await fetch('http://localhost:3000/health');
const healthData = await healthResponse.json();
console.log(healthData.status);
```

### Python Examples

```python
import requests

# Get all members
response = requests.get('http://localhost:3000/members')
members = response.json()['members']

# Remove member
response = requests.post('http://localhost:3000/members/12345678/delete')
result = response.json()
print(result['message'])

# Check health
response = requests.get('http://localhost:3000/health')
health = response.json()
print(f"Status: {health['status']}")
```

## Webhook Payload Examples

### Activity Created

```json
{
  "object_type": "activity",
  "aspect_type": "create",
  "object_id": 1234567890,
  "owner_id": 12345678,
  "subscription_id": 98765,
  "event_time": 1629123456
}
```

### Activity Updated

```json
{
  "object_type": "activity",
  "aspect_type": "update",
  "object_id": 1234567890,
  "owner_id": 12345678,
  "subscription_id": 98765,
  "event_time": 1629123456
}
```

### Activity Deleted

```json
{
  "object_type": "activity",
  "aspect_type": "delete",
  "object_id": 1234567890,
  "owner_id": 12345678,
  "subscription_id": 98765,
  "event_time": 1629123456
}
```

## Security Considerations

### Input Validation

All endpoints validate input parameters:
- Athlete IDs must be valid numbers
- Discord IDs must be valid snowflake format
- Required parameters are checked

### Data Sanitization

- All user input is sanitized to prevent XSS attacks
- SQL injection protection (though we use JSON storage)
- Rate limiting to prevent abuse

### Webhook Security

- Strava webhook verification token validation
- Request origin validation
- Payload size limits

## Development Notes

### Adding New Endpoints

To add new API endpoints:

1. Add route definition in `src/server/webhook.js`
2. Implement handler method
3. Add input validation
4. Update this documentation
5. Add tests (when test suite is implemented)

### Versioning

Currently, the API is unversioned. Future versions should include:
- Version prefix in URLs (`/v1/members`)
- Version header support
- Backward compatibility considerations

### Monitoring

Consider implementing:
- Request logging
- Performance metrics
- Error tracking
- Usage analytics

## Support

For API-related questions or issues:

1. Check the logs for detailed error messages
2. Verify request format and parameters
3. Test with curl or Postman
4. Check network connectivity
5. Review rate limiting headers

For bug reports or feature requests, please create an issue in the project repository.