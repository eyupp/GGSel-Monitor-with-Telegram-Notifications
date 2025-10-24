const request = require('request');
const crypto = require('crypto');
require('dotenv').config();

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const TOKEN_VALIDITY_DURATION = 110 * 60 * 1000; // 1 hour 50 minutes in milliseconds

// Token cache
let tokenCache = {
    token: null,
    timestamp: null
};

const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

const logger = {
    log: (...args) => DEBUG_MODE && console.log(...args),
    error: (...args) => console.error(...args),
    warn: (...args) => DEBUG_MODE && console.warn(...args),
    info: (...args) => console.info(...args)
};

async function makeRequestWithRetry(options, attempt = 1) {
    return new Promise((resolve, reject) => {
        request(options, (error, response, body) => {
            if (error) {
                // Retry on network errors or timeouts
                if (attempt < MAX_RETRIES && ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ESOCKETTIMEDOUT', 'ERR_REQUEST_TIMEOUT'].includes(error.code)) {
                    logger.warn(`GGSel request failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY}ms... Error: ${error.code}`);
                    setTimeout(() => {
                        makeRequestWithRetry(options, attempt + 1).then(resolve).catch(reject);
                    }, RETRY_DELAY);
                } else {
                    logger.error(`GGSel request failed after ${attempt} attempts. Error: ${error.message}`);
                    reject(error); // Final failure after retries or non-retryable error
                }
            } else if (!response || response.statusCode < 200 || response.statusCode >= 300) {
                 // Don't retry on non-2xx status codes immediately, could be API issue
                 const statusCode = response ? response.statusCode : 'N/A';
                 const errorMessage = `GGSel API request failed with status ${statusCode}. Body: ${JSON.stringify(body)}`;
                 logger.error(errorMessage);
                 reject(new Error(errorMessage));
            }
             else {
                resolve({ response, body }); // Success
            }
        });
    });
}


async function getToken() {
    // Check if we have a valid cached token
    if (tokenCache.token && tokenCache.timestamp) {
        const tokenAge = Date.now() - tokenCache.timestamp;
        if (tokenAge < TOKEN_VALIDITY_DURATION) {
            logger.log(`Using cached token (age: ${Math.floor(tokenAge / 1000)}s)`);
            return tokenCache.token;
        } else {
            logger.log(`Cached token expired (age: ${Math.floor(tokenAge / 1000)}s), fetching new token...`);
        }
    }

    const headers = {
        'Content-Type': "application/json",
        'Accept': "application/json"
    };

    const timestamp = Date.now();
    // Consider moving secret key to environment variables
    const baba = (process.env.GGSEL_SECRET_KEY) + Math.round(timestamp).toString();
    const sign = crypto.createHash('sha256').update(baba).digest('hex');

    const token_json_request = {
        "seller_id": parseInt(process.env.GGSEL_SELLER_ID), // Use env var
        "timestamp": timestamp,
        "sign": sign
    };

    const options = {
        url: "https://seller.ggsel.net/api_sellers/api/apilogin",
        method: "POST",
        headers: headers,
        json: token_json_request,
        timeout: 10000 // Add a timeout
    };

    try {
        const { response, body } = await makeRequestWithRetry(options);
        // Ensure body and token exist
        if (body && body.token) {
            // Cache the token with current timestamp
            tokenCache.token = body.token;
            tokenCache.timestamp = Date.now();
            logger.log('New token obtained and cached');
            return body.token; // Resolve with token
        } else {
            logger.error("Token not found in GGSel API response body:", body);
            throw new Error('Token not found in GGSel API response');
        }
    } catch (error) {
        logger.error("Error getting GGSel token:", error.message);
        throw error; // Re-throw the error to be caught by the caller
    }
}

// Function to clear token cache (useful for forcing a new token)
function clearTokenCache() {
    tokenCache.token = null;
    tokenCache.timestamp = null;
    logger.log('Token cache cleared');
}

exports.getToken = getToken;
exports.clearTokenCache = clearTokenCache;