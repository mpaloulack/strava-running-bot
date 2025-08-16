const express = require('express');
const config = require('../../config/config');

class WebhookServer {
  constructor(activityProcessor) {
    this.app = express();
    this.activityProcessor = activityProcessor;
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    // Parse JSON bodies
    this.app.use(express.json());
    
    // Parse URL-encoded bodies
    this.app.use(express.urlencoded({ extended: true }));

    // Basic logging middleware
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
      next();
    });
  }

  setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        service: config.app.name,
        version: config.app.version
      });
    });

    // Strava webhook verification endpoint
    this.app.get('/webhook/strava', this.handleWebhookVerification.bind(this));
    
    // Strava webhook event endpoint
    this.app.post('/webhook/strava', this.handleWebhookEvent.bind(this));

    // OAuth callback endpoint for Strava authentication
    this.app.get('/auth/strava/callback', this.handleStravaCallback.bind(this));

    // Member registration endpoint
    this.app.get('/auth/strava', this.handleStravaAuth.bind(this));

    // Member management endpoints
    this.app.get('/members', this.listMembers.bind(this));
    this.app.post('/members/:athleteId/delete', this.removeMember.bind(this));
    this.app.post('/members/discord/:discordId/delete', this.removeMemberByDiscord.bind(this));
    this.app.post('/members/:athleteId/deactivate', this.deactivateMember.bind(this));
    this.app.post('/members/:athleteId/reactivate', this.reactivateMember.bind(this));

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({ 
        error: 'Not found',
        path: req.originalUrl 
      });
    });

    // Error handler
    this.app.use((error, req, res, next) => {
      console.error('❌ Server error:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: config.server.nodeEnv === 'development' ? error.message : 'Something went wrong'
      });
    });
  }

  // Handle Strava webhook verification challenge
  handleWebhookVerification(req, res) {
    const { 'hub.challenge': challenge, 'hub.verify_token': verifyToken } = req.query;

    console.log('🔍 Webhook verification request received');
    console.log('Verify token:', verifyToken);
    console.log('Expected token:', config.strava.webhookVerifyToken);

    // Verify the token matches what we set in Strava
    if (verifyToken === config.strava.webhookVerifyToken) {
      console.log('✅ Webhook verification successful');
      res.json({ 'hub.challenge': challenge });
    } else {
      console.log('❌ Webhook verification failed - invalid token');
      res.status(403).json({ error: 'Invalid verify token' });
    }
  }

  // Handle incoming webhook events from Strava
  async handleWebhookEvent(req, res) {
    try {
      const event = req.body;
      
      console.log('📨 Webhook event received:', JSON.stringify(event, null, 2));

      // Acknowledge receipt immediately
      res.status(200).json({ received: true });

      // Process the event asynchronously
      await this.processWebhookEvent(event);

    } catch (error) {
      console.error('❌ Error handling webhook event:', error);
      res.status(500).json({ error: 'Failed to process webhook event' });
    }
  }

  // Process different types of webhook events
  async processWebhookEvent(event) {
    const { object_type, aspect_type, object_id, owner_id, subscription_id, event_time } = event;

    console.log(`🔄 Processing ${aspect_type} event for ${object_type} ${object_id} (owner: ${owner_id})`);

    // Only process activity events
    if (object_type !== 'activity') {
      console.log('⏭️ Skipping non-activity event');
      return;
    }

    // Handle different event types
    switch (aspect_type) {
      case 'create':
        await this.handleActivityCreate(object_id, owner_id);
        break;
      case 'update':
        await this.handleActivityUpdate(object_id, owner_id);
        break;
      case 'delete':
        await this.handleActivityDelete(object_id, owner_id);
        break;
      default:
        console.log(`⏭️ Unhandled event type: ${aspect_type}`);
    }
  }

  // Handle new activity creation
  async handleActivityCreate(activityId, athleteId) {
    try {
      console.log(`🏃 New activity created: ${activityId} by athlete ${athleteId}`);
      await this.activityProcessor.processNewActivity(activityId, athleteId);
    } catch (error) {
      console.error(`❌ Error processing new activity ${activityId}:`, error);
    }
  }

  // Handle activity updates
  async handleActivityUpdate(activityId, athleteId) {
    try {
      console.log(`📝 Activity updated: ${activityId} by athlete ${athleteId}`);
      // For now, we'll treat updates the same as new activities
      // In the future, you might want to update the Discord message
      await this.activityProcessor.processNewActivity(activityId, athleteId);
    } catch (error) {
      console.error(`❌ Error processing activity update ${activityId}:`, error);
    }
  }

  // Handle activity deletion
  async handleActivityDelete(activityId, athleteId) {
    console.log(`🗑️ Activity deleted: ${activityId} by athlete ${athleteId}`);
    // For now, we'll just log it. In the future, you might want to
    // delete the corresponding Discord message
  }

  // Handle Strava OAuth authorization
  handleStravaAuth(req, res) {
    const { user_id } = req.query; // Discord user ID passed as state
    
    if (!user_id) {
      return res.status(400).json({ error: 'Missing user_id parameter' });
    }

    const authUrl = this.activityProcessor.stravaAPI.getAuthorizationUrl(user_id);
    res.redirect(authUrl);
  }

  // Handle Strava OAuth callback
  async handleStravaCallback(req, res) {
    try {
      const { code, state, error } = req.query;

      if (error) {
        console.error('❌ Strava OAuth error:', error);
        return res.status(400).json({ error: `Strava authorization failed: ${error}` });
      }

      if (!code) {
        return res.status(400).json({ error: 'Missing authorization code' });
      }

      const discordUserId = state; // Discord user ID from state parameter

      // Exchange code for tokens
      const tokenData = await this.activityProcessor.stravaAPI.exchangeCodeForToken(code);
      
      // Get athlete information
      const athlete = await this.activityProcessor.stravaAPI.getAthlete(tokenData.access_token);

      // Register the member
      await this.activityProcessor.memberManager.registerMember(
        discordUserId,
        athlete,
        tokenData
      );

      console.log(`✅ Successfully registered athlete: ${athlete.firstname} ${athlete.lastname}`);

      res.send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1>✅ Authorization Successful!</h1>
            <p>Welcome <strong>${athlete.firstname} ${athlete.lastname}</strong>!</p>
            <p>Your Strava account has been successfully linked to the HFR Running Bot.</p>
            <p>You can now close this window and return to Discord.</p>
          </body>
        </html>
      `);

    } catch (error) {
      console.error('❌ Error in Strava callback:', error);
      res.status(500).send(`
        <html>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1>❌ Authorization Failed</h1>
            <p>There was an error linking your Strava account.</p>
            <p>Please try again or contact support.</p>
            <p>Error: ${error.message}</p>
          </body>
        </html>
      `);
    }
  }

  // List all members
  async listMembers(req, res) {
    try {
      const members = await this.activityProcessor.memberManager.getAllMembers();
      const memberList = members.map(member => ({
        athleteId: member.athlete.id,
        discordUserId: member.discordUserId,
        name: `${member.athlete.firstname} ${member.athlete.lastname}`,
        registeredAt: member.registeredAt,
        isActive: member.isActive,
        city: member.athlete.city,
        country: member.athlete.country
      }));

      res.json({
        total: memberList.length,
        members: memberList
      });
    } catch (error) {
      console.error('❌ Error listing members:', error);
      res.status(500).json({ error: 'Failed to list members' });
    }
  }

  // Remove member by athlete ID
  async removeMember(req, res) {
    try {
      const { athleteId } = req.params;
      const removedMember = await this.activityProcessor.memberManager.removeMember(athleteId);
      
      if (removedMember) {
        res.json({
          success: true,
          message: `Removed member: ${removedMember.athlete.firstname} ${removedMember.athlete.lastname}`,
          member: {
            athleteId: removedMember.athlete.id,
            name: `${removedMember.athlete.firstname} ${removedMember.athlete.lastname}`,
            discordUserId: removedMember.discordUserId
          }
        });
      } else {
        res.status(404).json({ error: 'Member not found' });
      }
    } catch (error) {
      console.error('❌ Error removing member:', error);
      res.status(500).json({ error: 'Failed to remove member' });
    }
  }

  // Remove member by Discord ID
  async removeMemberByDiscord(req, res) {
    try {
      const { discordId } = req.params;
      const removedMember = await this.activityProcessor.memberManager.removeMemberByDiscordId(discordId);
      
      if (removedMember) {
        res.json({
          success: true,
          message: `Removed member: ${removedMember.athlete.firstname} ${removedMember.athlete.lastname}`,
          member: {
            athleteId: removedMember.athlete.id,
            name: `${removedMember.athlete.firstname} ${removedMember.athlete.lastname}`,
            discordUserId: removedMember.discordUserId
          }
        });
      } else {
        res.status(404).json({ error: 'Member not found' });
      }
    } catch (error) {
      console.error('❌ Error removing member by Discord ID:', error);
      res.status(500).json({ error: 'Failed to remove member' });
    }
  }

  // Deactivate member
  async deactivateMember(req, res) {
    try {
      const { athleteId } = req.params;
      const success = await this.activityProcessor.memberManager.deactivateMember(athleteId);
      
      if (success) {
        res.json({
          success: true,
          message: `Deactivated member with athlete ID: ${athleteId}`
        });
      } else {
        res.status(404).json({ error: 'Member not found' });
      }
    } catch (error) {
      console.error('❌ Error deactivating member:', error);
      res.status(500).json({ error: 'Failed to deactivate member' });
    }
  }

  // Reactivate member
  async reactivateMember(req, res) {
    try {
      const { athleteId } = req.params;
      const success = await this.activityProcessor.memberManager.reactivateMember(athleteId);
      
      if (success) {
        res.json({
          success: true,
          message: `Reactivated member with athlete ID: ${athleteId}`
        });
      } else {
        res.status(404).json({ error: 'Member not found' });
      }
    } catch (error) {
      console.error('❌ Error reactivating member:', error);
      res.status(500).json({ error: 'Failed to reactivate member' });
    }
  }

  start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(config.server.port, () => {
        console.log(`🌐 Webhook server started on port ${config.server.port}`);
        console.log(`📡 Webhook endpoint: http://localhost:${config.server.port}/webhook/strava`);
        console.log(`🔗 Auth endpoint: http://localhost:${config.server.port}/auth/strava`);
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('🔴 Webhook server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = WebhookServer;