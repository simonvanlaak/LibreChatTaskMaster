import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { ZodError } from 'zod';
import {
	log,
	readJSON,
	writeJSON,
	resolveEnvVariable,
	findProjectRoot
} from './utils.js';

// Calculate __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load supported models from JSON file using the calculated __dirname
let MODEL_MAP;
try {
	const supportedModelsRaw = fs.readFileSync(
		path.join(__dirname, 'supported-models.json'),
		'utf-8'
	);
	MODEL_MAP = JSON.parse(supportedModelsRaw);
} catch (error) {
	console.error(
		chalk.red(
			'FATAL ERROR: Could not load supported-models.json. Please ensure the file exists and is valid JSON.'
		),
		error
	);
	MODEL_MAP = {}; // Default to empty map on error to avoid crashing, though functionality will be limited
	process.exit(1); // Exit if models can't be loaded
}

const CONFIG_FILE_NAME = '.taskmasterconfig';

// Define valid providers dynamically from the loaded MODEL_MAP
const VALID_PROVIDERS = Object.keys(MODEL_MAP);

// Default configuration values (used if .taskmasterconfig is missing or incomplete)
const DEFAULTS = {
	models: {
		main: {
			provider: 'anthropic',
			modelId: 'claude-3-7-sonnet-20250219',
			maxTokens: 64000,
			temperature: 0.2
		},
		research: {
			provider: 'perplexity',
			modelId: 'sonar-pro',
			maxTokens: 8700,
			temperature: 0.1
		},
		fallback: {
			// No default fallback provider/model initially
			provider: 'anthropic',
			modelId: 'claude-3-5-sonnet',
			maxTokens: 64000, // Default parameters if fallback IS configured
			temperature: 0.2
		}
	},
	global: {
		logLevel: 'info',
		debug: false,
		defaultSubtasks: 5,
		defaultPriority: 'medium',
		projectName: 'Task Master',
		ollamaBaseUrl: 'http://localhost:11434/api'
	}
};

// --- Internal Config Loading ---
let loadedConfig = null; // Cache for loaded config

function _loadAndValidateConfig(explicitRoot = null) {
	// Determine the root path to use
	const rootToUse = explicitRoot || findProjectRoot();
	const defaults = DEFAULTS; // Use the defined defaults

	if (!rootToUse) {
		console.warn(
			chalk.yellow(
				'Warning: Could not determine project root. Using default configuration.'
			)
		);
		return defaults;
	}
	const configPath = path.join(rootToUse, CONFIG_FILE_NAME);

	if (fs.existsSync(configPath)) {
		try {
			const rawData = fs.readFileSync(configPath, 'utf-8');
			const parsedConfig = JSON.parse(rawData);

			// Deep merge with defaults
			const config = {
				models: {
					main: { ...defaults.models.main, ...parsedConfig?.models?.main },
					research: {
						...defaults.models.research,
						...parsedConfig?.models?.research
					},
					// Fallback needs careful merging - only merge if provider/model exist
					fallback:
						parsedConfig?.models?.fallback?.provider &&
						parsedConfig?.models?.fallback?.modelId
							? { ...defaults.models.fallback, ...parsedConfig.models.fallback }
							: { ...defaults.models.fallback } // Use default params even if provider/model missing
				},
				global: { ...defaults.global, ...parsedConfig?.global }
			};

			// --- Validation ---
			// Validate main provider/model
			if (!validateProvider(config.models.main.provider)) {
				console.warn(
					chalk.yellow(
						`Warning: Invalid main provider "${config.models.main.provider}" in ${CONFIG_FILE_NAME}. Falling back to default.`
					)
				);
				config.models.main = { ...defaults.models.main };
			}
			// Optional: Add warning for model combination if desired

			// Validate research provider/model
			if (!validateProvider(config.models.research.provider)) {
				console.warn(
					chalk.yellow(
						`Warning: Invalid research provider "${config.models.research.provider}" in ${CONFIG_FILE_NAME}. Falling back to default.`
					)
				);
				config.models.research = { ...defaults.models.research };
			}
			// Optional: Add warning for model combination if desired

			// Validate fallback provider if it exists
			if (
				config.models.fallback?.provider &&
				!validateProvider(config.models.fallback.provider)
			) {
				console.warn(
					chalk.yellow(
						`Warning: Invalid fallback provider "${config.models.fallback.provider}" in ${CONFIG_FILE_NAME}. Fallback model configuration will be ignored.`
					)
				);
				// Clear invalid fallback provider/model, but keep default params if needed elsewhere
				config.models.fallback.provider = undefined;
				config.models.fallback.modelId = undefined;
			}

			return config;
		} catch (error) {
			console.error(
				chalk.red(
					`Error reading or parsing ${configPath}: ${error.message}. Using default configuration.`
				)
			);
			return defaults;
		}
	} else {
		// Config file doesn't exist, use defaults
		return defaults;
	}
}

/**
 * Gets the current configuration, loading it if necessary.
 * @param {string|null} explicitRoot - Optional explicit path to the project root.
 * @param {boolean} forceReload - Force reloading the config file.
 * @returns {object} The loaded configuration object.
 */
function getConfig(explicitRoot = null, forceReload = false) {
	if (!loadedConfig || forceReload) {
		loadedConfig = _loadAndValidateConfig(explicitRoot);
	}
	// If an explicitRoot was provided for a one-off check, don't cache it permanently
	if (explicitRoot && !forceReload) {
		return _loadAndValidateConfig(explicitRoot);
	}
	return loadedConfig;
}

/**
 * Validates if a provider name is in the list of supported providers.
 * @param {string} providerName The name of the provider.
 * @returns {boolean} True if the provider is valid, false otherwise.
 */
function validateProvider(providerName) {
	return VALID_PROVIDERS.includes(providerName);
}

/**
 * Optional: Validates if a modelId is known for a given provider based on MODEL_MAP.
 * This is a non-strict validation; an unknown model might still be valid.
 * @param {string} providerName The name of the provider.
 * @param {string} modelId The model ID.
 * @returns {boolean} True if the modelId is in the map for the provider, false otherwise.
 */
function validateProviderModelCombination(providerName, modelId) {
	// If provider isn't even in our map, we can't validate the model
	if (!MODEL_MAP[providerName]) {
		return true; // Allow unknown providers or those without specific model lists
	}
	// If the provider is known, check if the model is in its list OR if the list is empty (meaning accept any)
	return (
		MODEL_MAP[providerName].length === 0 ||
		// Use .some() to check the 'id' property of objects in the array
		MODEL_MAP[providerName].some((modelObj) => modelObj.id === modelId)
	);
}

// --- Role-Specific Getters ---

function getModelConfigForRole(role, explicitRoot = null) {
	const config = getConfig(explicitRoot);
	const roleConfig = config?.models?.[role];
	if (!roleConfig) {
		log('warn', `No model configuration found for role: ${role}`);
		return DEFAULTS.models[role] || {}; // Fallback to default for the role
	}
	return roleConfig;
}

function getMainProvider(explicitRoot = null) {
	return getModelConfigForRole('main', explicitRoot).provider;
}

function getMainModelId(explicitRoot = null) {
	return getModelConfigForRole('main', explicitRoot).modelId;
}

function getMainMaxTokens(explicitRoot = null) {
	return getModelConfigForRole('main', explicitRoot).maxTokens;
}

function getMainTemperature(explicitRoot = null) {
	return getModelConfigForRole('main', explicitRoot).temperature;
}

function getResearchProvider(explicitRoot = null) {
	return getModelConfigForRole('research', explicitRoot).provider;
}

function getResearchModelId(explicitRoot = null) {
	return getModelConfigForRole('research', explicitRoot).modelId;
}

function getResearchMaxTokens(explicitRoot = null) {
	return getModelConfigForRole('research', explicitRoot).maxTokens;
}

function getResearchTemperature(explicitRoot = null) {
	return getModelConfigForRole('research', explicitRoot).temperature;
}

function getFallbackProvider(explicitRoot = null) {
	// Specifically check if provider is set, as fallback is optional
	return getModelConfigForRole('fallback', explicitRoot).provider || undefined;
}

function getFallbackModelId(explicitRoot = null) {
	// Specifically check if modelId is set
	return getModelConfigForRole('fallback', explicitRoot).modelId || undefined;
}

function getFallbackMaxTokens(explicitRoot = null) {
	// Return fallback tokens even if provider/model isn't set, in case it's needed generically
	return getModelConfigForRole('fallback', explicitRoot).maxTokens;
}

function getFallbackTemperature(explicitRoot = null) {
	// Return fallback temp even if provider/model isn't set
	return getModelConfigForRole('fallback', explicitRoot).temperature;
}

// --- Global Settings Getters ---

function getGlobalConfig(explicitRoot = null) {
	const config = getConfig(explicitRoot);
	return config?.global || DEFAULTS.global;
}

function getLogLevel(explicitRoot = null) {
	return getGlobalConfig(explicitRoot).logLevel;
}

function getDebugFlag(explicitRoot = null) {
	// Ensure boolean type
	return getGlobalConfig(explicitRoot).debug === true;
}

function getDefaultSubtasks(explicitRoot = null) {
	// Ensure integer type
	return parseInt(getGlobalConfig(explicitRoot).defaultSubtasks, 10);
}

function getDefaultPriority(explicitRoot = null) {
	return getGlobalConfig(explicitRoot).defaultPriority;
}

function getProjectName(explicitRoot = null) {
	return getGlobalConfig(explicitRoot).projectName;
}

function getOllamaBaseUrl(explicitRoot = null) {
	return getGlobalConfig(explicitRoot).ollamaBaseUrl;
}

/**
 * Checks if the API key for a given provider is set in the environment.
 * Checks process.env first, then session.env if session is provided.
 * @param {string} providerName - The name of the provider (e.g., 'openai', 'anthropic').
 * @param {object|null} [session=null] - The MCP session object (optional).
 * @returns {boolean} True if the API key is set, false otherwise.
 */
function isApiKeySet(providerName, session = null) {
	// Define the expected environment variable name for each provider
	const keyMap = {
		openai: 'OPENAI_API_KEY',
		anthropic: 'ANTHROPIC_API_KEY',
		google: 'GOOGLE_API_KEY',
		perplexity: 'PERPLEXITY_API_KEY',
		grok: 'GROK_API_KEY', // Assuming GROK_API_KEY based on env.example
		mistral: 'MISTRAL_API_KEY',
		azure: 'AZURE_OPENAI_API_KEY', // Azure needs endpoint too, but key presence is a start
		openrouter: 'OPENROUTER_API_KEY',
		xai: 'XAI_API_KEY'
		// Add other providers as needed
	};

	const providerKey = providerName?.toLowerCase();
	if (!providerKey || !keyMap[providerKey]) {
		log('warn', `Unknown provider name: ${providerName} in isApiKeySet check.`);
		return false;
	}

	const envVarName = keyMap[providerKey];
	// Use resolveEnvVariable to check both process.env and session.env
	return !!resolveEnvVariable(envVarName, session);
}

/**
 * Checks the API key status within .cursor/mcp.json for a given provider.
 * Reads the mcp.json file, finds the taskmaster-ai server config, and checks the relevant env var.
 * @param {string} providerName The name of the provider.
 * @returns {boolean} True if the key exists and is not a placeholder, false otherwise.
 */
function getMcpApiKeyStatus(providerName) {
	const rootDir = findProjectRoot(); // Use existing root finding
	if (!rootDir) {
		console.warn(
			chalk.yellow('Warning: Could not find project root to check mcp.json.')
		);
		return false; // Cannot check without root
	}
	const mcpConfigPath = path.join(rootDir, '.cursor', 'mcp.json');

	if (!fs.existsSync(mcpConfigPath)) {
		// console.warn(chalk.yellow('Warning: .cursor/mcp.json not found.'));
		return false; // File doesn't exist
	}

	try {
		const mcpConfigRaw = fs.readFileSync(mcpConfigPath, 'utf-8');
		const mcpConfig = JSON.parse(mcpConfigRaw);

		const mcpEnv = mcpConfig?.mcpServers?.['taskmaster-ai']?.env;
		if (!mcpEnv) {
			// console.warn(chalk.yellow('Warning: Could not find taskmaster-ai env in mcp.json.'));
			return false; // Structure missing
		}

		let apiKeyToCheck = null;
		let placeholderValue = null;

		switch (providerName) {
			case 'anthropic':
				apiKeyToCheck = mcpEnv.ANTHROPIC_API_KEY;
				placeholderValue = 'YOUR_ANTHROPIC_API_KEY_HERE';
				break;
			case 'openai':
			case 'openrouter':
				apiKeyToCheck = mcpEnv.OPENAI_API_KEY;
				placeholderValue = 'YOUR_OPENAI_API_KEY_HERE'; // Assuming placeholder matches OPENAI
				break;
			case 'google':
				apiKeyToCheck = mcpEnv.GOOGLE_API_KEY;
				placeholderValue = 'YOUR_GOOGLE_API_KEY_HERE';
				break;
			case 'perplexity':
				apiKeyToCheck = mcpEnv.PERPLEXITY_API_KEY;
				placeholderValue = 'YOUR_PERPLEXITY_API_KEY_HERE';
				break;
			case 'grok':
			case 'xai':
				apiKeyToCheck = mcpEnv.GROK_API_KEY;
				placeholderValue = 'YOUR_GROK_API_KEY_HERE';
				break;
			case 'ollama':
				return true; // No key needed
			default:
				return false; // Unknown provider
		}

		return !!apiKeyToCheck && apiKeyToCheck !== placeholderValue;
	} catch (error) {
		console.error(
			chalk.red(`Error reading or parsing .cursor/mcp.json: ${error.message}`)
		);
		return false;
	}
}

/**
 * Gets a list of available models based on the MODEL_MAP.
 * @returns {Array<{id: string, name: string, provider: string, swe_score: number|null, cost_per_1m_tokens: {input: number|null, output: number|null}|null, allowed_roles: string[]}>}
 */
function getAvailableModels() {
	const available = [];
	for (const [provider, models] of Object.entries(MODEL_MAP)) {
		if (models.length > 0) {
			models.forEach((modelObj) => {
				// Basic name generation - can be improved
				const modelId = modelObj.id;
				const sweScore = modelObj.swe_score;
				const cost = modelObj.cost_per_1m_tokens;
				const allowedRoles = modelObj.allowed_roles || ['main', 'fallback'];
				const nameParts = modelId
					.split('-')
					.map((p) => p.charAt(0).toUpperCase() + p.slice(1));
				// Handle specific known names better if needed
				let name = nameParts.join(' ');
				if (modelId === 'claude-3.5-sonnet-20240620')
					name = 'Claude 3.5 Sonnet';
				if (modelId === 'claude-3-7-sonnet-20250219')
					name = 'Claude 3.7 Sonnet';
				if (modelId === 'gpt-4o') name = 'GPT-4o';
				if (modelId === 'gpt-4-turbo') name = 'GPT-4 Turbo';
				if (modelId === 'sonar-pro') name = 'Perplexity Sonar Pro';
				if (modelId === 'sonar-mini') name = 'Perplexity Sonar Mini';

				available.push({
					id: modelId,
					name: name,
					provider: provider,
					swe_score: sweScore,
					cost_per_1m_tokens: cost,
					allowed_roles: allowedRoles
				});
			});
		} else {
			// For providers with empty lists (like ollama), maybe add a placeholder or skip
			available.push({
				id: `[${provider}-any]`,
				name: `Any (${provider})`,
				provider: provider
			});
		}
	}
	return available;
}

/**
 * Writes the configuration object to the file.
 * @param {Object} config The configuration object to write.
 * @param {string|null} explicitRoot - Optional explicit path to the project root.
 * @returns {boolean} True if successful, false otherwise.
 */
function writeConfig(config, explicitRoot = null) {
	const rootPath = explicitRoot || findProjectRoot();
	if (!rootPath) {
		console.error(
			chalk.red(
				'Error: Could not determine project root. Configuration not saved.'
			)
		);
		return false;
	}
	const configPath =
		path.basename(rootPath) === CONFIG_FILE_NAME
			? rootPath
			: path.join(rootPath, CONFIG_FILE_NAME);

	try {
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
		loadedConfig = config; // Update the cache after successful write
		return true;
	} catch (error) {
		console.error(
			chalk.red(
				`Error writing configuration to ${configPath}: ${error.message}`
			)
		);
		return false;
	}
}

export {
	// Core config access
	getConfig, // Might still be useful for getting the whole object
	writeConfig,

	// Validation
	validateProvider,
	validateProviderModelCombination,
	VALID_PROVIDERS,
	MODEL_MAP,
	getAvailableModels,

	// Role-specific getters
	getMainProvider,
	getMainModelId,
	getMainMaxTokens,
	getMainTemperature,
	getResearchProvider,
	getResearchModelId,
	getResearchMaxTokens,
	getResearchTemperature,
	getFallbackProvider,
	getFallbackModelId,
	getFallbackMaxTokens,
	getFallbackTemperature,

	// Global setting getters
	getLogLevel,
	getDebugFlag,
	getDefaultSubtasks,
	getDefaultPriority,
	getProjectName,
	getOllamaBaseUrl,

	// API Key Checkers (still relevant)
	isApiKeySet,
	getMcpApiKeyStatus
};
