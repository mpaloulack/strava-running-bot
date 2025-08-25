/**
 * Test fixtures for team members
 */

const mockMember = {
  athleteId: 987654321,
  discordUserId: "123456789012345678",
  isActive: true,
  registeredAt: "2024-01-01T10:00:00.000Z",
  athlete: {
    id: 987654321,
    firstname: "John",
    lastname: "Runner",
    profile_medium: "https://example.com/avatar.jpg",
    profile: "https://example.com/avatar_large.jpg",
    city: "New York",
    state: "NY",
    country: "United States",
    created_at: "2020-01-15T12:00:00Z"
  },
  tokens: {
    access_token: "mock_access_token_12345",
    refresh_token: "mock_refresh_token_67890",
    expires_at: Math.floor(Date.now() / 1000) + 21600, // 6 hours from now
    token_type: "Bearer",
    scope: "read,activity:read"
  },
  discordUser: {
    id: "123456789012345678",
    displayName: "JohnRunner#1234",
    avatarURL: "https://cdn.discordapp.com/avatars/123/avatar.png"
  },
  lastActivityId: null,
  settings: {
    postActivities: true,
    minDistance: 1000,
    activityTypes: ["Run", "Ride"]
  }
};

const mockInactiveMember = {
  ...mockMember,
  athleteId: 987654322,
  discordUserId: "123456789012345679",
  isActive: false,
  athlete: {
    ...mockMember.athlete,
    id: 987654322,
    firstname: "Jane",
    lastname: "Cyclist"
  },
  discordUser: {
    id: "123456789012345679",
    displayName: "JaneCyclist#5678",
    avatarURL: "https://cdn.discordapp.com/avatars/456/avatar.png"
  }
};

const mockExpiredTokenMember = {
  ...mockMember,
  athleteId: 987654323,
  discordUserId: "123456789012345680",
  tokens: {
    ...mockMember.tokens,
    access_token: "expired_token_12345",
    expires_at: Math.floor(Date.now() / 1000) - 3600 // 1 hour ago
  },
  athlete: {
    ...mockMember.athlete,
    id: 987654323,
    firstname: "Mike",
    lastname: "Swimmer"
  }
};

const mockEncryptedMember = {
  ...mockMember,
  athleteId: 987654324,
  tokens: {
    encrypted: "3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d",
    iv: "1234567890abcdef1234567890abcdef",
    authTag: "fedcba0987654321fedcba0987654321"
  }
};

const mockMemberList = [
  mockMember,
  mockInactiveMember,
  mockExpiredTokenMember
];

const mockMemberStats = {
  total: 3,
  active: 2,
  inactive: 1,
  expiredTokens: 1
};

// Discord interaction mocks
const mockDiscordInteraction = {
  user: {
    id: "123456789012345678",
    tag: "JohnRunner#1234",
    displayName: "John Runner"
  },
  guild: {
    id: "987654321098765432",
    name: "Running Team",
    members: {
      cache: new Map([
        ["123456789012345678", {
          id: "123456789012345678",
          displayName: "John Runner",
          user: {
            displayAvatarURL: () => "https://cdn.discordapp.com/avatars/123/avatar.png"
          }
        }]
      ])
    }
  },
  channel: {
    id: "555666777888999000",
    name: "activities"
  },
  reply: jest.fn(),
  deferReply: jest.fn(),
  editReply: jest.fn(),
  followUp: jest.fn()
};

module.exports = {
  mockMember,
  mockInactiveMember,
  mockExpiredTokenMember,
  mockEncryptedMember,
  mockMemberList,
  mockMemberStats,
  mockDiscordInteraction,
  
  // Helper function to create member with custom data
  createMockMember: (overrides = {}) => ({
    ...mockMember,
    ...overrides,
    athlete: {
      ...mockMember.athlete,
      ...(overrides.athlete || {})
    },
    tokens: {
      ...mockMember.tokens,
      ...(overrides.tokens || {})
    }
  })
};