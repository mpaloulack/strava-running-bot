const fs = require('node:fs').promises;
const path = require('node:path');
const { eq, ne, and, desc, asc, gte, lte, lt, inArray, sql, like } = require('drizzle-orm');
const dbConnection = require('./connection');
const { members, races, migrationLog, settings, personalBests, activities } = require('./schema');
const logger = require('../utils/Logger');
const config = require('../../config/config');
const SettingsManager = require('../managers/SettingsManager');
const EncryptionUtils = require('../utils/EncryptionUtils');
const { TIME } = require('../constants');
const DateUtils = require('../utils/DateUtils');
const { normalizeTokenBlob } = require('./tokenBlob');

class DatabaseManager {
  db = null;
  isInitialized = false;
  oldDataPath = path.join(__dirname, '../../data/members.json');
  settingsManager = null;

  async initialize() {
    if (this.isInitialized) return;

    try {
      this.db = await dbConnection.initialize();
      
      // Check if migration from JSON is needed
      await this.checkAndMigrateFromJson();
      
      // Initialize settings (create default settings if they don't exist)
      await this.initializeSettings();
      
      // Initialize settings manager
      this.settingsManager = new SettingsManager(this.db);
      
      this.isInitialized = true;
      logger.database?.info('DatabaseManager initialized successfully');
      
    } catch (error) {
      logger.database?.error('Failed to initialize DatabaseManager', error);
      throw error;
    }
  }

  // === MIGRATION FROM JSON ===
  async checkAndMigrateFromJson() {
    try {
      // Check if migration already completed
      const migrationExists = await this.db.select()
        .from(migrationLog)
        .where(eq(migrationLog.migration_name, 'json_to_sqlite_migration'))
        .get();

      if (migrationExists?.success) {
        logger.database?.info('JSON migration already completed, skipping');
        return;
      }

      // Check if old JSON file exists
      try {
        await fs.access(this.oldDataPath);
      } catch {
        logger.database?.info('No JSON data file found, starting fresh');
        return;
      }

      logger.database?.info('Starting migration from JSON to SQLite');
      await this.migrateFromJson();
      
    } catch (error) {
      logger.database?.error('Error checking JSON migration status', error);
      throw error;
    }
  }

  async migrateFromJson() {
    try {
      // Check if old JSON file exists
      try {
        await fs.access(this.oldDataPath);
      } catch {
        logger.database?.info('No JSON data file found, starting fresh');
        return;
      }

      // Read and parse JSON data
      const jsonData = await fs.readFile(this.oldDataPath, 'utf8');
      const memberData = JSON.parse(jsonData);
      
      // Create backup
      const backupData = JSON.stringify(memberData);
      
      logger.database?.info('Migrating members from JSON', { count: memberData.members?.length || 0 });
      
      let migratedCount = 0;
      let errorCount = 0;
      const errors = [];

      // Migrate each member
      for (const member of memberData.members || []) {
        try {
          await this.migrateSingleMember(member);
          migratedCount++;
        } catch (error) {
          errorCount++;
          errors.push({
            athleteId: member.athlete?.id,
            discordId: member.discordUserId,
            error: error.message
          });
          logger.database?.warn('Failed to migrate member', {
            athleteId: member.athlete?.id,
            error: error.message
          });
        }
      }

      // Log migration result
      await this.db.insert(migrationLog).values({
        migration_name: 'json_to_sqlite_migration',
        success: true,
        data_backup: backupData,
      });

      // Create backup of JSON file
      const backupPath = `${this.oldDataPath}.backup.${Date.now()}`;
      await fs.copyFile(this.oldDataPath, backupPath);

      logger.database?.info('JSON migration completed', {
        migrated: migratedCount,
        errors: errorCount,
        backupPath,
        failedMembers: errors
      });

      return { migrated: migratedCount, errors: errorCount };
      
    } catch (error) {
      // Log failed migration
      await this.db.insert(migrationLog).values({
        migration_name: 'json_to_sqlite_migration',
        success: false,
        error_message: error.message,
      });
      throw error;
    }
  }

  async migrateSingleMember(member) {
    // Validate required fields
    if (!member.athlete?.id || !member.discordUserId) {
      throw new Error('Missing required member data');
    }

    // Insert into database with complete member data including Discord info and tokens
    await this.db.insert(members).values({
      athlete_id: Number.parseInt(member.athlete.id),
      discord_id: member.discordUserId,
      discord_user_id: member.discordUserId, // New field for consistency
      athlete: JSON.stringify(member.athlete), // Store as JSON string
      is_active: member.isActive ? 1 : 0,
      created_at: member.registeredAt || new Date().toISOString(),
      updated_at: member.lastTokenRefresh || new Date().toISOString(),
      registered_at: member.registeredAt || new Date().toISOString(),
      
      // Discord user information
      discord_username: member.discordUser?.username || null,
      discord_display_name: member.discordUser?.displayName || null,
      discord_discriminator: member.discordUser?.discriminator || '0',
      discord_avatar: member.discordUser?.avatar || null,
      
      // Encrypted token data (store complete encrypted structure as JSON)
      encrypted_tokens: member.tokens ? JSON.stringify(member.tokens) : null,
    });
  }

  // === SETTINGS INITIALIZATION ===
  async initializeSettings() {
    try {
      // Check if default settings exist, if not create them
      const defaultSettings = [
        {
          key: 'discord_channel_id',
          value: process.env.DISCORD_CHANNEL_ID || '',
          description: 'Discord channel ID for posting activities and announcements'
        }
      ];

      for (const setting of defaultSettings) {
        // Check if setting already exists
        const existing = await this.db.select().from(settings).where(eq(settings.key, setting.key)).limit(1);
        
        if (existing.length === 0) {
          // Insert default setting
          await this.db.insert(settings).values({
            key: setting.key,
            value: setting.value,
            description: setting.description,
            updated_at: new Date().toISOString()
          });
          
          logger.database?.info('Default setting created', { key: setting.key });
        }
      }
      
      logger.database?.info('Settings initialization completed');
    } catch (error) {
      logger.database?.warn('Failed to initialize settings', { error: error.message });
    }
  }

  // === MEMBER MANAGEMENT ===
  async registerMember(discordUserId, athlete, tokenData, discordUser = null, provider = 'strava') {
    await this.ensureInitialized();

    const athleteId = Number.parseInt(athlete.id);

    // DEBUG: Log what discordUser contains
    logger.database.info('Registering member with Discord info', {
      discordUserId,
      hasDiscordUser: !!discordUser,
      discordUsername: discordUser?.username,
      discordGlobalName: discordUser?.globalName,
      discordDisplayName: discordUser?.displayName,
      discordDiscriminator: discordUser?.discriminator,
      discordUserKeys: discordUser ? Object.keys(discordUser) : []
    });

    // Check for existing registrations
    const existingByDiscord = await this.getMemberByDiscordId(discordUserId);
    if (existingByDiscord) {
      throw new Error(`Discord user ${discordUserId} is already registered`);
    }

    const existingByAthlete = await this.getMemberByAthleteId(athleteId);
    if (existingByAthlete?.isActive) {
      throw new Error(`Athlete ${athleteId} is already registered and active`);
    }

    // Encrypt tokens if encryption key is available. Tokens are namespaced by
    // provider inside the blob ({ strava?: {...}, intervals?: {...} }) so a
    // later provider switch can preserve this provider's credentials for an
    // instant switch-back — see relinkMember/updateTokens.
    let encryptedTokens = null;
    if (tokenData && config.security.encryptionKey) {
      try {
        encryptedTokens = EncryptionUtils.encryptTokensToJSON({ [provider]: tokenData });

        logger.database.info('Tokens encrypted successfully for new member', {
          athleteId,
          hasRefreshToken: !!tokenData.refresh_token,
          expiresAt: tokenData.expires_at ? new Date(tokenData.expires_at * 1000).toISOString() : 'unknown'
        });
      } catch (error) {
        logger.database.error('Failed to encrypt tokens during registration', {
          athleteId,
          error: error.message
        });
        throw error;
      }
    } else {
      logger.database.warn('Tokens not encrypted - missing encryption key or tokenData', {
        athleteId,
        hasTokenData: !!tokenData,
        hasEncryptionKey: !!config.security.encryptionKey
      });
    }

    // Prepare member data with Discord user information
    const memberData = {
      athlete_id: athleteId,
      discord_id: discordUserId,
      athlete: JSON.stringify(athlete), // Store as JSON string
      is_active: 1,
      provider,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // Save Discord user information for proper name display
      discord_username: discordUser?.username || null,
      discord_display_name: discordUser?.globalName || discordUser?.displayName || null,
      discord_discriminator: discordUser?.discriminator || '0',
      discord_avatar: discordUser?.avatar || null,
      // Save encrypted tokens
      encrypted_tokens: encryptedTokens,
    };

    // Insert new member
    await this.db.insert(members).values(memberData);

    // Get the inserted member
    const newMember = await this.getMemberByAthleteId(athleteId);

    logger.memberAction('REGISTERED', `${athlete.firstname} ${athlete.lastname}`, discordUserId, athleteId, {
      registeredAt: newMember.registeredAt,
      discordUsername: memberData.discord_username,
      discordDisplayName: memberData.discord_display_name
    });

    return newMember;
  }

  // Re-link an existing member to a fresh OAuth/API-key grant (new tokens, refreshed
  // athlete/Discord info, optionally a new provider) without touching is_active. Used
  // when a member's stored tokens have become unusable (e.g. ENCRYPTION_KEY rotation,
  // access revoked) so they can recover via /register instead of being stuck as
  // "already registered", and also when a member explicitly switches provider
  // (e.g. Strava -> intervals.icu) via /register.
  //
  // athlete_id is the identity anchor for races/personal_bests/activities, and it's
  // how Strava webhooks route (getMemberByAthleteId(owner_id)). A provider switch
  // brings a different canonical id (e.g. a Strava numeric id vs. an intervals.icu
  // numeric id) — if we left the old athlete_id in place, a later switch back to
  // Strava would leave webhook events unroutable. So when the incoming athlete's id
  // differs from the stored one, we renumber the member row and every child row
  // (races, personal_bests, activities) inside one transaction.
  //
  // All three child FKs are ON UPDATE CASCADE (migration 007 brought races and
  // personal_bests in line with what schema.js had always declared), so SQLite
  // moves the child rows itself and the explicit updates below are belt-and-
  // braces for a database that predates that migration. defer_foreign_keys is
  // the same kind of guard: it holds FK checks until COMMIT so the renumbering
  // is judged as a whole rather than statement by statement, which is what a
  // NO ACTION constraint on any future child table would otherwise trip over.
  // It is scoped to this transaction and clears itself on commit, so normal
  // enforcement resumes immediately afterwards.
  async relinkMember(athleteId, athlete, tokenData, discordUser = null, provider = 'strava') {
    await this.ensureInitialized();

    const oldAthleteId = Number.parseInt(athleteId);

    // Preserve the member's OTHER provider's credentials across a switch: decrypt
    // the member's current blob (if any) outside the sync transaction below,
    // normalize it to the namespaced shape, and merge the incoming tokenData in
    // under this provider's key. This is what lets a member switch back to a
    // provider they used before without needing to re-authenticate.
    let existingNamespaces = {};
    if (config.security.encryptionKey) {
      try {
        const currentMember = await this.getMemberByAthleteId(oldAthleteId);
        if (currentMember?.tokens) {
          existingNamespaces = normalizeTokenBlob(EncryptionUtils.decryptTokens(currentMember.tokens));
        }
      } catch (error) {
        logger.database.warn('Could not decrypt existing tokens during relink - not preserving them', {
          athleteId: oldAthleteId,
          error: error.message
        });
      }
    }

    let encryptedTokens = null;
    if (tokenData && config.security.encryptionKey) {
      try {
        encryptedTokens = EncryptionUtils.encryptTokensToJSON({ ...existingNamespaces, [provider]: tokenData });
      } catch (error) {
        logger.database.error('Failed to encrypt tokens during relink', {
          athleteId,
          error: error.message
        });
        throw error;
      }
    }

    const newAthleteId = Number.parseInt(athlete.id);
    const idChanged = Number.isFinite(newAthleteId) && newAthleteId !== oldAthleteId;

    const discordFields = {
      discord_username: discordUser?.username || null,
      discord_display_name: discordUser?.globalName || discordUser?.displayName || null,
      discord_discriminator: discordUser?.discriminator || '0',
      discord_avatar: discordUser?.avatar || null,
    };

    if (idChanged) {
      const conflictingMember = await this.getMemberByAthleteId(newAthleteId);
      if (conflictingMember) {
        throw new Error(`Cannot relink: athlete id ${newAthleteId} is already registered to a different member`);
      }

      // Transaction must be synchronous for better-sqlite3. Note drizzle's
      // transaction() runs the callback immediately and returns its result -
      // unlike raw better-sqlite3, it does NOT hand back a callable to invoke
      // afterwards.
      this.db.transaction((tx) => {
        dbConnection.getRawDb().pragma('defer_foreign_keys = ON');

        tx.update(members)
          .set({
            athlete_id: newAthleteId,
            athlete: JSON.stringify(athlete),
            provider,
            ...discordFields,
            encrypted_tokens: encryptedTokens,
            updated_at: new Date().toISOString()
          })
          .where(eq(members.athlete_id, oldAthleteId))
          .run();

        tx.update(races)
          .set({ member_athlete_id: newAthleteId })
          .where(eq(races.member_athlete_id, oldAthleteId))
          .run();

        tx.update(personalBests)
          .set({ member_athlete_id: newAthleteId })
          .where(eq(personalBests.member_athlete_id, oldAthleteId))
          .run();

        tx.update(activities)
          .set({ member_athlete_id: newAthleteId })
          .where(eq(activities.member_athlete_id, oldAthleteId))
          .run();
      });
    } else {
      await this.db.update(members)
        .set({
          athlete: JSON.stringify(athlete),
          provider,
          ...discordFields,
          encrypted_tokens: encryptedTokens,
          updated_at: new Date().toISOString()
        })
        .where(eq(members.athlete_id, athleteId));
    }

    const finalAthleteId = idChanged ? newAthleteId : athleteId;
    const updatedMember = await this.getMemberByAthleteId(finalAthleteId);

    logger.memberAction('RELINKED', `${athlete.firstname} ${athlete.lastname}`, updatedMember.discordUserId, finalAthleteId, {
      relinkedAt: updatedMember.lastTokenRefresh,
      ...(idChanged ? { previousAthleteId: oldAthleteId } : {})
    });

    return updatedMember;
  }

  async getMemberByAthleteId(athleteId) {
    await this.ensureInitialized();
    
    const member = await this.db.select()
      .from(members)
      .where(eq(members.athlete_id, Number.parseInt(athleteId)))
      .get();

    return member ? this.decryptMember(member) : null;
  }

  async getMemberByDiscordId(discordUserId) {
    await this.ensureInitialized();
    
    const member = await this.db.select()
      .from(members)
      .where(eq(members.discord_id, discordUserId))
      .get();

    return member ? this.decryptMember(member) : null;
  }

  async getAllMembers() {
    await this.ensureInitialized();

    const memberList = await this.db.select()
      .from(members)
      .where(eq(members.is_active, 1))
      .orderBy(asc(members.created_at));

    return memberList.map(member => this.decryptMember(member));
  }

  async getAllMembersIncludingInactive() {
    await this.ensureInitialized();

    const memberList = await this.db.select()
      .from(members)
      .orderBy(asc(members.created_at));

    return memberList.map(member => this.decryptMember(member));
  }

  async getInactiveMembers() {
    await this.ensureInitialized();

    const memberList = await this.db.select()
      .from(members)
      .where(eq(members.is_active, 0))
      .orderBy(asc(members.created_at));

    return memberList.map(member => this.decryptMember(member));
  }

  async deactivateMember(athleteId) {
    await this.ensureInitialized();

    const result = await this.db.update(members)
      .set({ 
        is_active: 0,
        updated_at: new Date().toISOString()
      })
      .where(eq(members.athlete_id, Number.parseInt(athleteId)))
      .returning();

    if (result.length > 0) {
      logger.memberAction('DEACTIVATED', '', '', athleteId, {
        deactivatedAt: result[0].updated_at
      });
    }

    return result.length > 0;
  }

  async reactivateMember(athleteId) {
    await this.ensureInitialized();

    const result = await this.db.update(members)
      .set({ 
        is_active: 1,
        updated_at: new Date().toISOString()
      })
      .where(eq(members.athlete_id, Number.parseInt(athleteId)))
      .returning();

    if (result.length > 0) {
      logger.memberAction('REACTIVATED', '', '', athleteId, {
        reactivatedAt: result[0].updated_at
      });
    }

    return result.length > 0;
  }

  async removeMember(athleteId) {
    await this.ensureInitialized();

    // Get member before deletion for logging (OUTSIDE transaction)
    const member = await this.getMemberByAthleteId(athleteId);

    if (!member) return null;

    // Transaction must be synchronous for better-sqlite3. As in relinkMember,
    // drizzle's transaction() runs the callback immediately and returns its
    // result - there is no callable handed back to invoke afterwards.
    return this.db.transaction((tx) => {
      // Delete associated races first (cascade should handle this, but being explicit)
      tx.delete(races)
        .where(eq(races.member_athlete_id, Number.parseInt(athleteId)))
        .run();

      // Delete member
      tx.delete(members)
        .where(eq(members.athlete_id, Number.parseInt(athleteId)))
        .run();

      logger.memberAction('REMOVED', member.athlete?.firstname || '', member.discordId, athleteId, {
        removedAt: new Date().toISOString()
      });

      return member;
    });
  }

  async updateTokens(athleteId, tokenData, provider = 'strava') {
    await this.ensureInitialized();

    if (!tokenData) {
      logger.database.warn('updateTokens called with no tokenData', { athleteId });
      return null;
    }

    // Preserve any OTHER provider's credentials already stored for this member
    // (e.g. a Strava token refresh must not wipe out saved intervals.icu
    // credentials from a prior provider switch, and vice versa).
    let existingNamespaces = {};
    if (config.security.encryptionKey) {
      try {
        const currentMember = await this.getMemberByAthleteId(athleteId);
        if (currentMember?.tokens) {
          existingNamespaces = normalizeTokenBlob(EncryptionUtils.decryptTokens(currentMember.tokens));
        }
      } catch (error) {
        logger.database.warn('Could not decrypt existing tokens during token update - other provider credentials may be lost', {
          athleteId,
          error: error.message
        });
      }
    }

    // Encrypt the new tokens, merged into the namespaced blob under this provider's key
    let encryptedTokens;
    if (config.security.encryptionKey) {
      try {
        encryptedTokens = EncryptionUtils.encryptTokensToJSON({ ...existingNamespaces, [provider]: tokenData });

        logger.database.info('Tokens encrypted successfully for token update', {
          athleteId,
          provider,
          hasRefreshToken: !!tokenData.refresh_token,
          expiresAt: tokenData.expires_at ? new Date(tokenData.expires_at * 1000).toISOString() : 'unknown'
        });
      } catch (error) {
        logger.database.error('Failed to encrypt tokens during update', {
          athleteId,
          error: error.message
        });
        throw error;
      }
    } else {
      logger.database.error('Cannot update tokens - no encryption key available', { athleteId });
      throw new Error('Encryption key not available');
    }

    // Update the member's tokens and timestamp
    const result = await this.db.update(members)
      .set({
        encrypted_tokens: encryptedTokens,
        updated_at: new Date().toISOString()
      })
      .where(eq(members.athlete_id, Number.parseInt(athleteId)))
      .returning();

    if (result && result.length > 0) {
      logger.database.info('Tokens updated successfully in database', {
        athleteId,
        expiresAt: tokenData.expires_at ? new Date(tokenData.expires_at * 1000).toISOString() : 'unknown'
      });
      return result[0];
    }

    return null;
  }

  // Remove one provider's namespace from a member's token blob, leaving any
  // other provider's credentials untouched. Mirrors updateTokens's merge
  // logic, inverted: decrypt the current blob, delete the target namespace,
  // and re-encrypt whatever remains (or null out the column if nothing does).
  // Used by ActivityProcessor.revokeStravaAccess to clear a member's Strava
  // credentials once they've been revoked at Strava, so no dead credentials
  // linger and the athlete seat reads as free.
  async clearProviderTokens(athleteId, provider) {
    await this.ensureInitialized();

    let existingNamespaces = {};
    if (config.security.encryptionKey) {
      try {
        const currentMember = await this.getMemberByAthleteId(athleteId);
        if (currentMember?.tokens) {
          existingNamespaces = normalizeTokenBlob(EncryptionUtils.decryptTokens(currentMember.tokens));
        }
      } catch (error) {
        logger.database.warn('Could not decrypt existing tokens while clearing provider tokens', {
          athleteId,
          provider,
          error: error.message
        });
      }
    }

    if (!(provider in existingNamespaces)) {
      // Nothing stored for this provider already - no-op.
      return null;
    }

    const remaining = { ...existingNamespaces };
    delete remaining[provider];
    const remainingProviders = Object.keys(remaining);

    let encryptedTokens = null;
    if (remainingProviders.length > 0) {
      try {
        encryptedTokens = EncryptionUtils.encryptTokensToJSON(remaining);
      } catch (error) {
        logger.database.error('Failed to encrypt tokens while clearing provider tokens', {
          athleteId,
          provider,
          error: error.message
        });
        throw error;
      }
    }

    const result = await this.db.update(members)
      .set({
        encrypted_tokens: encryptedTokens,
        updated_at: new Date().toISOString()
      })
      .where(eq(members.athlete_id, Number.parseInt(athleteId)))
      .returning();

    if (result && result.length > 0) {
      logger.database.info('Cleared provider tokens', {
        athleteId,
        provider,
        remainingProviders
      });
      return result[0];
    }

    return null;
  }

  // === RACE MANAGEMENT ===
  async addRace(memberAthleteId, raceData) {
    await this.ensureInitialized();

    // Validate member exists
    const member = await this.getMemberByAthleteId(memberAthleteId);
    if (!member || !member.isActive) {
      throw new Error('Member not found or inactive');
    }

    const race = await this.db.insert(races).values({
      member_athlete_id: Number.parseInt(memberAthleteId),
      name: raceData.name,
      race_date: raceData.raceDate,
      race_type: raceData.raceType || 'road',
      distance: raceData.distance || null,
      distance_km: raceData.distanceKm || null,
      location: raceData.location || null,
      status: raceData.status || 'registered',
      notes: raceData.notes || null,
      goal_time: raceData.goalTime || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).returning();

    logger.database?.info('Race added', {
      raceId: race[0]?.id,
      athleteId: memberAthleteId,
      raceName: raceData.name,
      raceDate: raceData.raceDate,
      raceType: raceData.raceType || 'road'
    });

    return race[0];
  }

  async updateRace(raceId, updates) {
    await this.ensureInitialized();

    const result = await this.db.update(races)
      .set({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .where(eq(races.id, Number.parseInt(raceId)))
      .returning();

    return result[0] || null;
  }

  async removeRace(raceId) {
    await this.ensureInitialized();

    const race = await this.db.select()
      .from(races)
      .where(eq(races.id, Number.parseInt(raceId)))
      .get();

    if (!race) return null;

    await this.db.delete(races)
      .where(eq(races.id, Number.parseInt(raceId)));

    logger.database?.info('Race removed', {
      raceId,
      athleteId: race.memberAthleteId,
      raceName: race.name
    });

    return race;
  }

  async getMemberRaces(athleteId, options = {}) {
    await this.ensureInitialized();

    let query = this.db.select()
      .from(races)
      .where(eq(races.member_athlete_id, Number.parseInt(athleteId)));

    // Add status filter
    if (options.status) {
      query = query.where(and(
        eq(races.member_athlete_id, Number.parseInt(athleteId)),
        eq(races.status, options.status)
      ));
    }

    // Add date filters
    if (options.fromDate) {
      query = query.where(and(
        eq(races.member_athlete_id, Number.parseInt(athleteId)),
        gte(races.race_date, options.fromDate)
      ));
    }

    if (options.toDate) {
      query = query.where(and(
        eq(races.member_athlete_id, Number.parseInt(athleteId)),
        lte(races.race_date, options.toDate)
      ));
    }

    // Order by race date
    query = query.orderBy(asc(races.race_date));

    return await query;
  }

  async getUpcomingRaces(daysAhead = 30) {
    await this.ensureInitialized();

    const today = DateUtils.getTodayDateString();
    const futureDate = DateUtils.formatDateOnly(new Date(Date.now() + daysAhead * TIME.MS_PER_DAY));

    return await this.db.select()
      .from(races)
      .where(and(
        gte(races.race_date, today),
        lte(races.race_date, futureDate),
        eq(races.status, 'registered')
      ))
      .orderBy(asc(races.race_date));
  }

  async getAllRaces(options = {}) {
    await this.ensureInitialized();

    let query = this.db.select().from(races);

    if (options.status) {
      query = query.where(eq(races.status, options.status));
    }

    return await query.orderBy(desc(races.race_date));
  }

  async getRacesByDateRange(startDate, endDate, options = {}) {
    await this.ensureInitialized();

    let query = this.db.select()
      .from(races)
      .where(and(
        gte(races.race_date, startDate),
        lte(races.race_date, endDate)
      ));

    // Add status filter
    if (options.status) {
      query = query.where(and(
        gte(races.race_date, startDate),
        lte(races.race_date, endDate),
        eq(races.status, options.status)
      ));
    }

    // Order by race date
    return await query.orderBy(asc(races.race_date));
  }

  // === PERSONAL BEST MANAGEMENT ===
  // Atomic upsert: inserts a new PB row, or updates the existing row only when
  // the incoming elapsed_time beats the stored one. The conditional
  // ON CONFLICT ... WHERE clause is evaluated inside SQLite so two concurrent
  // callers cannot both "win" the same (athlete, category) slot.
  async upsertPersonalBest(athleteId, pbData) {
    await this.ensureInitialized();

    const memberId = Number.parseInt(athleteId);
    const now = new Date().toISOString();
    const activityId = String(pbData.activityId ?? pbData.stravaActivityId);

    await this.db.insert(personalBests).values({
      member_athlete_id: memberId,
      category: pbData.category,
      distance_m: pbData.distanceM,
      elapsed_time: pbData.elapsedTime,
      moving_time: pbData.movingTime,
      strava_activity_id: activityId,
      activity_name: pbData.activityName || null,
      activity_date: pbData.activityDate,
      created_at: now,
      updated_at: now,
    }).onConflictDoUpdate({
      target: [personalBests.member_athlete_id, personalBests.category],
      set: {
        distance_m: pbData.distanceM,
        elapsed_time: pbData.elapsedTime,
        moving_time: pbData.movingTime,
        strava_activity_id: activityId,
        activity_name: pbData.activityName || null,
        activity_date: pbData.activityDate,
        updated_at: now,
      },
      setWhere: sql`${personalBests.elapsed_time} > ${pbData.elapsedTime}`,
    });

    return await this.getPersonalBest(athleteId, pbData.category);
  }

  async getPersonalBestsByAthleteId(athleteId) {
    await this.ensureInitialized();

    return await this.db.select()
      .from(personalBests)
      .where(eq(personalBests.member_athlete_id, Number.parseInt(athleteId)))
      .orderBy(asc(personalBests.distance_m));
  }

  async getPersonalBest(athleteId, category) {
    await this.ensureInitialized();

    return await this.db.select()
      .from(personalBests)
      .where(
        and(
          eq(personalBests.member_athlete_id, Number.parseInt(athleteId)),
          eq(personalBests.category, category)
        )
      )
      .get() || null;
  }

  async getPBSyncCursors() {
    await this.ensureInitialized();
    try {
      const rows = await this.db.select()
        .from(settings)
        .where(like(settings.key, 'pb_sync_cursor_%'));
      return rows.map(row => ({
        discordUserId: row.key.replace('pb_sync_cursor_', ''),
        cursor: row.value,
        updatedAt: row.updated_at,
      }));
    } catch (error) {
      logger.database.error('Failed to query PB sync cursors', { error: error.message });
      return [];
    }
  }

  async getPBCountByAthleteId(athleteId) {
    await this.ensureInitialized();
    try {
      const result = await this.db.select({ count: sql`count(*)` })
        .from(personalBests)
        .where(eq(personalBests.member_athlete_id, Number.parseInt(athleteId)));
      return Number(result[0]?.count ?? 0);
    } catch (error) {
      logger.database.error('Failed to get PB count', { athleteId, error: error.message });
      return 0;
    }
  }

  // === ACTIVITY MANAGEMENT ===
  // `posted` records whether this activity was actually broadcast to Discord.
  // Defaults to true so existing callers keep their meaning; the filtered paths
  // pass false, which is what lets the intervals.icu poll reconsider an
  // activity that only later became postable.
  async upsertActivity(athleteId, activity, provider = 'strava', { posted = true } = {}) {
    await this.ensureInitialized();

    const record = {
      strava_activity_id: String(activity.id),
      member_athlete_id: Number.parseInt(athleteId),
      provider,
      name: activity.name || null,
      type: activity.type || null,
      sport_type: activity.sport_type || null,
      distance: activity.distance ?? null,
      moving_time: activity.moving_time ?? null,
      elapsed_time: activity.elapsed_time ?? null,
      total_elevation_gain: activity.total_elevation_gain ?? null,
      average_speed: activity.average_speed ?? null,
      max_speed: activity.max_speed ?? null,
      average_heartrate: activity.average_heartrate ?? null,
      max_heartrate: activity.max_heartrate ?? null,
      start_date: activity.start_date || null,
      start_date_local: activity.start_date_local || null,
      timezone: activity.timezone || null,
      map_summary_polyline: activity.map?.summary_polyline || null,
      has_heartrate: activity.has_heartrate ? 1 : 0,
      pr_categories: activity.pr_categories ?? null,
      posted: posted ? 1 : 0,
      updated_at: new Date().toISOString(),
    };

    await this.db
      .insert(activities)
      .values(record)
      .onConflictDoUpdate({
        target: activities.strava_activity_id,
        set: record,
      });
  }

  async getActivityById(activityId) {
    await this.ensureInitialized();

    return await this.db.select()
      .from(activities)
      .where(eq(activities.strava_activity_id, String(activityId)))
      .get() || null;
  }

  // Find an existing activities row for this member representing the SAME
  // physical run under a DIFFERENT id — used to catch cross-provider
  // duplicates after a member switches provider (e.g. a run synced once via
  // Strava's webhook and again via the intervals.icu poll, or vice versa, so
  // one physical run doesn't count twice toward the leaderboard).
  //
  // Strava's start_date_local carries a misleading trailing 'Z' even though
  // it's actually local wall-clock time; intervals.icu's carries none.
  // Stripping the 'Z' from both sides before comparing lets the two
  // representations of the same run line up.
  async findDuplicateActivity(athleteId, startDateLocal, excludeActivityId, provider = null) {
    await this.ensureInitialized();

    if (!startDateLocal) return null;

    const target = new Date(startDateLocal.replace(/Z$/, ''));
    if (Number.isNaN(target.getTime())) return null;

    // Coarse ±1-day lexicographic pre-filter in SQL, refined below in JS with
    // an exact (Z-stripped) timestamp comparison.
    const rangeStart = new Date(target.getTime() - TIME.MS_PER_DAY).toISOString();
    const rangeEnd = new Date(target.getTime() + TIME.MS_PER_DAY).toISOString();
    const excludeId = String(excludeActivityId);

    // When a provider is supplied, only rows from a DIFFERENT provider count
    // as a duplicate — this is a cross-provider dedup check, so two
    // legitimate same-provider activities that happen to start close
    // together must never falsely match each other.
    const conditions = [
      eq(activities.member_athlete_id, Number.parseInt(athleteId)),
      sql`${activities.strava_activity_id} != ${excludeId}`,
      gte(activities.start_date_local, rangeStart),
      lte(activities.start_date_local, rangeEnd)
    ];
    if (provider !== null) {
      conditions.push(ne(activities.provider, provider));
    }

    const candidates = await this.db.select()
      .from(activities)
      .where(and(...conditions));

    const TEN_MINUTES_MS = 10 * TIME.MS_PER_MINUTE;

    for (const candidate of candidates) {
      if (!candidate.start_date_local) continue;
      const candidateTime = new Date(candidate.start_date_local.replace(/Z$/, ''));
      if (Number.isNaN(candidateTime.getTime())) continue;
      if (Math.abs(candidateTime.getTime() - target.getTime()) <= TEN_MINUTES_MS) {
        return candidate;
      }
    }

    return null;
  }

  // Aggregate run distance per active member for a date window.
  // Date strings are compared lexicographically against `start_date_local`
  // (ISO 8601) — local-day boundaries match what the runner expects ("did
  // that 11pm run on March 31 count for March?").
  async getMonthlyRunTotals(startDateISO, endDateISO, runTypes) {
    await this.ensureInitialized();

    return await this.db.select({
      athleteId: activities.member_athlete_id,
      totalDistanceM: sql`SUM(${activities.distance})`.as('totalDistanceM'),
      activityCount: sql`COUNT(*)`.as('activityCount'),
    })
      .from(activities)
      .innerJoin(members, eq(members.athlete_id, activities.member_athlete_id))
      .where(and(
        inArray(activities.type, runTypes),
        gte(activities.start_date_local, startDateISO),
        lt(activities.start_date_local, endDateISO),
        eq(members.is_active, 1),
        sql`${activities.distance} > 0`
      ))
      .groupBy(activities.member_athlete_id)
      .orderBy(desc(sql`totalDistanceM`));
  }

  // === UTILITY METHODS ===
  async getStats() {
    await this.ensureInitialized();

    // Get member stats with simplified queries
    const totalMembers = await this.db.select({ count: sql`count(*)` }).from(members);
    const activeMembers = await this.db.select({ count: sql`count(*)` }).from(members).where(eq(members.is_active, 1));
    const inactiveMembers = await this.db.select({ count: sql`count(*)` }).from(members).where(eq(members.is_active, 0));

    // Get race stats with simplified queries  
    const totalRaces = await this.db.select({ count: sql`count(*)` }).from(races);
    const upcomingRaces = await this.db.select({ count: sql`count(*)` }).from(races)
      .where(and(
        gte(races.race_date, DateUtils.getTodayDateString()),
        eq(races.status, 'registered')
      ));

    return {
      members: {
        total: totalMembers[0]?.count || 0,
        active: activeMembers[0]?.count || 0,
        inactive: inactiveMembers[0]?.count || 0
      },
      races: {
        total: totalRaces[0]?.count || 0,
        upcoming: upcomingRaces[0]?.count || 0
      }
    };
  }

  // === ENCRYPTION/DECRYPTION ===

  encryptData(data) {
    if (!data) return null;
    return JSON.stringify(data);
  }

  decryptData(encryptedData) {
    if (!encryptedData) return null;
    try {
      return JSON.parse(encryptedData);
    } catch {
      return encryptedData;
    }
  }

  decryptMember(member) {
    // Handle the complete database schema with Discord user data and encrypted tokens
    if (!member) return null;
    
    return {
      discordUserId: member.discord_user_id || member.discord_id, // Support both field names for compatibility
      athlete: member.athlete ? JSON.parse(member.athlete) : null,
      athleteId: member.athlete_id,
      isActive: Boolean(member.is_active),
      provider: member.provider || 'strava',
      registeredAt: member.registered_at || member.created_at,
      lastTokenRefresh: member.updated_at,
      
      // Discord user information (now available from database)
      discordUser: {
        username: member.discord_username,
        displayName: member.discord_display_name,
        discriminator: member.discord_discriminator || '0',
        avatar: member.discord_avatar
      },
      
      // Encrypted token data (preserved from original JSON format)
      tokens: member.encrypted_tokens ? JSON.parse(member.encrypted_tokens) : null
    };
  }

  async ensureInitialized() {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  async close() {
    return await dbConnection.close();
  }

  async backup(backupPath) {
    return await dbConnection.backup(backupPath);
  }

  async healthCheck() {
    return await dbConnection.healthCheck();
  }
}

module.exports = new DatabaseManager();