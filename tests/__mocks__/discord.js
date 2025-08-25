/**
 * Mock Discord.js for testing
 */

const { EventEmitter } = require('events');

// Mock EmbedBuilder
class MockEmbedBuilder {
  constructor() {
    this.data = {};
    
    // Create Jest spy functions that return this for chaining
    this.setTitle = jest.fn().mockReturnValue(this);
    this.setDescription = jest.fn().mockReturnValue(this);
    this.setColor = jest.fn().mockReturnValue(this);
    this.setAuthor = jest.fn().mockReturnValue(this);
    this.setFooter = jest.fn().mockReturnValue(this);
    this.setTimestamp = jest.fn().mockReturnValue(this);
    this.setURL = jest.fn().mockReturnValue(this);
    this.setImage = jest.fn().mockReturnValue(this);
    this.addFields = jest.fn().mockReturnValue(this);
    this.setThumbnail = jest.fn().mockReturnValue(this);
  }
}

// Mock SlashCommandBuilder
class MockSlashCommandBuilder {
  constructor() {
    this.data = {};
  }
  
  setName(name) {
    this.data.name = name;
    return this;
  }
  
  setDescription(description) {
    this.data.description = description;
    return this;
  }
  
  addSubcommand(callback) {
    if (!this.data.options) this.data.options = [];
    const subcommand = new MockSlashCommandBuilder();
    callback(subcommand);
    this.data.options.push({ type: 1, ...subcommand.data });
    return this;
  }
  
  addUserOption(callback) {
    if (!this.data.options) this.data.options = [];
    const option = { type: 6 };
    if (callback) callback(option);
    this.data.options.push(option);
    return this;
  }
  
  addStringOption(callback) {
    if (!this.data.options) this.data.options = [];
    const option = { type: 3 };
    if (callback) {
      const optionBuilder = {
        setName: (name) => { option.name = name; return optionBuilder; },
        setDescription: (desc) => { option.description = desc; return optionBuilder; },
        setRequired: (required) => { option.required = required; return optionBuilder; },
        setAutocomplete: (autocomplete) => { option.autocomplete = autocomplete; return optionBuilder; }
      };
      callback(optionBuilder);
    }
    this.data.options.push(option);
    return this;
  }
  
  setDefaultMemberPermissions(permissions) {
    this.data.default_member_permissions = permissions;
    return this;
  }
}

// Mock Client
class MockClient extends EventEmitter {
  constructor() {
    super();
    this.user = null;
    this.users = {
      fetch: jest.fn().mockResolvedValue({
        id: '123456789',
        username: 'testuser',
        discriminator: '1234',
        displayAvatarURL: jest.fn().mockReturnValue('https://example.com/avatar.png')
      })
    };
    this.guilds = {
      cache: new Map()
    };
    this.application = {
      commands: {
        set: jest.fn().mockResolvedValue([])
      }
    };
  }
  
  login(token) {
    this.token = token;
    setTimeout(() => this.emit('ready'), 10);
    return Promise.resolve(token);
  }
  
  destroy() {
    this.emit('disconnect');
    return Promise.resolve();
  }
}

// Mock enums
const PermissionFlagsBits = {
  ManageGuild: '1n << 5n'
};

const GatewayIntentBits = {
  Guilds: '1n << 0n',
  GuildMessages: '1n << 9n',
  MessageContent: '1n << 15n'
};

module.exports = {
  EmbedBuilder: MockEmbedBuilder,
  SlashCommandBuilder: MockSlashCommandBuilder,
  Client: MockClient,
  PermissionFlagsBits,
  GatewayIntentBits,
  REST: jest.fn().mockImplementation(() => ({
    setToken: jest.fn().mockReturnThis(),
    put: jest.fn().mockResolvedValue([])
  })),
  Routes: {
    applicationGuildCommands: jest.fn().mockReturnValue('/applications/123/guilds/456/commands'),
    applicationCommands: jest.fn().mockReturnValue('/applications/123/commands')
  }
};