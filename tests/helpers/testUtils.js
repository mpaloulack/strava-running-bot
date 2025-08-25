/**
 * Test utilities and helpers
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Mock config object for testing
 */
const mockConfig = {
  discord: {
    token: 'mock_discord_token',
    channelId: '555666777888999000',
    guildId: '987654321098765432'
  },
  strava: {
    clientId: 'mock_strava_client_id',
    clientSecret: 'mock_strava_client_secret',
    webhookVerifyToken: 'mock_webhook_token'
  },
  security: {
    encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  },
  server: {
    port: 3000,
    baseUrl: 'http://localhost:3000'
  },
  posting: {
    delayMinutes: 5,
    maxRetries: 3
  },
  googleMaps: {
    apiKey: 'mock_google_maps_key'
  }
};

/**
 * Create a temporary directory for testing
 */
function createTempDir(name = 'test-data') {
  const tempDir = path.join(__dirname, '..', 'temp', name);
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

/**
 * Clean up temporary directories
 */
function cleanupTempDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

/**
 * Create mock file system operations
 */
function mockFileSystem() {
  const mockFS = {
    files: new Map(),
    
    existsSync: jest.fn((filePath) => mockFS.files.has(filePath)),
    
    readFileSync: jest.fn((filePath, encoding) => {
      if (!mockFS.files.has(filePath)) {
        throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
      }
      const content = mockFS.files.get(filePath);
      return encoding ? content.toString(encoding) : content;
    }),
    
    writeFileSync: jest.fn((filePath, data, options) => {
      mockFS.files.set(filePath, data);
    }),
    
    mkdirSync: jest.fn(),
    
    unlinkSync: jest.fn((filePath) => {
      mockFS.files.delete(filePath);
    }),
    
    // Helper to add files to mock filesystem
    addFile: (filePath, content) => {
      mockFS.files.set(filePath, content);
    },
    
    // Helper to check if file exists in mock filesystem
    hasFile: (filePath) => mockFS.files.has(filePath),
    
    // Helper to get file content
    getFile: (filePath) => mockFS.files.get(filePath)
  };
  
  return mockFS;
}

/**
 * Mock console methods for testing logging
 */
function mockConsole() {
  const originalConsole = { ...console };
  
  const mockConsole = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    
    // Restore original console
    restore: () => {
      Object.assign(console, originalConsole);
    }
  };
  
  // Replace console methods
  Object.assign(console, mockConsole);
  
  return mockConsole;
}

/**
 * Create mock Discord embed builder
 */
function createMockEmbedBuilder() {
  const embed = {
    data: {},
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    setAuthor: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis(),
    setTimestamp: jest.fn().mockReturnThis(),
    setURL: jest.fn().mockReturnThis(),
    setImage: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
    setThumbnail: jest.fn().mockReturnThis()
  };
  
  // Track calls for assertions
  embed._getCalls = (method) => embed[method].mock.calls;
  embed._getCallsWithArgs = (method) => embed[method].mock.calls.map(call => call[0]);
  
  return embed;
}

/**
 * Mock crypto operations for testing
 */
function mockCrypto() {
  const originalCrypto = require('crypto');
  
  return {
    randomBytes: jest.fn((size) => Buffer.from('0'.repeat(size * 2), 'hex')),
    createCipheriv: jest.fn(() => ({
      update: jest.fn(() => 'encrypted_data_part1'),
      final: jest.fn(() => 'encrypted_data_part2'),
      getAuthTag: jest.fn(() => Buffer.from('mock_auth_tag', 'hex'))
    })),
    createDecipheriv: jest.fn(() => ({
      setAuthTag: jest.fn(),
      update: jest.fn(() => '{"access_token":"mock_token",'),
      final: jest.fn(() => '"refresh_token":"mock_refresh"}')
    }))
  };
}

/**
 * Create mock HTTP request/response objects
 */
function createMockHttpObjects() {
  const mockReq = {
    body: {},
    query: {},
    params: {},
    headers: {},
    method: 'GET',
    url: '/',
    originalUrl: '/',
    ip: '127.0.0.1'
  };
  
  const mockRes = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis()
  };
  
  const mockNext = jest.fn();
  
  return { mockReq, mockRes, mockNext };
}

/**
 * Wait for a specified time (for testing async operations)
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a mock timer for testing time-dependent code
 */
function mockTimer() {
  let currentTime = Date.now();
  
  return {
    now: () => currentTime,
    advance: (ms) => { currentTime += ms; },
    set: (timestamp) => { currentTime = timestamp; },
    reset: () => { currentTime = Date.now(); }
  };
}

module.exports = {
  mockConfig,
  createTempDir,
  cleanupTempDir,
  mockFileSystem,
  mockConsole,
  createMockEmbedBuilder,
  mockCrypto,
  createMockHttpObjects,
  wait,
  mockTimer
};