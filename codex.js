const crypto = require('crypto');

/**
 * Generates a 4-character, letters-only ID from a long string identifier.
 *
 * This function uses a cryptographic hash (SHA-1) of the input ID to ensure
 * the output is deterministic. It then maps the hash bytes to an alphabet
 * consisting only of uppercase and lowercase letters.
 *
 * @param {string} longId - The long unique identifier (e.g., a UUID string).
 * @returns {string} A 4-character short identifier containing only letters.
 */
function generateShortId(longId) {
  // The alphabet to use for the short ID (52 letters).
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  
  // Use SHA-1 to create a consistent hash from the long ID.
  // Using a salt makes the hash unique to your application.
  const hasher = crypto.createHash('sha1');
  hasher.update(longId + 'your-unique-letter-salt');

  // Get the hash digest as a buffer of bytes.
  const hashBytes = hasher.digest();

  let shortId = '';
  // Loop 4 times to build a 4-character ID.
  for (let i = 0; i < 4; i++) {
    // Take a byte from the hash and use the modulo operator
    // to get a valid index within our alphabet.
    const index = hashBytes[i] % alphabet.length;
    shortId += alphabet[index];
  }
  
  return shortId;
}

module.exports = { generateShortId };

// --- Example Usage ---
// const uuidString = "217784ce-1586-403f-92a7-8df44dca1ce8";
// const shortId = generateShortId(uuidString);
// console.log(`The UUID '${uuidString}' was converted to the letters-only short ID: '${shortId}'`);

// const anotherUuid = "e7a3f8b0-5c1d-4a9f-8b5c-9e6f3d8a4b1c";
// const anotherShortId = generateShortId(anotherUuid);
// console.log(`The UUID '${anotherUuid}' was converted to the letters-only short ID: '${anotherShortId}'`);