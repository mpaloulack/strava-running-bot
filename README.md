# HFR Running Bot 🏃‍♂️

A comprehensive Discord bot that automatically posts Strava activities from your running team members to a dedicated Discord channel. Built with real-time webhooks, rich activity displays, and complete team management functionality. This bot has been built from the ground up with Claude Code. Work in progress.

![Discord Bot](https://img.shields.io/badge/Discord-Bot-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![Strava](https://img.shields.io/badge/Strava-API-FC4C02?style=for-the-badge&logo=strava&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)

## 🎯 Features

### 🏃 **Real-time Activity Posting**
- Automatically posts new activities from team members via Strava webhooks
- Rich Discord embeds with comprehensive activity information
- Supports all activity types (running, cycling, swimming, etc.)
- Posts both public and private activities from registered members

### 📊 **Comprehensive Activity Display**
- **Activity name and description**
- **Distance, time, and pace**
- **Grade Adjusted Pace (GAP)** for hill-adjusted performance
- **Average heart rate** and elevation gain
- **Route map visualization** (with optional Google Maps integration)
- **Direct links to Strava activities**
- **Activity type-specific styling and icons**

### 👥 **Team Management**
- Support for 40+ team members with secure token management
- OAuth2 authentication flow with encrypted token storage
- Member registration, deactivation, and removal
- Discord slash commands for easy team management
- Web-based registration system

### 🎮 **Discord Integration**
- **Slash Commands**: `/members`, `/register`, `/last`, `/botstatus`
- **Member Management**: Add, remove, activate/deactivate members
- **Activity Lookup**: View any member's latest activity on-demand
- **Admin Controls**: Permission-based management commands
- **Autocomplete**: Smart member name suggestions

### 🔒 **Security & Reliability**
- Encrypted token storage with AES-256 encryption
- Non-blocking asynchronous operations
- Graceful error handling and token refresh
- Health monitoring and status endpoints
- Docker-ready with security best practices

## 🚀 Quick Start

### Prerequisites

- Node.js 18.0 or higher
- Discord bot token and server permissions
- Strava API application credentials
- Public domain/server for webhooks (for production)

### Installation

1. **Clone and Setup**
   ```bash
   git clone <your-repo-url>
   cd hfrrunningbot
   npm install
   ```

2. **Configure Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your API credentials
   ```

3. **Start Development**
   ```bash
   npm run dev
   ```

4. **Deploy with Docker**
   ```bash
   docker-compose up -d
   ```

## 📋 Complete Setup Guide

### 1. Discord Bot Setup

1. Visit [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application and bot
3. Copy the bot token to your `.env` file
4. Generate invite link with these permissions:
   - Send Messages
   - Use Slash Commands
   - Embed Links
   - Attach Files
   - Read Message History
5. Add bot to your server and note the channel ID

### 2. Strava API Setup

1. Go to [Strava API Settings](https://www.strava.com/settings/api)
2. Create a new API application
3. Set Authorization Callback Domain to your server domain
4. Copy Client ID and Client Secret to your `.env` file
5. Generate a webhook verification token

### 3. Environment Configuration

```env
# Discord Bot Configuration
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_CHANNEL_ID=your_discord_channel_id_here

# Strava API Configuration
STRAVA_CLIENT_ID=your_strava_client_id_here
STRAVA_CLIENT_SECRET=your_strava_client_secret_here
STRAVA_WEBHOOK_VERIFY_TOKEN=your_webhook_verify_token_here

# Server Configuration
PORT=3000
NODE_ENV=development

# Security
ENCRYPTION_KEY=your_32_character_encryption_key_here

# Optional: Google Maps API (for route maps)
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
```

Generate an encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Webhook Setup (Production)

For production deployment, set up Strava webhooks:

```bash
# Create webhook subscription
node utils/setup.js create-webhook https://your-domain.com/webhook/strava

# List existing webhooks
node utils/setup.js list-webhooks

# Delete webhook
node utils/setup.js delete-webhook SUBSCRIPTION_ID
```

## 🎮 Discord Commands

### User Commands

| Command | Description | Usage |
|---------|-------------|-------|
| `/register` | Register yourself with Strava | `/register` |
| `/last` | Show last activity from a member | `/last member: John` |

### Admin Commands (Manage Server Permission Required)

| Command | Description | Usage |
|---------|-------------|-------|
| `/members list` | List all registered team members | `/members list` |
| `/members remove` | Remove a team member | `/members remove user: @user` |
| `/members deactivate` | Temporarily deactivate a member | `/members deactivate user: @user` |
| `/members reactivate` | Reactivate a deactivated member | `/members reactivate user: @user` |
| `/botstatus` | Show bot statistics and health | `/botstatus` |

## 🌐 API Endpoints

### Health & Status
- `GET /health` - Health check endpoint
- `GET /members` - List all registered members (JSON)

### Member Management
- `POST /members/:athleteId/delete` - Remove member by athlete ID
- `POST /members/discord/:discordId/delete` - Remove member by Discord ID
- `POST /members/:athleteId/deactivate` - Deactivate member
- `POST /members/:athleteId/reactivate` - Reactivate member

### Strava Integration
- `GET /webhook/strava` - Webhook verification endpoint
- `POST /webhook/strava` - Webhook event receiver
- `GET /auth/strava` - Start OAuth flow
- `GET /auth/strava/callback` - OAuth callback handler

### Example Usage

```bash
# List all members
curl http://localhost:3000/members

# Remove a member
curl -X POST http://localhost:3000/members/12345678/delete

# Check bot health
curl http://localhost:3000/health
```

## 🏗️ Project Architecture

```
hfrrunningbot/
├── src/
│   ├── discord/
│   │   ├── bot.js              # Discord bot implementation
│   │   └── commands.js         # Slash command handlers
│   ├── strava/
│   │   └── api.js              # Strava API integration
│   ├── server/
│   │   └── webhook.js          # Webhook server & API endpoints
│   ├── processors/
│   │   └── ActivityProcessor.js # Main activity processing logic
│   ├── managers/
│   │   └── MemberManager.js    # Team member management
│   └── index.js                # Application entry point
├── config/
│   └── config.js               # Configuration management
├── utils/
│   └── setup.js                # Setup and management utilities
├── data/                       # Member data storage (encrypted)
├── logs/                       # Application logs
├── .env.example                # Environment variables template
├── docker-compose.yml          # Docker deployment configuration
├── Dockerfile                  # Container image definition
└── README.md                   # This documentation
```

### Key Components

#### **ActivityProcessor**
- Central orchestrator for all bot operations
- Handles activity processing pipeline
- Manages Discord and Strava integrations
- Coordinates member management

#### **DiscordBot**
- Discord.js client wrapper
- Slash command registration and handling
- Rich embed generation for activities
- Event handling and error management

#### **StravaAPI**
- Complete Strava API wrapper
- OAuth2 authentication flow
- Activity data processing
- Rate limiting and error handling

#### **MemberManager**
- Secure member data storage with encryption
- Token management and refresh
- Member lifecycle operations
- Discord user mapping

#### **WebhookServer**
- Express.js server for webhooks and API
- Strava webhook event processing
- Member management endpoints
- Health and status monitoring

## 🔧 Configuration Options

### Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `DISCORD_TOKEN` | ✅ | Discord bot token | - |
| `DISCORD_CHANNEL_ID` | ✅ | Target Discord channel ID | - |
| `STRAVA_CLIENT_ID` | ✅ | Strava API client ID | - |
| `STRAVA_CLIENT_SECRET` | ✅ | Strava API client secret | - |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | ✅ | Webhook verification token | - |
| `ENCRYPTION_KEY` | ✅ | 32-byte hex encryption key | - |
| `PORT` | ❌ | Server port | `3000` |
| `NODE_ENV` | ❌ | Environment mode | `development` |
| `GOOGLE_MAPS_API_KEY` | ❌ | Google Maps API key for route maps | - |

### Application Settings

- **Activity Filters**: Automatically filters activities older than 24 hours
- **Rate Limiting**: Respects Strava API rate limits (100 requests/15min)
- **Token Refresh**: Automatic token refresh before expiration
- **Data Persistence**: Encrypted member data stored in JSON files
- **Error Recovery**: Automatic retry mechanisms for failed operations

## 🐳 Docker Deployment

### Quick Deploy

```bash
# Start with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f

# Check status
docker-compose ps
```

### Production Deployment

For production deployment on a NAS or server:

1. **Configure Environment**: Set `NODE_ENV=production` in `.env`
2. **Resource Limits**: Adjust memory/CPU limits in `docker-compose.yml`
3. **Domain Setup**: Configure domain and HTTPS for webhooks
4. **Monitoring**: Set up log monitoring and alerting
5. **Backups**: Regular backup of member data volume

See [DOCKER_DEPLOYMENT.md](./DOCKER_DEPLOYMENT.md) for detailed Docker deployment instructions.

## 📊 Monitoring & Maintenance

### Health Checks

```bash
# Check application health
curl http://localhost:3000/health

# View bot statistics
curl http://localhost:3000/members

# Check Docker health
docker-compose ps
```

### Logs

```bash
# Development
npm run dev

# Docker
docker-compose logs -f

# Specific timeframe
docker-compose logs --since="1h"
```

### Maintenance Tasks

- **Weekly**: Check member token status and activity
- **Monthly**: Update dependencies and security patches
- **Quarterly**: Review and rotate encryption keys
- **As needed**: Monitor Strava API quota usage

## 🛠 Development

### Prerequisites

- Node.js 18+
- npm or yarn
- Git

### Development Setup

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run setup utilities
node utils/setup.js validate
node utils/setup.js generate-key
```

### Project Scripts

```bash
npm start          # Start production server
npm run dev        # Start development server with nodemon
npm test           # Run tests (when implemented)
```

### Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 🔐 Security Considerations

### Data Protection
- **Encryption**: All sensitive member data encrypted with AES-256
- **Token Security**: Secure storage and automatic rotation of API tokens
- **Access Control**: Permission-based Discord command access
- **Input Validation**: Comprehensive input validation and sanitization

### Network Security
- **HTTPS Required**: Production deployment requires HTTPS
- **Webhook Verification**: Strava webhook signature validation
- **Rate Limiting**: API rate limiting and abuse prevention
- **Container Security**: Non-root user and minimal container surface

### Best Practices
- Regular security updates and dependency management
- Secure environment variable management
- Audit logs for administrative actions
- Backup and recovery procedures

## 🐛 Troubleshooting

### Common Issues

#### Bot Not Responding
```bash
# Check bot status
curl http://localhost:3000/health

# View logs
docker-compose logs -f

# Verify Discord permissions
# Check bot invite URL and server permissions
```

#### Member Registration Failing
```bash
# Verify Strava credentials
node utils/setup.js validate

# Check redirect URI configuration
# Ensure domain matches Strava app settings
```

#### Activities Not Posting
```bash
# Check webhook subscription
node utils/setup.js list-webhooks

# Verify member tokens
curl http://localhost:3000/members

# Check webhook logs
docker-compose logs -f | grep webhook
```

#### Token Refresh Errors
```bash
# Check member status
curl http://localhost:3000/members

# Manually refresh if needed
# Members may need to re-authorize
```

### Debug Mode

Enable debug logging by setting `NODE_ENV=development` in your `.env` file.

### Support

For additional support:

1. Check the logs for detailed error messages
2. Verify all configuration settings
3. Test individual components (Discord, Strava, webhooks)
4. Review Strava API quota and rate limits
5. Check network connectivity and firewall settings

## 📚 Additional Resources

- [Strava API Documentation](https://developers.strava.com/docs/reference/)
- [Discord.js Guide](https://discordjs.guide/)
- [Docker Documentation](https://docs.docker.com/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🏆 Acknowledgments

- **Strava API** for providing comprehensive fitness data access
- **Discord.js** for excellent Discord bot development framework
- **Node.js Community** for robust ecosystem and best practices
- **Running Community** for inspiration and testing

---

**Built with ❤️ for the running community**

For questions, issues, or contributions, please visit our [GitHub repository](https://github.com/your-repo/hfr-running-bot).