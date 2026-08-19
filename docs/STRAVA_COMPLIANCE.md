# Strava API Compliance & Data Usage

This document outlines how the Strava Running Bot complies with Strava's API terms and handles user data.

## ✅ Strava Branding Compliance

### Attribution Requirements

- **"Powered by Strava"** attribution appears in all Discord embeds and web pages
- **Official Strava logo** — the unmodified "Powered by Strava" API logo, vendored in
  `public/strava/` and self-hosted (see `public/strava/README.md`)
- **Strava orange color** (#FC4C02) used consistently
- **Links to Strava** included where appropriate

### Visual Elements

- OAuth success/error pages display the official "Powered by Strava" logo
- Route maps rendered for Strava activities carry the logo in the bottom-left corner
- Discord embed footers carry the "Powered by Strava" text — Discord renders footer
  icons at roughly 20x20 and crops them square, which the wordmark lockup cannot
  survive, and cropping it would breach the brand guidelines
- Maps for activities sourced from intervals.icu are **not** Strava-branded — attribution
  follows the provider the data actually came from

## 🔒 Data Privacy & Usage

### What Data We Access

- **Public Strava activities only** (runs, rides, etc.)
- **Basic athlete information** (name, profile picture)
- **OAuth tokens** (encrypted and stored securely)

### What We DON'T Access

- ❌ Private activities
- ❌ Followers-only activities  
- ❌ Personal messages or comments
- ❌ Detailed performance metrics beyond what's displayed
- ❌ Location data beyond activity maps

### Data Filtering

The bot automatically filters out:

- Private activities (`activity.private = true`)
- Followers-only activities (`activity.visibility = 'followers_only'`)
- Hidden activities (`activity.hide_from_home = true`)
- Flagged activities (`activity.flagged = true`)
- Activities older than 24 hours (for webhook posting)
- Short activities (less than 1 minute)
- Activities without distance (manual entries)

## 🔐 Data Security

### Token Management

- OAuth tokens encrypted with AES-256
- Automatic token refresh when needed
- Secure storage with encryption keys

### Access Control  

- Only processes data for registered team members
- Members can deactivate/remove themselves
- Admin controls for member management

### Access Revocation (Deauthorization)

The app is capped at **10 simultaneously connected Strava athletes** — the self-serve
Standard Tier ceiling ([Strava docs](https://developers.strava.com/docs/getting-started/)).
Freeing a seat requires actually telling Strava the connection is gone, not just
deleting our own copy of the tokens — so the bot calls Strava's
`POST /oauth/deauthorize` (`src/strava/api.js#deauthorize`,
`src/processors/ActivityProcessor.js#revokeStravaAccess`) whenever a member's Strava
connection ends:

- Switching provider from Strava to intervals.icu (`/register provider:intervals.icu`)
- `/members remove` and `/members deactivate` (admin)
- `/members revoke` — explicit admin revoke without touching membership
- `/disconnect` — explicit self-service revoke, with an optional `leave_team` flag

This is a **compliance strengthening**, not a workaround: Strava requires apps to
honor deauthorization and stop accessing an athlete's data once access is revoked.
Revocation is best-effort — a failed call to Strava never blocks the member-facing
operation that triggered it, and is reported back to the user/admin as a warning
instead. Revoked tokens are cleared from storage (`clearProviderTokens`) so no dead
credentials linger.

Revocation frees headroom under the 10-athlete cap but does not raise it — hosting
more than 10 athletes *simultaneously* connected to Strava still requires submitting
the app for Strava's review process. `/members connections` (admin) and
`/members revoke`'s reply report live usage against the cap
(`config.strava.athleteCap`, default 10, overridable via `STRAVA_ATHLETE_CAP`).

### Reclaimable Seats

A stored Strava credential occupies a real seat against the app's cap regardless
of whether the member is active or has since switched provider — Strava's app-level
limit only cares whether the app still holds a live grant for that athlete. Seat
accounting (`countStravaSeats`) reflects this: `used` counts every member holding
a stored Strava credential, active or not, Strava or intervals.icu.

Automatic revocation (above) only fires going forward, from the actions it's wired
into. Two categories can still hold a seat they don't need without any of those
actions ever having run: members deactivated before automatic revocation existed,
and members who switched to intervals.icu before automatic revocation existed (or
where the revoke call itself failed at the time). These are **reclaimable** seats.
`/members connections` marks each one inline (`🔑 still holds a seat`) and the
seats-used footer reports the total (`Strava seats used: 5/10 (1 reclaimable) · …`).
`/members revoke all_reclaimable:True` sweeps all of them in one pass — sequential,
one Strava API call at a time, reporting success/failure counts and the refreshed
seat total; a failed revoke for one member doesn't stop the rest.

### Connection Health Audit

`/members connections` (admin) probes every member's stored credentials live —
refreshing/validating Strava tokens and checking intervals.icu API keys — and
reports per-member status alongside the Strava seat count. This exists mainly to
surface one non-obvious failure mode: **intervals.icu cannot serve Strava-sourced
activities back out through its API** (confirmed by the intervals.icu site owner,
Oct 2025). A member who migrates to intervals.icu but whose intervals.icu account
is itself fed by Strava will authenticate successfully and silently produce zero
activities — there is no error, just... going quiet. `/members connections` flags
this as a distinct ⚠️ status (valid key, zero activities in 30 days) with a footer
explaining it, so admins can tell the member to point intervals.icu at Garmin,
Coros, Polar, or a manual upload instead.

## 📊 Rate Limiting

### ✅ Implementation Complete

- **Rate limiting**: ✅ Implemented with conservative limits
- **15-minute window**: 80 requests (Strava allows ~100)
- **Daily window**: 900 requests (Strava allows ~1000)  
- **Request queuing**: Automatic queuing when limits approached
- **Intelligent delays**: Calculates optimal wait times
- **Monitoring**: Rate limit stats in `/botstatus` command

### Strava API Limits

- **Official limits**: ~100 requests/15min, ~1000 requests/day
- **Our limits**: 80 requests/15min, 900 requests/day (conservative)
- **Queue management**: Requests queued when limits reached
- **Automatic retry**: Delayed execution with optimal timing

### Rate Limiter Features

- Real-time request tracking with sliding windows
- Automatic cleanup of expired request timestamps  
- Request queuing with FIFO processing
- Context-aware logging for debugging
- Stats available via Discord command and API

## 🎯 Usage Scope

### Intended Use

- **Team/club activity sharing** in Discord channels
- **Motivation and engagement** for running groups
- **Public activity celebration** and community building

### Data Retention

- Member data stored until manually removed
- No automatic data expiration (may need to implement)
- Tokens refreshed as needed to maintain access

## 📋 Production Checklist

### ✅ Completed

- [x] Proper "Powered by Strava" attribution
- [x] Official Strava logo artwork, self-hosted and unmodified
- [x] Privacy filtering (public activities only)
- [x] Secure OAuth implementation
- [x] Encrypted token storage
- [x] Webhook verification
- [x] Configurable BASE_URL for production
- [x] **Rate limiting implementation** (NEW!)
- [x] **Strava deauthorization on disconnect/remove/deactivate/switch** — honors revocation and frees athlete seats (NEW!)

### ⚠️ Recommended for Production

- [ ] Submit app for Strava review (if required)
- [ ] Add data retention policies
- [ ] Terms of service for end users
- [ ] Monitoring and alerting

## 🌐 Links & Resources

- **Strava Developer Agreement**: <https://developers.strava.com/docs/getting-started/>
- **Strava API Guidelines**: <https://developers.strava.com/guidelines/>
- **Bot Documentation**: See README.md and docs/ folder

## 📞 Contact

For questions about data usage, privacy, or Strava compliance:

- Review bot documentation
- Check Strava developer guidelines  
- Contact bot administrator

---

**Last Updated**: December 2024  
**Strava API Version**: v3
