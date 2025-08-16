const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const config = require('../../config/config');
const StravaAPI = require('../strava/api');

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
        this.members.set(decryptedMember.athlete.id.toString(), decryptedMember);
        
        if (decryptedMember.discordUserId) {
          this.discordToStrava.set(decryptedMember.discordUserId, decryptedMember.athlete.id.toString());
        }
      }
      
      console.log(`✅ Loaded ${this.members.size} members from storage`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('📁 No existing member data found, starting fresh');
        await this.ensureDataDirectory();
      } else {
        console.error('❌ Error loading members:', error);
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
      console.log(`✅ Saved ${this.members.size} members to storage`);
    } catch (error) {
      console.error('❌ Error saving members:', error);
    }
  }

  // Save members asynchronously without blocking
  saveMembersAsync() {
    // Use setTimeout to make it truly async and non-blocking
    setTimeout(() => {
      this.saveMembers().catch(error => {
        console.error('❌ Error in async save:', error);
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
  async registerMember(discordUserId, athlete, tokenData) {
    const athleteId = athlete.id.toString();
    
    const member = {
      discordUserId: discordUserId,
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
      registeredAt: new Date().toISOString(),
      lastTokenRefresh: new Date().toISOString(),
      isActive: true
    };

    this.members.set(athleteId, member);
    this.discordToStrava.set(discordUserId, athleteId);
    
    // Save asynchronously without blocking
    this.saveMembersAsync();
    
    console.log(`✅ Registered member: ${athlete.firstname} ${athlete.lastname} (Discord: ${discordUserId})`);
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
    console.log(`🔄 Token expired for ${member.athlete.firstname}, refreshing...`);
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
      
      console.log(`✅ Token refreshed for ${member.athlete.firstname} ${member.athlete.lastname}`);
      return tokenData.access_token;
      
    } catch (error) {
      console.error(`❌ Failed to refresh token for ${member.athlete.firstname}:`, error);
      
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
      console.log(`🗑️ Removed member: ${member.athlete.firstname} ${member.athlete.lastname}`);
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
      console.log(`🔴 Deactivated member: ${member.athlete.firstname} ${member.athlete.lastname}`);
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
      console.log(`🟢 Reactivated member: ${member.athlete.firstname} ${member.athlete.lastname}`);
      return true;
    }
    return false;
  }

  // Encrypt member data for storage
  encryptMemberData(member) {
    if (!config.security.encryptionKey) {
      return member; // Return unencrypted if no key
    }

    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(config.security.encryptionKey, 'hex');
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    
    const sensitiveData = JSON.stringify(member.tokens);
    let encrypted = cipher.update(sensitiveData, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return {
      ...member,
      tokens: {
        encrypted: encrypted,
        iv: iv.toString('hex')
      }
    };
  }

  // Decrypt member data from storage
  decryptMemberData(encryptedMember) {
    if (!config.security.encryptionKey || !encryptedMember.tokens.encrypted) {
      return encryptedMember; // Return as-is if not encrypted
    }

    const algorithm = 'aes-256-cbc';
    const key = Buffer.from(config.security.encryptionKey, 'hex');
    const iv = Buffer.from(encryptedMember.tokens.iv, 'hex');
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    
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
}

module.exports = MemberManager;