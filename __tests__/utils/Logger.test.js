const logger = require('../../src/utils/Logger');

// LOG_LEVEL defaults to INFO in production, so anything logged at DEBUG is
// invisible when it matters. An activity that was deliberately not posted is a
// real outcome someone will ask about ("why didn't my run appear?") - it has to
// be visible at the default level. Duplicates and non-members are noise and
// stay quiet.
describe('Logger.activityProcessing levels', () => {
  let info;
  let debug;
  let error;

  beforeEach(() => {
    info = jest.spyOn(logger.activity, 'info').mockImplementation(() => {});
    debug = jest.spyOn(logger.activity, 'debug').mockImplementation(() => {});
    error = jest.spyOn(logger.activity, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should report a filtered activity at info so it is visible by default', () => {
    logger.activityProcessing(1, 2, 'Private run', 'FILTERED', { reason: 'private' });

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('FILTERED'),
      { reason: 'private' }
    );
    expect(debug).not.toHaveBeenCalled();
  });

  it('should keep routine skips at debug', () => {
    logger.activityProcessing(1, 2, 'DUPLICATE', 'SKIPPED');

    expect(debug).toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it('should report failures as errors', () => {
    logger.activityProcessing(1, 2, 'UNKNOWN', 'FAILED', { error: 'boom' });

    expect(error).toHaveBeenCalled();
  });

  it('should report completion at info', () => {
    logger.activityProcessing(1, 2, 'Morning Run', 'COMPLETED');

    expect(info).toHaveBeenCalled();
  });
});
