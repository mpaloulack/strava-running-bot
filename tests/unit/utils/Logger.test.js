/**
 * Tests for Logger utility class
 */

const { mockConsole } = require('../../helpers/testUtils');

// Mock chalk module
jest.mock('chalk', () => {
  const mockChalkFunction = (color) => {
    const fn = jest.fn(text => `${color.toUpperCase()}[${text}]`);
    return fn;
  };
  
  const mockChalkWithBold = (color) => {
    const fn = jest.fn(text => `${color.toUpperCase()}[${text}]`);
    fn.bold = jest.fn(text => `${color.toUpperCase()}_BOLD[${text}]`);
    return fn;
  };
  
  return {
    red: mockChalkWithBold('red'),
    yellow: mockChalkFunction('yellow'),
    cyan: mockChalkFunction('cyan'),
    gray: mockChalkFunction('gray'),
    blue: mockChalkFunction('blue'),
    orange: mockChalkFunction('orange'),
    green: mockChalkWithBold('green'),
    magenta: mockChalkFunction('magenta'),
    white: mockChalkFunction('white')
  };
});

describe('Logger', () => {
  let logger;
  let mockConsoleFunctions;
  
  beforeEach(() => {
    // Reset environment variables
    delete process.env.LOG_LEVEL;
    
    // Clear module cache to get fresh instance
    jest.resetModules();
    
    // Mock console functions
    mockConsoleFunctions = mockConsole();
    
    // Get fresh logger instance
    logger = require('../../../src/utils/Logger');
  });
  
  afterEach(() => {
    mockConsoleFunctions.restore();
    jest.clearAllMocks();
  });
  
  describe('constructor and initialization', () => {
    test('should initialize with default INFO level', () => {
      expect(logger.currentLevel).toBe(2); // INFO level
      expect(logger.levels).toEqual({
        ERROR: 0,
        WARN: 1,
        INFO: 2,
        DEBUG: 3
      });
    });
    
    test('should use LOG_LEVEL environment variable when set', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      jest.resetModules();
      const debugLogger = require('../../../src/utils/Logger');
      
      expect(debugLogger.currentLevel).toBe(3); // DEBUG level
    });
    
    test('should default to INFO when invalid LOG_LEVEL provided', () => {
      process.env.LOG_LEVEL = 'INVALID_LEVEL';
      jest.resetModules();
      const invalidLogger = require('../../../src/utils/Logger');
      
      expect(invalidLogger.currentLevel).toBe(2); // INFO level (default)
    });
    
    test('should initialize color schemes and symbols', () => {
      expect(logger.symbols).toEqual({
        ERROR: '❌',
        WARN: '⚠️',
        INFO: 'ℹ️',
        DEBUG: '🔍'
      });
      
      expect(logger.componentColors).toHaveProperty('DISCORD');
      expect(logger.componentColors).toHaveProperty('STRAVA');
      expect(logger.componentColors).toHaveProperty('WEBHOOK');
    });
  });
  
  describe('getTimestamp', () => {
    test('should return ISO string timestamp', () => {
      const timestamp = logger.getTimestamp();
      
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(timestamp).getTime()).toBeGreaterThan(Date.now() - 1000);
    });
  });
  
  describe('shouldLog', () => {
    test('should allow logging when level meets threshold', () => {
      logger.currentLevel = 2; // INFO
      
      expect(logger.shouldLog('ERROR')).toBe(true);  // 0 <= 2
      expect(logger.shouldLog('WARN')).toBe(true);   // 1 <= 2
      expect(logger.shouldLog('INFO')).toBe(true);   // 2 <= 2
      expect(logger.shouldLog('DEBUG')).toBe(false); // 3 > 2
    });
    
    test('should block all logging except ERROR when level is ERROR', () => {
      logger.currentLevel = 0; // ERROR only
      
      expect(logger.shouldLog('ERROR')).toBe(true);
      expect(logger.shouldLog('WARN')).toBe(false);
      expect(logger.shouldLog('INFO')).toBe(false);
      expect(logger.shouldLog('DEBUG')).toBe(false);
    });
    
    test('should allow all logging when level is DEBUG', () => {
      logger.currentLevel = 3; // DEBUG (all)
      
      expect(logger.shouldLog('ERROR')).toBe(true);
      expect(logger.shouldLog('WARN')).toBe(true);
      expect(logger.shouldLog('INFO')).toBe(true);
      expect(logger.shouldLog('DEBUG')).toBe(true);
    });
  });
  
  describe('formatMessage', () => {
    test('should format basic message with level and timestamp', () => {
      const message = logger.formatMessage('ERROR', null, 'Test message');
      
      expect(message).toContain('RED_BOLD[[ERROR]]');
      expect(message).toContain('Test message');
      expect(message).toContain('GRAY[');
    });
    
    test('should include component when provided', () => {
      const message = logger.formatMessage('INFO', 'DISCORD', 'Test message');
      
      expect(message).toContain('CYAN[[INFO]]');
      expect(message).toContain('BLUE[[DISCORD]]');
      expect(message).toContain('Test message');
    });
    
    test('should append object data formatted as JSON', () => {
      const testData = { key: 'value', number: 42 };
      const message = logger.formatMessage('INFO', null, 'Test message', testData);
      
      expect(message).toContain('Test message');
      expect(message).toContain('\"key\": \"value\"');
      expect(message).toContain('\"number\": 42');
    });
    
    test('should append primitive data as string', () => {
      const message = logger.formatMessage('INFO', null, 'Test message', 'extra data');
      
      expect(message).toContain('Test message extra data');
    });
    
    test('should use white color for unknown component', () => {
      const message = logger.formatMessage('INFO', 'UNKNOWN_COMPONENT', 'Test message');
      
      expect(message).toContain('WHITE[[UNKNOWN_COMPONENT]]');
    });
  });
  
  describe('generic log method', () => {
    test('should not log when level is below threshold', () => {
      logger.currentLevel = 1; // WARN level
      
      logger.log('DEBUG', 'TEST', 'This should not log');
      
      expect(mockConsoleFunctions.log).not.toHaveBeenCalled();
      expect(mockConsoleFunctions.debug).not.toHaveBeenCalled();
    });
    
    test('should use console.error for ERROR level', () => {
      logger.log('ERROR', 'TEST', 'Error message');
      
      expect(mockConsoleFunctions.error).toHaveBeenCalled();
      expect(mockConsoleFunctions.log).not.toHaveBeenCalled();
    });
    
    test('should use console.warn for WARN level', () => {
      logger.log('WARN', 'TEST', 'Warning message');
      
      expect(mockConsoleFunctions.warn).toHaveBeenCalled();
      expect(mockConsoleFunctions.log).not.toHaveBeenCalled();
    });
    
    test('should use console.debug for DEBUG level', () => {
      logger.currentLevel = 3; // Enable DEBUG
      logger.log('DEBUG', 'TEST', 'Debug message');
      
      expect(mockConsoleFunctions.debug).toHaveBeenCalled();
      expect(mockConsoleFunctions.log).not.toHaveBeenCalled();
    });
    
    test('should use console.log for INFO level', () => {
      logger.log('INFO', 'TEST', 'Info message');
      
      expect(mockConsoleFunctions.log).toHaveBeenCalled();
      expect(mockConsoleFunctions.error).not.toHaveBeenCalled();
    });
  });
  
  describe('convenience logging methods', () => {
    beforeEach(() => {
      logger.currentLevel = 3; // Enable all levels for testing
    });
    
    test('error method should call log with ERROR level', () => {
      const logSpy = jest.spyOn(logger, 'log');
      
      logger.error('TEST_COMPONENT', 'Error message', { error: 'details' });
      
      expect(logSpy).toHaveBeenCalledWith('ERROR', 'TEST_COMPONENT', 'Error message', { error: 'details' });
    });
    
    test('warn method should call log with WARN level', () => {
      const logSpy = jest.spyOn(logger, 'log');
      
      logger.warn('TEST_COMPONENT', 'Warning message');
      
      expect(logSpy).toHaveBeenCalledWith('WARN', 'TEST_COMPONENT', 'Warning message', null);
    });
    
    test('info method should call log with INFO level', () => {
      const logSpy = jest.spyOn(logger, 'log');
      
      logger.info('TEST_COMPONENT', 'Info message');
      
      expect(logSpy).toHaveBeenCalledWith('INFO', 'TEST_COMPONENT', 'Info message', null);
    });
    
    test('debug method should call log with DEBUG level', () => {
      const logSpy = jest.spyOn(logger, 'log');
      
      logger.debug('TEST_COMPONENT', 'Debug message');
      
      expect(logSpy).toHaveBeenCalledWith('DEBUG', 'TEST_COMPONENT', 'Debug message', null);
    });
  });
  
  describe('system method', () => {
    test('should always log system messages regardless of level', () => {
      logger.currentLevel = 0; // ERROR only
      
      logger.system('System startup message');
      
      expect(mockConsoleFunctions.log).toHaveBeenCalled();
      const logCall = mockConsoleFunctions.log.mock.calls[0][0];
      expect(logCall).toContain('GREEN_BOLD[[SYSTEM]]');
      expect(logCall).toContain('System startup message');
    });
    
    test('should format system messages with data', () => {
      logger.system('System message', { config: 'loaded' });
      
      expect(mockConsoleFunctions.log).toHaveBeenCalled();
      const logCall = mockConsoleFunctions.log.mock.calls[0][0];
      expect(logCall).toContain('System message');
      expect(logCall).toContain('\"config\": \"loaded\"');
    });
  });
  
  describe('component-specific loggers', () => {
    beforeEach(() => {
      logger.currentLevel = 3; // Enable all levels
    });
    
    const testComponentLogger = (componentName) => {
      test(`${componentName} logger should call appropriate log methods`, () => {
        const errorSpy = jest.spyOn(logger, 'error');
        const warnSpy = jest.spyOn(logger, 'warn');
        const infoSpy = jest.spyOn(logger, 'info');
        const debugSpy = jest.spyOn(logger, 'debug');
        
        // Get the component logger dynamically
        const componentLogger = logger[componentName.toLowerCase()];
        expect(componentLogger).toBeDefined();
        
        componentLogger.error('Error message', { data: 'error' });
        componentLogger.warn('Warning message', { data: 'warn' });
        componentLogger.info('Info message', { data: 'info' });
        componentLogger.debug('Debug message', { data: 'debug' });
        
        expect(errorSpy).toHaveBeenCalledWith(componentName, 'Error message', { data: 'error' });
        expect(warnSpy).toHaveBeenCalledWith(componentName, 'Warning message', { data: 'warn' });
        expect(infoSpy).toHaveBeenCalledWith(componentName, 'Info message', { data: 'info' });
        expect(debugSpy).toHaveBeenCalledWith(componentName, 'Debug message', { data: 'debug' });
      });
    };
    
    testComponentLogger('DISCORD');
    testComponentLogger('STRAVA');
    testComponentLogger('WEBHOOK');
    testComponentLogger('MEMBER');
    testComponentLogger('ACTIVITY');
    testComponentLogger('SERVER');
  });
  
  describe('request logging', () => {
    test('should log HTTP request with method, path, and status', () => {
      logger.request('GET', '/api/test', 200, 150);
      
      expect(mockConsoleFunctions.log).toHaveBeenCalled();
      const logCall = mockConsoleFunctions.log.mock.calls[0][0];
      expect(logCall).toContain('GET');
      expect(logCall).toContain('/api/test');
      expect(logCall).toContain('200');
      expect(logCall).toContain('150ms');
    });
    
    test('should include user agent in debug mode', () => {
      logger.currentLevel = 3; // DEBUG
      logger.request('POST', '/api/webhook', 201, 75, 'Test-Agent/1.0');
      
      expect(mockConsoleFunctions.log).toHaveBeenCalled();
      const logCall = mockConsoleFunctions.log.mock.calls[0][0];
      expect(logCall).toContain('Test-Agent/1.0');
    });
    
    test('should not log when below INFO level', () => {
      logger.currentLevel = 1; // WARN only
      logger.request('GET', '/test', 200, 100);
      
      expect(mockConsoleFunctions.log).not.toHaveBeenCalled();
    });
    
    test('should handle missing response time', () => {
      logger.request('DELETE', '/api/resource', 204);
      
      expect(mockConsoleFunctions.log).toHaveBeenCalled();
      const logCall = mockConsoleFunctions.log.mock.calls[0][0];
      expect(logCall).toContain('DELETE');
      expect(logCall).toContain('204');
      expect(logCall).not.toContain('ms');
    });
  });
  
  describe('activity processing logging', () => {
    test('should log activity processing with emoji and details', () => {
      const activitySpy = jest.spyOn(logger.activity, 'info');
      
      logger.activityProcessing(123456, 789, 'Morning Run', 'COMPLETED', { distance: '5km' });
      
      expect(activitySpy).toHaveBeenCalledWith(
        '✅ Activity 123456 by athlete 789: Morning Run - COMPLETED',
        { distance: '5km' }
      );
    });
    
    test('should use error level for FAILED status', () => {
      const activityErrorSpy = jest.spyOn(logger.activity, 'error');
      
      logger.activityProcessing(123456, 789, 'Failed Run', 'FAILED', { error: 'API timeout' });
      
      expect(activityErrorSpy).toHaveBeenCalledWith(
        '❌ Activity 123456 by athlete 789: Failed Run - FAILED',
        { error: 'API timeout' }
      );
    });
    
    test('should use debug level for SKIPPED status', () => {
      const activityDebugSpy = jest.spyOn(logger.activity, 'debug');
      
      logger.activityProcessing(123456, 789, 'Skipped Run', 'SKIPPED', { reason: 'too old' });
      
      expect(activityDebugSpy).toHaveBeenCalledWith(
        '⏭️ Activity 123456 by athlete 789: Skipped Run - SKIPPED',
        { reason: 'too old' }
      );
    });
    
    test('should use debug level for FILTERED status', () => {
      const activityDebugSpy = jest.spyOn(logger.activity, 'debug');
      
      logger.activityProcessing(123456, 789, 'Private Run', 'FILTERED', { reason: 'private activity' });
      
      expect(activityDebugSpy).toHaveBeenCalledWith(
        '🚫 Activity 123456 by athlete 789: Private Run - FILTERED',
        { reason: 'private activity' }
      );
    });
  });
  
  describe('member action logging', () => {
    test('should log member registration with emoji and details', () => {
      const memberInfoSpy = jest.spyOn(logger.member, 'info');
      
      logger.memberAction('REGISTERED', 'John Doe', 'discord123', 'strava456', { team: 'runners' });
      
      expect(memberInfoSpy).toHaveBeenCalledWith(
        '✅ Member John Doe (Discord: discord123, Strava: strava456) - REGISTERED',
        { team: 'runners' }
      );
    });
    
    test('should use warn level for TOKEN_FAILED', () => {
      const memberWarnSpy = jest.spyOn(logger.member, 'warn');
      
      logger.memberAction('TOKEN_FAILED', 'Jane Doe', 'discord789', 'strava123', { error: 'expired' });
      
      expect(memberWarnSpy).toHaveBeenCalledWith(
        '❌ Member Jane Doe (Discord: discord789, Strava: strava123) - TOKEN_FAILED',
        { error: 'expired' }
      );
    });
    
    test('should use warn level for REMOVED action', () => {
      const memberWarnSpy = jest.spyOn(logger.member, 'warn');
      
      logger.memberAction('REMOVED', 'Bob Smith', 'discord999', 'strava888');
      
      expect(memberWarnSpy).toHaveBeenCalledWith(
        '🗑️ Member Bob Smith (Discord: discord999, Strava: strava888) - REMOVED',
        null
      );
    });
  });
  
  describe('configuration methods', () => {
    test('getConfig should return current logging configuration', () => {
      logger.currentLevel = 2; // INFO
      
      const config = logger.getConfig();
      
      expect(config).toEqual({
        currentLevel: 'INFO',
        numericLevel: 2,
        enabledLevels: ['ERROR', 'WARN', 'INFO']
      });
    });
    
    test('getConfig should work with DEBUG level', () => {
      logger.currentLevel = 3; // DEBUG
      
      const config = logger.getConfig();
      
      expect(config).toEqual({
        currentLevel: 'DEBUG',
        numericLevel: 3,
        enabledLevels: ['ERROR', 'WARN', 'INFO', 'DEBUG']
      });
    });
    
    test('setLevel should change logging level', () => {
      const infoSpy = jest.spyOn(logger, 'info');
      
      logger.setLevel('ERROR');
      
      expect(logger.currentLevel).toBe(0);
      expect(infoSpy).toHaveBeenCalledWith('SYSTEM', 'Log level changed to ERROR');
    });
    
    test('setLevel should handle invalid level with warning', () => {
      const warnSpy = jest.spyOn(logger, 'warn');
      const originalLevel = logger.currentLevel;
      
      logger.setLevel('INVALID_LEVEL');
      
      expect(logger.currentLevel).toBe(originalLevel); // Unchanged
      expect(warnSpy).toHaveBeenCalledWith(
        'SYSTEM',
        'Invalid log level: INVALID_LEVEL. Available levels: ERROR, WARN, INFO, DEBUG'
      );
    });
    
    test('setLevel should be case insensitive', () => {
      logger.setLevel('debug');
      expect(logger.currentLevel).toBe(3);
      
      logger.setLevel('WaRn');
      expect(logger.currentLevel).toBe(1);
    });
  });
  
  describe('singleton behavior', () => {
    test('should export singleton instance', () => {
      const logger1 = require('../../../src/utils/Logger');
      const logger2 = require('../../../src/utils/Logger');
      
      expect(logger1).toBe(logger2);
      expect(logger1).toBeInstanceOf(Object);
    });
    
    test('singleton should maintain state across imports', () => {
      logger.setLevel('DEBUG');
      
      const anotherLogger = require('../../../src/utils/Logger');
      expect(anotherLogger.currentLevel).toBe(3);
    });
  });
  
  describe('edge cases and error handling', () => {
    test('should handle null/undefined messages gracefully', () => {
      expect(() => {
        logger.info('TEST', null);
        logger.info('TEST', undefined);
      }).not.toThrow();
    });
    
    test('should handle circular object references in data', () => {
      const circularObj = { name: 'test' };
      circularObj.self = circularObj;
      
      expect(() => {
        logger.info('TEST', 'Message with circular object', circularObj);
      }).not.toThrow();
      
      // Verify that the serialization error message was logged
      expect(mockConsoleFunctions.log).toHaveBeenCalled();
      const logCall = mockConsoleFunctions.log.mock.calls[0][0];
      expect(logCall).toContain('[Object serialization failed:');
      expect(logCall).toContain('Converting circular structure to JSON');
    });
    
    test('should handle very long messages', () => {
      const longMessage = 'A'.repeat(10000);
      
      expect(() => {
        logger.info('TEST', longMessage);
      }).not.toThrow();
    });
    
    test('should handle special characters in messages', () => {
      const specialMessage = '特殊文字 🎉 emoji \\n\\t special chars';
      
      expect(() => {
        logger.info('TEST', specialMessage);
      }).not.toThrow();
      
      expect(mockConsoleFunctions.log).toHaveBeenCalled();
    });
  });
});