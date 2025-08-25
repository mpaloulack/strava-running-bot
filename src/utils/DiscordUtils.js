/**
 * Shared Discord utility functions
 */
class DiscordUtils {
  
  /**
   * Extract user ID from mention or return as-is if already an ID
   * @param {string} userInput - User mention or ID
   * @returns {string|null} User ID or null if invalid
   */
  static extractUserId(userInput) {
    // Return null for non-string inputs
    if (typeof userInput !== 'string') {
      return null;
    }
    
    // Extract user ID from mention (<@123456>) or return as-is if it's already an ID
    const mentionMatch = userInput.match(/^<@!?(\d{17,19})>$/);
    if (mentionMatch) {
      return mentionMatch[1];
    }
    
    // Check if it's a valid snowflake ID (Discord user ID)
    if (/^\d{17,19}$/.test(userInput)) {
      return userInput;
    }
    
    return null;
  }

  /**
   * Split an array into chunks of specified size
   * @param {Array} array - Array to chunk
   * @param {number} size - Chunk size
   * @returns {Array[]} Array of chunks
   */
  static chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

module.exports = DiscordUtils;