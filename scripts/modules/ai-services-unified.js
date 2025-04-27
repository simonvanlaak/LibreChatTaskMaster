/**
 * ai-services-unified.js
 * Centralized AI service layer using provider modules and config-manager.
 */

// Vercel AI SDK functions are NOT called directly anymore.
// import { generateText, streamText, generateObject } from 'ai';

// --- Core Dependencies ---
import {
	// REMOVED: getProviderAndModelForRole, // This was incorrect
	getMainProvider, // ADD individual getters
	getMainModelId,
	getResearchProvider,
	getResearchModelId,
	getFallbackProvider,
	getFallbackModelId,
	getParametersForRole
	// ConfigurationError // Import if needed for specific handling
} from './config-manager.js'; // Corrected: Removed getProviderAndModelForRole
import { log, resolveEnvVariable } from './utils.js';

// --- Provider Service Imports ---
// Corrected path from scripts/ai-providers/... to ../../src/ai-providers/...
import * as anthropic from '../../src/ai-providers/anthropic.js';
import * as perplexity from '../../src/ai-providers/perplexity.js';
import * as google from '../../src/ai-providers/google.js'; // Import Google provider
// TODO: Import other provider modules when implemented (openai, ollama, etc.)

// --- Provider Function Map ---
// Maps provider names (lowercase) to their respective service functions
const PROVIDER_FUNCTIONS = {
	anthropic: {
		generateText: anthropic.generateAnthropicText,
		streamText: anthropic.streamAnthropicText,
		generateObject: anthropic.generateAnthropicObject
		// streamObject: anthropic.streamAnthropicObject, // Add when implemented
	},
	perplexity: {
		generateText: perplexity.generatePerplexityText,
		streamText: perplexity.streamPerplexityText,
		generateObject: perplexity.generatePerplexityObject
		// streamObject: perplexity.streamPerplexityObject, // Add when implemented
	},
	google: {
		// Add Google entry
		generateText: google.generateGoogleText,
		streamText: google.streamGoogleText,
		generateObject: google.generateGoogleObject
	}
	// TODO: Add entries for openai, ollama, etc. when implemented
};

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
 * Internal helper to resolve the API key for a given provider.
 * @param {string} providerName - The name of the provider (lowercase).
 * @param {object|null} session - Optional MCP session object.
 * @returns {string|null} The API key or null if not found/needed.
 * @throws {Error} If a required API key is missing.
 */
function _resolveApiKey(providerName, session) {
	const keyMap = {
		openai: 'OPENAI_API_KEY',
		anthropic: 'ANTHROPIC_API_KEY',
		google: 'GOOGLE_API_KEY', // Add Google API Key
		perplexity: 'PERPLEXITY_API_KEY',
		mistral: 'MISTRAL_API_KEY',
		azure: 'AZURE_OPENAI_API_KEY',
		openrouter: 'OPENROUTER_API_KEY',
		xai: 'XAI_API_KEY',
		ollama: 'OLLAMA_API_KEY'
	};

	// Double check this -- I have had to use an api key for ollama in the past
	// if (providerName === 'ollama') {
	// 	return null; // Ollama typically doesn't require an API key for basic setup
	// }

	const envVarName = keyMap[providerName];
	if (!envVarName) {
		throw new Error(
			`Unknown provider '${providerName}' for API key resolution.`
		);
	}

	const apiKey = resolveEnvVariable(envVarName, session);
	if (!apiKey) {
		throw new Error(
			`Required API key ${envVarName} for provider '${providerName}' is not set in environment or session.`
		);
	}
	return apiKey;
}

/**
 * Internal helper to attempt a provider-specific AI API call with retries.
 *
 * @param {function} providerApiFn - The specific provider function to call (e.g., generateAnthropicText).
 * @param {object} callParams - Parameters object for the provider function.
 * @param {string} providerName - Name of the provider (for logging).
 * @param {string} modelId - Specific model ID (for logging).
 * @param {string} attemptRole - The role being attempted (for logging).
 * @returns {Promise<object>} The result from the successful API call.
 * @throws {Error} If the call fails after all retries.
 */
async function _attemptProviderCallWithRetries(
	providerApiFn,
	callParams,
	providerName,
	modelId,
	attemptRole
) {
	let retries = 0;
	const fnName = providerApiFn.name; // Get function name for logging

	while (retries <= MAX_RETRIES) {
		try {
			log(
				'info',
				`Attempt ${retries + 1}/${MAX_RETRIES + 1} calling ${fnName} (Provider: ${providerName}, Model: ${modelId}, Role: ${attemptRole})`
			);

			// Call the specific provider function directly
			const result = await providerApiFn(callParams);

			log(
				'info',
				`${fnName} succeeded for role ${attemptRole} (Provider: ${providerName}) on attempt ${retries + 1}`
			);
			return result; // Success!
		} catch (error) {
			log(
				'warn',
				`Attempt ${retries + 1} failed for role ${attemptRole} (${fnName} / ${providerName}): ${error.message}`
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
					`Non-retryable error or max retries reached for role ${attemptRole} (${fnName} / ${providerName}).`
				);
				throw error; // Final failure for this attempt chain
			}
		}
	}
	// Should not be reached due to throw in the else block
	throw new Error(
		`Exhausted all retries for role ${attemptRole} (${fnName} / ${providerName})`
	);
}

/**
 * Base logic for unified service functions.
 * @param {string} serviceType - Type of service ('generateText', 'streamText', 'generateObject').
 * @param {object} params - Original parameters passed to the service function.
 * @returns {Promise<any>} Result from the underlying provider call.
 */
async function _unifiedServiceRunner(serviceType, params) {
	const {
		role: initialRole,
		session,
		systemPrompt,
		prompt,
		schema,
		objectName,
		...restApiParams
	} = params;
	log('info', `${serviceType}Service called`, { role: initialRole });

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
		let providerName, modelId, apiKey, roleParams, providerFnSet, providerApiFn;

		try {
			log('info', `New AI service call with role: ${currentRole}`);

			// --- Corrected Config Fetching ---
			// 1. Get Config: Provider, Model, Parameters for the current role
			// Call individual getters based on the current role
			if (currentRole === 'main') {
				providerName = getMainProvider(); // Use individual getter
				modelId = getMainModelId(); // Use individual getter
			} else if (currentRole === 'research') {
				providerName = getResearchProvider(); // Use individual getter
				modelId = getResearchModelId(); // Use individual getter
			} else if (currentRole === 'fallback') {
				providerName = getFallbackProvider(); // Use individual getter
				modelId = getFallbackModelId(); // Use individual getter
			} else {
				log(
					'error',
					`Unknown role encountered in _unifiedServiceRunner: ${currentRole}`
				);
				lastError =
					lastError || new Error(`Unknown AI role specified: ${currentRole}`);
				continue; // Skip to the next role attempt
			}
			// --- End Corrected Config Fetching ---

			if (!providerName || !modelId) {
				log(
					'warn',
					`Skipping role '${currentRole}': Provider or Model ID not configured.`
				);
				lastError =
					lastError ||
					new Error(
						`Configuration missing for role '${currentRole}'. Provider: ${providerName}, Model: ${modelId}`
					);
				continue; // Skip to the next role
			}

			roleParams = getParametersForRole(currentRole); // Get { maxTokens, temperature }

			// 2. Get Provider Function Set
			providerFnSet = PROVIDER_FUNCTIONS[providerName?.toLowerCase()];
			if (!providerFnSet) {
				log(
					'warn',
					`Skipping role '${currentRole}': Provider '${providerName}' not supported or map entry missing.`
				);
				lastError =
					lastError ||
					new Error(`Unsupported provider configured: ${providerName}`);
				continue;
			}

			// Use the original service type to get the function
			providerApiFn = providerFnSet[serviceType];
			if (typeof providerApiFn !== 'function') {
				log(
					'warn',
					`Skipping role '${currentRole}': Service type '${serviceType}' not implemented for provider '${providerName}'.`
				);
				lastError =
					lastError ||
					new Error(
						`Service '${serviceType}' not implemented for provider ${providerName}`
					);
				continue;
			}

			// 3. Resolve API Key (will throw if required and missing)
			apiKey = _resolveApiKey(providerName?.toLowerCase(), session); // Throws on failure

			// 4. Construct Messages Array
			const messages = [];
			if (systemPrompt) {
				messages.push({ role: 'system', content: systemPrompt });
			}

			// IN THE FUTURE WHEN DOING CONTEXT IMPROVEMENTS
			// {
			//     type: 'text',
			//     text: 'Large cached context here like a tasks json',
			//     providerOptions: {
			//       anthropic: { cacheControl: { type: 'ephemeral' } }
			//     }
			//   }

			// Example
			// if (params.context) { // context is a json string of a tasks object or some other stu
			//     messages.push({
			//         type: 'text',
			//         text: params.context,
			//         providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }
			//     });
			// }

			if (prompt) {
				// Ensure prompt exists before adding
				messages.push({ role: 'user', content: prompt });
			} else {
				// Throw an error if the prompt is missing, as it's essential
				throw new Error('User prompt content is missing.');
			}

			// 5. Prepare call parameters (using messages array)
			const callParams = {
				apiKey,
				modelId,
				maxTokens: roleParams.maxTokens,
				temperature: roleParams.temperature,
				messages, // *** Pass the constructed messages array ***
				// Add specific params for generateObject if needed
				...(serviceType === 'generateObject' && { schema, objectName }),
				...restApiParams // Include other params like maxRetries
			};

			// 6. Attempt the call with retries
			const result = await _attemptProviderCallWithRetries(
				providerApiFn,
				callParams,
				providerName,
				modelId,
				currentRole
			);

			log('info', `${serviceType}Service succeeded using role: ${currentRole}`);

			return result; // Return original result for other cases
		} catch (error) {
			log(
				'error', // Log as error since this role attempt failed
				`Service call failed for role ${currentRole} (Provider: ${providerName || 'unknown'}): ${error.message}`
			);
			lastError = error; // Store the error to throw if all roles fail
			// Log reason and continue (handled within the loop now)
		}
	}

	// If loop completes, all roles failed
	log('error', `All roles in the sequence [${sequence.join(', ')}] failed.`);
	throw (
		lastError ||
		new Error(
			`AI service call (${serviceType}) failed for all configured roles in the sequence.`
		)
	);
}

/**
 * Unified service function for generating text.
 * Handles client retrieval, retries, and fallback sequence.
 *
 * @param {object} params - Parameters for the service call.
 * @param {string} params.role - The initial client role ('main', 'research', 'fallback').
 * @param {object} [params.session=null] - Optional MCP session object.
 * @param {string} params.prompt - The prompt for the AI.
 * @param {string} [params.systemPrompt] - Optional system prompt.
 * // Other specific generateText params can be included here.
 * @returns {Promise<string>} The generated text content.
 */
async function generateTextService(params) {
	// Now directly returns the text string or throws error
	return _unifiedServiceRunner('generateText', params);
}

/**
 * Unified service function for streaming text.
 * Handles client retrieval, retries, and fallback sequence.
 *
 * @param {object} params - Parameters for the service call.
 * @param {string} params.role - The initial client role ('main', 'research', 'fallback').
 * @param {object} [params.session=null] - Optional MCP session object.
 * @param {string} params.prompt - The prompt for the AI.
 * @param {string} [params.systemPrompt] - Optional system prompt.
 * // Other specific streamText params can be included here.
 * @returns {Promise<ReadableStream<string>>} A readable stream of text deltas.
 */
async function streamTextService(params) {
	// Now directly returns the stream object or throws error
	return _unifiedServiceRunner('streamText', params);
}

/**
 * Unified service function for generating structured objects.
 * Handles client retrieval, retries, and fallback sequence.
 *
 * @param {object} params - Parameters for the service call.
 * @param {string} params.role - The initial client role ('main', 'research', 'fallback').
 * @param {object} [params.session=null] - Optional MCP session object.
 * @param {import('zod').ZodSchema} params.schema - The Zod schema for the expected object.
 * @param {string} params.prompt - The prompt for the AI.
 * @param {string} [params.systemPrompt] - Optional system prompt.
 * @param {string} [params.objectName='generated_object'] - Name for object/tool.
 * @param {number} [params.maxRetries=3] - Max retries for object generation.
 * // Other specific generateObject params can be included here.
 * @returns {Promise<object>} The generated object matching the schema.
 */
async function generateObjectService(params) {
	const defaults = {
		objectName: 'generated_object',
		maxRetries: 3
	};
	const combinedParams = { ...defaults, ...params };
	// Now directly returns the generated object or throws error
	return _unifiedServiceRunner('generateObject', combinedParams);
}

export { generateTextService, streamTextService, generateObjectService };
