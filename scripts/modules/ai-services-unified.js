/**
 * ai-services-unified.js
 * Centralized AI service layer using ai-client-factory and AI SDK core functions.
 */

import { generateText } from 'ai';
import { getClient } from './ai-client-factory.js';
import { log } from './utils.js'; // Import log for retry logging
// Import logger from utils later when needed
// import { log } from './utils.js';

// --- Configuration for Retries ---
const MAX_RETRIES = 2; // Total attempts = 1 + MAX_RETRIES
const INITIAL_RETRY_DELAY_MS = 1000; // 1 second

// Helper function to check if an error is retryable
function isRetryableError(error) {
	const errorMessage = error.message?.toLowerCase() || '';
	// Add common retryable error patterns
	return (
		errorMessage.includes('rate limit') ||
		errorMessage.includes('overloaded') ||
		errorMessage.includes('service temporarily unavailable') ||
		errorMessage.includes('timeout') ||
		errorMessage.includes('network error') ||
		// Add specific status codes if available from the SDK errors
		error.status === 429 || // Too Many Requests
		error.status >= 500 // Server-side errors
	);
}

/**
 * Internal helper to attempt an AI SDK API call with retries.
 *
 * @param {object} client - The AI client instance.
 * @param {function} apiCallFn - The AI SDK function to call (e.g., generateText).
 * @param {object} apiParams - Parameters for the AI SDK function (excluding model).
 * @param {string} attemptRole - The role being attempted (for logging).
 * @returns {Promise<object>} The result from the successful API call.
 * @throws {Error} If the call fails after all retries.
 */
async function _attemptApiCallWithRetries(
	client,
	apiCallFn,
	apiParams,
	attemptRole
) {
	let retries = 0;
	while (retries <= MAX_RETRIES) {
		try {
			log(
				'info',
				`Attempt ${retries + 1}/${MAX_RETRIES + 1} calling ${apiCallFn.name} for role ${attemptRole}`
			);
			// Call the provided AI SDK function (generateText, streamText, etc.)
			const result = await apiCallFn({ model: client, ...apiParams });
			log(
				'info',
				`${apiCallFn.name} succeeded for role ${attemptRole} on attempt ${retries + 1}`
			);
			return result; // Success!
		} catch (error) {
			log(
				'warn',
				`Attempt ${retries + 1} failed for role ${attemptRole} (${apiCallFn.name}): ${error.message}`
			);

			if (isRetryableError(error) && retries < MAX_RETRIES) {
				retries++;
				const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retries - 1);
				log(
					'info',
					`Retryable error detected. Retrying in ${delay / 1000}s...`
				);
				await new Promise((resolve) => setTimeout(resolve, delay));
			} else {
				log(
					'error',
					`Non-retryable error or max retries reached for role ${attemptRole} (${apiCallFn.name}).`
				);
				throw error; // Final failure for this attempt chain
			}
		}
	}
	// Should theoretically not be reached due to throw in the else block, but needed for linting/type safety
	throw new Error(
		`Exhausted all retries for role ${attemptRole} (${apiCallFn.name})`
	);
}

/**
 * Unified service function for generating text.
 * Handles client retrieval, retries, and fallback (main -> fallback -> research).
 * TODO: Add detailed logging.
 *
 * @param {object} params - Parameters for the service call.
 * @param {string} params.role - The initial client role ('main', 'research', 'fallback').
 * @param {object} [params.session=null] - Optional MCP session object.
 * @param {object} [params.overrideOptions={}] - Optional overrides for ai-client-factory { provider, modelId }.
 * @param {string} params.prompt - The prompt for the AI.
 * @param {number} [params.maxTokens] - Max tokens for the generation.
 * @param {number} [params.temperature] - Temperature setting.
 * // ... include other standard generateText options as needed ...
 * @returns {Promise<object>} The result from the AI SDK's generateText function.
 */
async function generateTextService(params) {
	const {
		role: initialRole,
		session,
		overrideOptions,
		...generateTextParams
	} = params;
	log('info', 'generateTextService called', { role: initialRole });

	// Determine the sequence explicitly based on the initial role
	let sequence;
	if (initialRole === 'main') {
		sequence = ['main', 'fallback', 'research'];
	} else if (initialRole === 'fallback') {
		sequence = ['fallback', 'research']; // Try fallback, then research
	} else if (initialRole === 'research') {
		sequence = ['research', 'fallback']; // Try research, then fallback
	} else {
		// Default sequence if initialRole is unknown or invalid
		log(
			'warn',
			`Unknown initial role: ${initialRole}. Defaulting to main -> fallback -> research sequence.`
		);
		sequence = ['main', 'fallback', 'research'];
	}

	let lastError = null;

	// Iterate through the determined sequence
	for (const currentRole of sequence) {
		// Removed the complex conditional check, as the sequence is now pre-determined

		log('info', `Attempting service call with role: ${currentRole}`);
		let client;
		try {
			client = await getClient(currentRole, session, overrideOptions);
			const clientInfo = {
				provider: client?.provider || 'unknown',
				model: client?.modelId || client?.model || 'unknown'
			};
			log('info', 'Retrieved AI client', clientInfo);

			// Attempt the API call with retries using the helper
			const result = await _attemptApiCallWithRetries(
				client,
				generateText,
				generateTextParams,
				currentRole
			);
			log('info', `generateTextService succeeded using role: ${currentRole}`); // Add success log
			return result; // Success!
		} catch (error) {
			log(
				'error', // Log as error since this role attempt failed
				`Service call failed for role ${currentRole}: ${error.message}`
			);
			lastError = error; // Store the error to throw if all roles in sequence fail

			// Log the reason for moving to the next role
			if (!client) {
				log(
					'warn',
					`Could not get client for role ${currentRole}, trying next role in sequence...`
				);
			} else {
				// Error happened during API call after client was retrieved
				log(
					'warn',
					`Retries exhausted or non-retryable error for role ${currentRole}, trying next role in sequence...`
				);
			}
			// Continue to the next role in the sequence automatically
		}
	}

	// If loop completes, all roles in the sequence failed
	log('error', `All roles in the sequence [${sequence.join(', ')}] failed.`);
	throw (
		lastError ||
		new Error(
			'AI service call failed for all configured roles in the sequence.'
		)
	);
}

// TODO: Implement streamTextService, generateObjectService etc.

/**
 * Unified service function for streaming text.
 * Handles client retrieval, retries, and fallback sequence.
 *
 * @param {object} params - Parameters for the service call.
 * @param {string} params.role - The initial client role ('main', 'research', 'fallback').
 * @param {object} [params.session=null] - Optional MCP session object.
 * @param {object} [params.overrideOptions={}] - Optional overrides for ai-client-factory.
 * @param {string} params.prompt - The prompt for the AI.
 * // ... include other standard streamText options as needed ...
 * @returns {Promise<object>} The result from the AI SDK's streamText function (typically a Streamable object).
 */
async function streamTextService(params) {
	const {
		role: initialRole,
		session,
		overrideOptions,
		...streamTextParams // Collect remaining params for streamText
	} = params;
	log('info', 'streamTextService called', { role: initialRole });

	let sequence;
	if (initialRole === 'main') {
		sequence = ['main', 'fallback', 'research'];
	} else if (initialRole === 'fallback') {
		sequence = ['fallback', 'research'];
	} else if (initialRole === 'research') {
		sequence = ['research', 'fallback'];
	} else {
		log(
			'warn',
			`Unknown initial role: ${initialRole}. Defaulting to main -> fallback -> research sequence.`
		);
		sequence = ['main', 'fallback', 'research'];
	}

	let lastError = null;

	for (const currentRole of sequence) {
		log('info', `Attempting service call with role: ${currentRole}`);
		let client;
		try {
			client = await getClient(currentRole, session, overrideOptions);
			const clientInfo = {
				provider: client?.provider || 'unknown',
				model: client?.modelId || client?.model || 'unknown'
			};
			log('info', 'Retrieved AI client', clientInfo);

			const result = await _attemptApiCallWithRetries(
				client,
				streamText, // Pass streamText function
				streamTextParams,
				currentRole
			);
			log('info', `streamTextService succeeded using role: ${currentRole}`);
			return result;
		} catch (error) {
			log(
				'error',
				`Service call failed for role ${currentRole}: ${error.message}`
			);
			lastError = error;

			if (!client) {
				log(
					'warn',
					`Could not get client for role ${currentRole}, trying next role in sequence...`
				);
			} else {
				log(
					'warn',
					`Retries exhausted or non-retryable error for role ${currentRole}, trying next role in sequence...`
				);
			}
		}
	}

	log('error', `All roles in the sequence [${sequence.join(', ')}] failed.`);
	throw (
		lastError ||
		new Error(
			'AI service call (streamText) failed for all configured roles in the sequence.'
		)
	);
}

/**
 * Unified service function for generating structured objects.
 * Handles client retrieval, retries, and fallback sequence.
 *
 * @param {object} params - Parameters for the service call.
 * @param {string} params.role - The initial client role ('main', 'research', 'fallback').
 * @param {object} [params.session=null] - Optional MCP session object.
 * @param {object} [params.overrideOptions={}] - Optional overrides for ai-client-factory.
 * @param {z.Schema} params.schema - The Zod schema for the expected object.
 * @param {string} params.prompt - The prompt for the AI.
 * // ... include other standard generateObject options as needed ...
 * @returns {Promise<object>} The result from the AI SDK's generateObject function.
 */
async function generateObjectService(params) {
	const {
		role: initialRole,
		session,
		overrideOptions,
		...generateObjectParams // Collect remaining params for generateObject
	} = params;
	log('info', 'generateObjectService called', { role: initialRole });

	let sequence;
	if (initialRole === 'main') {
		sequence = ['main', 'fallback', 'research'];
	} else if (initialRole === 'fallback') {
		sequence = ['fallback', 'research'];
	} else if (initialRole === 'research') {
		sequence = ['research', 'fallback'];
	} else {
		log(
			'warn',
			`Unknown initial role: ${initialRole}. Defaulting to main -> fallback -> research sequence.`
		);
		sequence = ['main', 'fallback', 'research'];
	}

	let lastError = null;

	for (const currentRole of sequence) {
		log('info', `Attempting service call with role: ${currentRole}`);
		let client;
		try {
			client = await getClient(currentRole, session, overrideOptions);
			const clientInfo = {
				provider: client?.provider || 'unknown',
				model: client?.modelId || client?.model || 'unknown'
			};
			log('info', 'Retrieved AI client', clientInfo);

			const result = await _attemptApiCallWithRetries(
				client,
				generateObject, // Pass generateObject function
				generateObjectParams,
				currentRole
			);
			log('info', `generateObjectService succeeded using role: ${currentRole}`);
			return result;
		} catch (error) {
			log(
				'error',
				`Service call failed for role ${currentRole}: ${error.message}`
			);
			lastError = error;

			if (!client) {
				log(
					'warn',
					`Could not get client for role ${currentRole}, trying next role in sequence...`
				);
			} else {
				log(
					'warn',
					`Retries exhausted or non-retryable error for role ${currentRole}, trying next role in sequence...`
				);
			}
		}
	}

	log('error', `All roles in the sequence [${sequence.join(', ')}] failed.`);
	throw (
		lastError ||
		new Error(
			'AI service call (generateObject) failed for all configured roles in the sequence.'
		)
	);
}

export { generateTextService, streamTextService, generateObjectService };
