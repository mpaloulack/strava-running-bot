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
