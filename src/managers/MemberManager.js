const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const config = require('../../config/config');
const StravaAPI = require('../strava/api');
const logger = require('../utils/Logger');

class MemberManager {
  constructor() {
    this.members = new Map(); // athleteId -> member data
    this.discordToStrava = new Map(); // discordUserId -> athleteId
    this.dataFile = path.join(__dirname, '../../data/members.json');
    this.stravaAPI = new StravaAPI();
  }

  // Load members from file
  async loadMembers() {
    try {
      const data = await fs.readFile(this.dataFile, 'utf8');
      const memberData = JSON.parse(data);
      
      // Decrypt and restore member data
      for (const member of memberData.members) {
        const decryptedMember = this.decryptMemberData(member);
        // Ensure new flag is present (backwards compatibility)
        decryptedMember.sharePrivateActivities = !!decryptedMember.sharePrivateActivities;
        this.members.set(decryptedMember.athlete.id.toString(), decryptedMember);
        
        if (decryptedMember.discordUserId) {
          this.discordToStrava.set(decryptedMember.discordUserId, decryptedMember.athlete.id.toString());
        }
      }
      
      logger.member.info('Members loaded from storage', {
        count: this.members.size,
        memberIds: Array.from(this.members.keys())
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.member.info('No existing member data found, starting fresh');
        await this.ensureDataDirectory();
      } else {
        logger.member.error('Error loading members', error);
      }
    }
  }

  // Save members to file
  async saveMembers() {
    try {
      await this.ensureDataDirectory();
      
      // Encrypt member data before saving
      const membersArray = Array.from(this.members.values());
      const encryptedMembers = membersArray.map(member => this.encryptMemberData(member));
      
      const dataToSave = {
        version: '1.0',
        savedAt: new Date().toISOString(),
        members: encryptedMembers
      };
      
      await fs.writeFile(this.dataFile, JSON.stringify(dataToSave, null, 2));
      logger.member.debug('Members saved to storage', {
        count: this.members.size,
        filePath: this.dataFile
      });
    } catch (error) {
      logger.member.error('Error saving members', error);
    }
  }

  // Save members asynchronously without blocking
  saveMembersAsync() {
    // Use setTimeout to make it truly async and non-blocking
    setTimeout(() => {
      this.saveMembers().catch(error => {
        logger.member.error('Error in async save', error);
      });
    }, 0);
  }

  // Ensure data directory exists
  async ensureDataDirectory() {
    const dataDir = path.dirname(this.dataFile);
    try {
      await fs.access(dataDir);
    } catch {
      await fs.mkdir(dataDir, { recursive: true });
    }
  }

  // Register a new member
  async registerMember(discordUserId, athlete, tokenData, discordUser = null) {
    const athleteId = athlete.id.toString();
    
    // Normalize discord user id: prefer explicit param but fall back to discordUser.id when available
    const resolvedDiscordUserId = discordUserId || (discordUser && (discordUser.id || discordUser.userId)) || null;
    
    // Normalize discord user object and guard against missing methods/properties
    const normalizedDiscordUser = discordUser ? {
      username: discordUser.username || null,
      displayName: discordUser.displayName || discordUser.globalName || discordUser.username || null,
      discriminator: discordUser.discriminator || null,
      avatar: discordUser.avatar || null,
      avatarURL: (typeof discordUser.displayAvatarURL === 'function')
        ? discordUser.displayAvatarURL()
        : (discordUser.avatarURL || null)
    } : null;

    const member = {
      discordUserId: resolvedDiscordUserId,
      discordUser: normalizedDiscordUser,
      athlete: {
        id: athlete.id,
        firstname: athlete.firstname,
        lastname: athlete.lastname,
        profile: athlete.profile,
        profile_medium: athlete.profile_medium,
        city: athlete.city,
        state: athlete.state,
        country: athlete.country,
        sex: athlete.sex,
        premium: athlete.premium,
        created_at: athlete.created_at,
        updated_at: athlete.updated_at
      },
      tokens: {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: tokenData.expires_at,
        expires_in: tokenData.expires_in,
        token_type: tokenData.token_type
      },
      canViewPrivateActivity: false,
      registeredAt: new Date().toISOString(),
      lastTokenRefresh: new Date().toISOString(),
      isActive: true
    };

    this.members.set(athleteId, member);
    // Only map discord -> athlete when we actually have a resolved discord user id
    if (resolvedDiscordUserId) {
      this.discordToStrava.set(resolvedDiscordUserId, athleteId);
    }
    
    // Save asynchronously without blocking
    this.saveMembersAsync();
    
    const displayName = normalizedDiscordUser ? (normalizedDiscordUser.displayName || normalizedDiscordUser.username) : (resolvedDiscordUserId || discordUserId || athleteId);
    logger.memberAction('REGISTERED', `${athlete.firstname} ${athlete.lastname}`, discordUserId, athleteId, {
      displayName,
      registeredAt: member.registeredAt
    });
    return member;
  }

  // Get member by athlete ID
  async getMemberByAthleteId(athleteId) {
    return this.members.get(athleteId.toString());
  }

  // Get member by Discord user ID
  async getMemberByDiscordId(discordUserId) {
    const athleteId = this.discordToStrava.get(discordUserId);
    if (athleteId) {
      return this.members.get(athleteId);
    }
    return null;
  }

  // Get all active members
  async getAllMembers() {
    return Array.from(this.members.values()).filter(member => member.isActive);
  }

  // Get member count
  getMemberCount() {
    return Array.from(this.members.values()).filter(member => member.isActive).length;
  }

  // Get valid access token for member (refresh if needed)
  async getValidAccessToken(member) {
    const now = Math.floor(Date.now() / 1000);
    
    // Check if token is still valid (expires 1 hour before actual expiry for safety)
    if (member.tokens.expires_at && member.tokens.expires_at > (now + 3600)) {
      return member.tokens.access_token;
    }

    // Token expired or about to expire, refresh it
    const displayName = member.discordUser ? member.discordUser.displayName : member.athlete.firstname;
    logger.member.debug('Token expired, refreshing', {
      memberName: displayName,
      athleteId: member.athlete.id,
      expiresAt: member.tokens.expires_at
    });
    return await this.refreshMemberToken(member);
  }

  // Refresh member's access token
  async refreshMemberToken(member) {
    try {
      const tokenData = await this.stravaAPI.refreshAccessToken(member.tokens.refresh_token);
      
      // Update member's token data
      member.tokens = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: tokenData.expires_at,
        expires_in: tokenData.expires_in,
        token_type: tokenData.token_type
      };
      member.lastTokenRefresh = new Date().toISOString();
      
      // Update in storage
      this.members.set(member.athlete.id.toString(), member);
      this.saveMembersAsync();
      
      const displayName = member.discordUser ? member.discordUser.displayName : `${member.athlete.firstname} ${member.athlete.lastname}`;
      logger.memberAction('TOKEN_REFRESHED', displayName, member.discordUserId, member.athlete.id, {
        newExpiresAt: tokenData.expires_at,
        refreshedAt: member.lastTokenRefresh
      });
      return tokenData.access_token;
      
    } catch (error) {
      const displayName = member.discordUser ? member.discordUser.displayName : member.athlete.firstname;
      logger.memberAction('TOKEN_FAILED', displayName, member.discordUserId, member.athlete.id, {
        error: error.message,
        timestamp: new Date().toISOString()
      });
      
      // If refresh fails, mark member as inactive
      member.isActive = false;
      member.tokenError = {
        message: error.message,
        timestamp: new Date().toISOString()
      };
      
      this.saveMembersAsync();
      return null;
    }
  }

  // Completely remove a member
  async removeMember(athleteId) {
    const member = this.members.get(athleteId.toString());
    if (member) {
      // Remove from Discord mapping
      if (member.discordUserId) {
        this.discordToStrava.delete(member.discordUserId);
      }
      
      // Remove from members map
      this.members.delete(athleteId.toString());
      
      this.saveMembersAsync();
      const displayName = member.discordUser ? member.discordUser.displayName : `${member.athlete.firstname} ${member.athlete.lastname}`;
      logger.memberAction('REMOVED', displayName, member.discordUserId, athleteId, {
        removedAt: new Date().toISOString()
      });
      return member;
    }
    return null;
  }

  // Remove member by Discord ID
  async removeMemberByDiscordId(discordUserId) {
    const athleteId = this.discordToStrava.get(discordUserId);
    if (athleteId) {
      return await this.removeMember(athleteId);
    }
    return null;
  }

  // Deactivate a member (soft delete)
  async deactivateMember(athleteId) {
    const member = this.members.get(athleteId.toString());
    if (member) {
      member.isActive = false;
      member.deactivatedAt = new Date().toISOString();
      
      // Remove from Discord mapping
      if (member.discordUserId) {
        this.discordToStrava.delete(member.discordUserId);
      }
      
      this.saveMembersAsync();
      const displayName = member.discordUser ? member.discordUser.displayName : `${member.athlete.firstname} ${member.athlete.lastname}`;
      logger.memberAction('DEACTIVATED', displayName, member.discordUserId, athleteId, {
        deactivatedAt: member.deactivatedAt
      });
      return true;
    }
    return false;
  }

  // Reactivate a member
  async reactivateMember(athleteId) {
    const member = this.members.get(athleteId.toString());
    if (member) {
      member.isActive = true;
      member.reactivatedAt = new Date().toISOString();
      delete member.deactivatedAt;
      delete member.tokenError;
      
      // Restore Discord mapping
      if (member.discordUserId) {
        this.discordToStrava.set(member.discordUserId, athleteId.toString());
      }
      
      this.saveMembersAsync();
      const displayName = member.discordUser ? member.discordUser.displayName : `${member.athlete.firstname} ${member.athlete.lastname}`;
      logger.memberAction('REACTIVATED', displayName, member.discordUserId, athleteId, {
        reactivatedAt: member.reactivatedAt
      });
      return true;
    }
    return false;
  }

  // Encrypt member data for storage
  encryptMemberData(member) {
    if (!config.security.encryptionKey) {
      return member; // Return unencrypted if no key
    }

    const algorithm = 'aes-256-gcm';
    const key = Buffer.from(config.security.encryptionKey, 'hex');
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    
    const sensitiveData = JSON.stringify(member.tokens);
    let encrypted = cipher.update(sensitiveData, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      ...member,
      tokens: {
        encrypted: encrypted,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex')
      }
    };
  }

  // Decrypt member data from storage
  decryptMemberData(encryptedMember) {
    if (!config.security.encryptionKey || !encryptedMember.tokens.encrypted) {
      return encryptedMember; // Return as-is if not encrypted
    }

    const algorithm = 'aes-256-gcm';
    const key = Buffer.from(config.security.encryptionKey, 'hex');
    const iv = Buffer.from(encryptedMember.tokens.iv, 'hex');
    const authTag = Buffer.from(encryptedMember.tokens.authTag, 'hex');
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedMember.tokens.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    const tokens = JSON.parse(decrypted);
    
    return {
      ...encryptedMember,
      tokens: tokens
    };
  }

  // Get member statistics
  getStats() {
    const members = Array.from(this.members.values());
    const activeMembers = members.filter(m => m.isActive);
    const inactiveMembers = members.filter(m => !m.isActive);
    
    return {
      total: members.length,
      active: activeMembers.length,
      inactive: inactiveMembers.length,
      recentRegistrations: members.filter(m => {
        const registeredAt = new Date(m.registeredAt);
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        return registeredAt > weekAgo;
      }).length
    };
  }

  // Toggle canViewPrivateActivity for a member by Discord user ID
  async togglePrivateActivity(discordUserId) {
    const athleteId = this.discordToStrava.get(discordUserId);
    if (!athleteId) return null;
    const member = this.members.get(athleteId);
    if (!member) return null;
    member.canViewPrivateActivity = !member.canViewPrivateActivity;
    this.saveMembersAsync();
    return member.canViewPrivateActivity;
  }
}

module.exports = MemberManager;