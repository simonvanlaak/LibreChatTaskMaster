import fs from 'fs';
import path from 'path';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import { createPerplexity } from '@ai-sdk/perplexity';
import { createOllama } from 'ollama-ai-provider';
import { createMistral } from '@ai-sdk/mistral';
import { createAzure } from '@ai-sdk/azure';
import { createXai } from '@ai-sdk/xai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
// TODO: Add imports for other supported providers like OpenRouter, Grok

import {
	getProviderAndModelForRole,
	findProjectRoot // Assuming config-manager exports this
} from './config-manager.js';

const clientCache = new Map();

// Using a Symbol for a unique, unmistakable value
const VALIDATION_SKIPPED = Symbol('validation_skipped');

// --- Load Supported Models Data (Lazily) ---
let supportedModelsData = null;
let modelsDataLoaded = false;

function loadSupportedModelsData() {
	console.log(
		`DEBUG: loadSupportedModelsData called. modelsDataLoaded=${modelsDataLoaded}`
	);
	if (modelsDataLoaded) {
		console.log('DEBUG: Returning cached supported models data.');
		return supportedModelsData;
	}
	try {
		const projectRoot = findProjectRoot(process.cwd());
		const supportedModelsPath = path.join(
			projectRoot,
			'data',
			'supported-models.json'
		);
		console.log(
			`DEBUG: Checking for supported models at: ${supportedModelsPath}`
		);
		const exists = fs.existsSync(supportedModelsPath);
		console.log(`DEBUG: fs.existsSync result: ${exists}`);

		if (exists) {
			const fileContent = fs.readFileSync(supportedModelsPath, 'utf-8');
			supportedModelsData = JSON.parse(fileContent);
			console.log(
				'DEBUG: Successfully loaded and parsed supported-models.json'
			);
		} else {
			console.warn(
				`Warning: Could not find supported models file at ${supportedModelsPath}. Skipping model validation.`
			);
			supportedModelsData = {}; // Treat as empty if not found, allowing skip
		}
	} catch (error) {
		console.error(
			`Error loading or parsing supported models file: ${error.message}`
		);
		console.error('Stack Trace:', error.stack);
		supportedModelsData = {}; // Treat as empty on error, allowing skip
	}
	modelsDataLoaded = true;
	console.log(
		`DEBUG: Setting modelsDataLoaded=true, returning: ${JSON.stringify(supportedModelsData)}`
	);
	return supportedModelsData;
}

/**
 * Validates if a model is supported for a given provider and role.
 * @param {string} providerName - The name of the provider.
 * @param {string} modelId - The ID of the model.
 * @param {string} role - The role ('main', 'research', 'fallback').
 * @returns {boolean|Symbol} True if valid, false if invalid, VALIDATION_SKIPPED if data was missing.
 */
function isModelSupportedAndAllowed(providerName, modelId, role) {
	const modelsData = loadSupportedModelsData();

	if (
		!modelsData ||
		typeof modelsData !== 'object' ||
		Object.keys(modelsData).length === 0
	) {
		console.warn(
			'Skipping model validation as supported models data is unavailable or invalid.'
		);
		// Return the specific symbol instead of true
		return VALIDATION_SKIPPED;
	}

	// Ensure consistent casing for provider lookup
	const providerKey = providerName?.toLowerCase();
	if (!providerKey || !modelsData.hasOwnProperty(providerKey)) {
		console.warn(
			`Provider '${providerName}' not found in supported-models.json.`
		);
		return false;
	}

	const providerModels = modelsData[providerKey];
	if (!Array.isArray(providerModels)) {
		console.warn(
			`Invalid format for provider '${providerName}' models in supported-models.json. Expected an array.`
		);
		return false;
	}

	const modelInfo = providerModels.find((m) => m && m.id === modelId);
	if (!modelInfo) {
		console.warn(
			`Model '${modelId}' not found for provider '${providerName}' in supported-models.json.`
		);
		return false;
	}

	// Check if the role is allowed for this model
	if (!Array.isArray(modelInfo.allowed_roles)) {
		console.warn(
			`Model '${modelId}' (Provider: '${providerName}') has invalid or missing 'allowed_roles' array in supported-models.json.`
		);
		return false;
	}

	const isAllowed = modelInfo.allowed_roles.includes(role);
	if (!isAllowed) {
		console.warn(
			`Role '${role}' is not allowed for model '${modelId}' (Provider: '${providerName}'). Allowed roles: ${modelInfo.allowed_roles.join(', ')}`
		);
	}
	return isAllowed;
}

/**
 * Resolves an environment variable by checking process.env first, then session.env.
 * @param {string} varName - The name of the environment variable.
 * @param {object|null} session - The MCP session object (optional).
 * @returns {string|undefined} The value of the environment variable or undefined if not found.
 */
function resolveEnvVariable(varName, session) {
	return process.env[varName] ?? session?.env?.[varName];
}

/**
 * Validates if the required environment variables are set for a given provider,
 * checking process.env and falling back to session.env.
 * Throws an error if any required variable is missing.
 * @param {string} providerName - The name of the provider (e.g., 'openai', 'anthropic').
 * @param {object|null} session - The MCP session object (optional).
 */
function validateEnvironment(providerName, session) {
	// Define requirements based on the provider
	const requirements = {
		openai: ['OPENAI_API_KEY'],
		anthropic: ['ANTHROPIC_API_KEY'],
		google: ['GOOGLE_API_KEY'],
		perplexity: ['PERPLEXITY_API_KEY'],
		ollama: ['OLLAMA_BASE_URL'], // Ollama only needs Base URL typically
		mistral: ['MISTRAL_API_KEY'],
		azure: ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT'],
		openrouter: ['OPENROUTER_API_KEY'],
		xai: ['XAI_API_KEY']
		// Add requirements for other providers
	};

	const providerKey = providerName?.toLowerCase();
	if (!providerKey || !requirements[providerKey]) {
		// If the provider itself isn't in our requirements list, we can't validate.
		// This might happen if config has an unsupported provider. Validation should happen earlier.
		// Or, we could throw an error here if the provider is unknown.
		console.warn(
			`Cannot validate environment for unknown or unsupported provider: ${providerName}`
		);
		return; // Proceed without validation for unknown providers
	}

	const missing =
		requirements[providerKey]?.filter(
			(envVar) => !resolveEnvVariable(envVar, session)
		) || [];

	if (missing.length > 0) {
		throw new Error(
			`Missing environment variables for provider '${providerName}': ${missing.join(', ')}. Please check your .env file or session configuration.`
		);
	}
}

/**
 * Creates an AI client instance for the specified provider.
 * Assumes environment validation has already passed.
 * @param {string} providerName - The name of the provider.
 * @param {object|null} session - The MCP session object (optional).
 * @param {object} [options={}] - Additional options for the client creation (e.g., model).
 * @returns {object} The created AI client instance.
 * @throws {Error} If the provider is unsupported.
 */
function createClientInstance(providerName, session, options = {}) {
	// Validation is now done before calling this function
	const getEnv = (varName) => resolveEnvVariable(varName, session);

	switch (providerName?.toLowerCase()) {
		case 'openai':
			return createOpenAI({ apiKey: getEnv('OPENAI_API_KEY'), ...options });
		case 'anthropic':
			return createAnthropic({
				apiKey: getEnv('ANTHROPIC_API_KEY'),
				...options
			});
		case 'google':
			return createGoogle({ apiKey: getEnv('GOOGLE_API_KEY'), ...options });
		case 'perplexity':
			return createPerplexity({
				apiKey: getEnv('PERPLEXITY_API_KEY'),
				...options
			});
		case 'ollama':
			const ollamaBaseUrl =
				getEnv('OLLAMA_BASE_URL') || 'http://localhost:11434/api'; // Default from ollama-ai-provider docs
			// ollama-ai-provider uses baseURL directly
			return createOllama({ baseURL: ollamaBaseUrl, ...options });
		case 'mistral':
			return createMistral({ apiKey: getEnv('MISTRAL_API_KEY'), ...options });
		case 'azure':
			return createAzure({
				apiKey: getEnv('AZURE_OPENAI_API_KEY'),
				endpoint: getEnv('AZURE_OPENAI_ENDPOINT'),
				...(options.model && { deploymentName: options.model }), // Azure often uses deployment name
				...options
			});
		case 'openrouter':
			return createOpenRouter({
				apiKey: getEnv('OPENROUTER_API_KEY'),
				...options
			});
		case 'xai':
			return createXai({ apiKey: getEnv('XAI_API_KEY'), ...options });
		// TODO: Add cases for OpenRouter, Grok
		default:
			throw new Error(`Unsupported AI provider specified: ${providerName}`);
	}
}

/**
 * Gets or creates an AI client instance based on the configured model for a specific role.
 * Validates the configured model against supported models and role allowances.
 * @param {string} role - The role ('main', 'research', or 'fallback').
 * @param {object|null} [session=null] - The MCP session object (optional).
 * @param {object} [overrideOptions={}] - Optional overrides for { provider, modelId }.
 * @returns {object} The cached or newly created AI client instance.
 * @throws {Error} If configuration is missing, invalid, or environment validation fails.
 */
export function getClient(role, session = null, overrideOptions = {}) {
	if (!role) {
		throw new Error(
			`Client role ('main', 'research', 'fallback') must be specified.`
		);
	}

	// 1. Determine Provider and Model ID
	let providerName = overrideOptions.provider;
	let modelId = overrideOptions.modelId;

	if (!providerName || !modelId) {
		// If not fully overridden, get from config
		try {
			const config = getProviderAndModelForRole(role); // Fetch from config manager
			providerName = providerName || config.provider;
			modelId = modelId || config.modelId;
		} catch (configError) {
			throw new Error(
				`Failed to get configuration for role '${role}': ${configError.message}`
			);
		}
	}

	if (!providerName || !modelId) {
		throw new Error(
			`Could not determine provider or modelId for role '${role}' from configuration or overrides.`
		);
	}

	// 2. Validate Provider/Model Combination and Role Allowance
	const validationResult = isModelSupportedAndAllowed(
		providerName,
		modelId,
		role
	);

	// Only throw if validation explicitly returned false (meaning invalid/disallowed)
	// If it returned VALIDATION_SKIPPED, we proceed but skip strict validation.
	if (validationResult === false) {
		throw new Error(
			`Model '${modelId}' from provider '${providerName}' is either not supported or not allowed for the '${role}' role. Check supported-models.json and your .taskmasterconfig.`
		);
	}
	// Note: If validationResult === VALIDATION_SKIPPED, we continue to env validation

	// 3. Validate Environment Variables for the chosen provider
	try {
		validateEnvironment(providerName, session);
	} catch (envError) {
		// Re-throw the original environment error for clearer test messages
		throw envError;
	}

	// 4. Check Cache
	const cacheKey = `${providerName.toLowerCase()}:${modelId}`;
	if (clientCache.has(cacheKey)) {
		return clientCache.get(cacheKey);
	}

	// 5. Create New Client Instance
	console.log(
		`Creating new client for role '${role}': Provider=${providerName}, Model=${modelId}`
	);
	try {
		const clientInstance = createClientInstance(providerName, session, {
			model: modelId
		});

		clientCache.set(cacheKey, clientInstance);
		return clientInstance;
	} catch (creationError) {
		throw new Error(
			`Failed to create client instance for provider '${providerName}' (role: '${role}'): ${creationError.message}`
		);
	}
}

// Optional: Function to clear the cache if needed
export function clearClientCache() {
	clientCache.clear();
	console.log('AI client cache cleared.');
}

// Exported for testing purposes only
export function _resetSupportedModelsCache() {
	console.log('DEBUG: Resetting supported models cache...');
	supportedModelsData = null;
	modelsDataLoaded = false;
	console.log('DEBUG: Supported models cache reset.');
}
