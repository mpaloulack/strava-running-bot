// Jest setup file
// Mock console methods to reduce noise during testing
global.console = {
  ...console,
  // Uncomment to ignore specific console output during tests
  // log: jest.fn(),
  // error: jest.fn(),
  // warn: jest.fn(),
  // info: jest.fn(),
  // debug: jest.fn(),
};

// Increase timeout for integration tests
jest.setTimeout(10000);

// Mock process.exit to prevent tests from actually exiting
const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`Process exited with code: ${code}`);
});

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
});