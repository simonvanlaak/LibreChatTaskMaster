import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

const CONFIG_FILE_NAME = '.taskmasterconfig';

// Default configuration
const DEFAULT_MAIN_PROVIDER = 'anthropic';
const DEFAULT_MAIN_MODEL_ID = 'claude-3.7-sonnet-20250219';
const DEFAULT_RESEARCH_PROVIDER = 'perplexity';
const DEFAULT_RESEARCH_MODEL_ID = 'sonar-pro';

// Define ONE list of all supported providers
const VALID_PROVIDERS = [
	'anthropic',
	'openai',
	'google',
	'perplexity',
	'ollama',
	'openrouter',
	'grok'
];

// Optional: Define known models per provider primarily for informational display or non-blocking warnings
const MODEL_MAP = {
	anthropic: ['claude-3.5-sonnet-20240620', 'claude-3-7-sonnet-20250219'],
	openai: ['gpt-4o', 'gpt-4-turbo'],
	google: ['gemini-2.5-pro-latest', 'gemini-1.5-flash-latest'],
	perplexity: ['sonar-pro', 'sonar-mini'],
	ollama: [], // Users configure specific Ollama models locally
	openrouter: [], // Users specify model string
	grok: [] // Specify Grok model if known
};

let projectRoot = null;

function findProjectRoot() {
	// Keep this function as is for CLI context
	if (projectRoot) return projectRoot;

	let currentDir = process.cwd();
	while (currentDir !== path.parse(currentDir).root) {
		if (fs.existsSync(path.join(currentDir, 'package.json'))) {
			projectRoot = currentDir;
			return projectRoot;
		}
		currentDir = path.dirname(currentDir);
	}

	// Check root directory as a last resort
	if (fs.existsSync(path.join(currentDir, 'package.json'))) {
		projectRoot = currentDir;
		return projectRoot;
	}

	// If still not found, maybe look for other markers or return null
	// For now, returning null if package.json isn't found up to the root
	projectRoot = null;
	return null;
}

function readConfig(explicitRoot = null) {
	// Determine the root path to use
	const rootToUse = explicitRoot || findProjectRoot();

	const defaults = {
		models: {
			main: { provider: DEFAULT_MAIN_PROVIDER, modelId: DEFAULT_MAIN_MODEL_ID },
			research: {
				provider: DEFAULT_RESEARCH_PROVIDER,
				modelId: DEFAULT_RESEARCH_MODEL_ID
			}
		}
	};

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

			// Deep merge defaults to ensure structure and handle partial configs
			const config = {
				models: {
					main: {
						provider:
							parsedConfig?.models?.main?.provider ??
							defaults.models.main.provider,
						modelId:
							parsedConfig?.models?.main?.modelId ??
							defaults.models.main.modelId
					},
					research: {
						provider:
							parsedConfig?.models?.research?.provider ??
							defaults.models.research.provider,
						modelId:
							parsedConfig?.models?.research?.modelId ??
							defaults.models.research.modelId
					}
				}
			};

			// Validate loaded provider (no longer split by main/research)
			if (!validateProvider(config.models.main.provider)) {
				console.warn(
					chalk.yellow(
						`Warning: Invalid main provider "${config.models.main.provider}" in ${CONFIG_FILE_NAME}. Falling back to default.`
					)
				);
				config.models.main = {
					provider: defaults.models.main.provider,
					modelId: defaults.models.main.modelId
				};
			}
			// Optional: Add warning for model combination if desired, but don't block
			// else if (!validateProviderModelCombination(config.models.main.provider, config.models.main.modelId)) { ... }

			if (!validateProvider(config.models.research.provider)) {
				console.warn(
					chalk.yellow(
						`Warning: Invalid research provider "${config.models.research.provider}" in ${CONFIG_FILE_NAME}. Falling back to default.`
					)
				);
				config.models.research = {
					provider: defaults.models.research.provider,
					modelId: defaults.models.research.modelId
				};
			}
			// Optional: Add warning for model combination if desired, but don't block
			// else if (!validateProviderModelCombination(config.models.research.provider, config.models.research.modelId)) { ... }

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
		return defaults;
	}
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
		MODEL_MAP[providerName].includes(modelId)
	);
}

/**
 * Gets the currently configured main AI provider.
 * @param {string|null} explicitRoot - Optional explicit path to the project root.
 * @returns {string} The name of the main provider.
 */
function getMainProvider(explicitRoot = null) {
	const config = readConfig(explicitRoot);
	return config.models.main.provider;
}

/**
 * Gets the currently configured main AI model ID.
 * @param {string|null} explicitRoot - Optional explicit path to the project root.
 * @returns {string} The ID of the main model.
 */
function getMainModelId(explicitRoot = null) {
	const config = readConfig(explicitRoot);
	return config.models.main.modelId;
}

/**
 * Gets the currently configured research AI provider.
 * @param {string|null} explicitRoot - Optional explicit path to the project root.
 * @returns {string} The name of the research provider.
 */
function getResearchProvider(explicitRoot = null) {
	const config = readConfig(explicitRoot);
	return config.models.research.provider;
}

/**
 * Gets the currently configured research AI model ID.
 * @param {string|null} explicitRoot - Optional explicit path to the project root.
 * @returns {string} The ID of the research model.
 */
function getResearchModelId(explicitRoot = null) {
	const config = readConfig(explicitRoot);
	return config.models.research.modelId;
}

/**
 * Sets the main AI model (provider and modelId) in the configuration file.
 * @param {string} providerName The name of the provider to set.
 * @param {string} modelId The ID of the model to set.
 * @param {string|null} explicitRoot - Optional explicit path to the project root.
 * @returns {boolean} True if successful, false otherwise.
 */
function setMainModel(providerName, modelId, explicitRoot = null) {
	if (!validateProvider(providerName)) {
		console.error(
			chalk.red(`Error: "${providerName}" is not a valid provider.`)
		);
		console.log(
			chalk.yellow(`Available providers: ${VALID_PROVIDERS.join(', ')}`)
		);
		return false;
	}
	if (!validateProviderModelCombination(providerName, modelId)) {
		console.warn(
			chalk.yellow(
				`Warning: Model "${modelId}" is not in the known list for provider "${providerName}". Ensure it is valid.`
			)
		);
	}

	// Pass explicitRoot down
	const config = readConfig(explicitRoot);
	config.models.main = { provider: providerName, modelId: modelId };
	// Pass explicitRoot down
	if (writeConfig(config, explicitRoot)) {
		console.log(
			chalk.green(`Main AI model set to: ${providerName} / ${modelId}`)
		);
		return true;
	} else {
		return false;
	}
}

/**
 * Sets the research AI model (provider and modelId) in the configuration file.
 * @param {string} providerName The name of the provider to set.
 * @param {string} modelId The ID of the model to set.
 * @param {string|null} explicitRoot - Optional explicit path to the project root.
 * @returns {boolean} True if successful, false otherwise.
 */
function setResearchModel(providerName, modelId, explicitRoot = null) {
	if (!validateProvider(providerName)) {
		console.error(
			chalk.red(`Error: "${providerName}" is not a valid provider.`)
		);
		console.log(
			chalk.yellow(`Available providers: ${VALID_PROVIDERS.join(', ')}`)
		);
		return false;
	}
	if (!validateProviderModelCombination(providerName, modelId)) {
		console.warn(
			chalk.yellow(
				`Warning: Model "${modelId}" is not in the known list for provider "${providerName}". Ensure it is valid.`
			)
		);
	}
	if (
		providerName === 'anthropic' ||
		(providerName === 'openai' && modelId.includes('3.5'))
	) {
		console.warn(
			chalk.yellow(
				`Warning: Provider "${providerName}" with model "${modelId}" may not be ideal for research tasks. Perplexity or Grok recommended.`
			)
		);
	}

	// Pass explicitRoot down
	const config = readConfig(explicitRoot);
	config.models.research = { provider: providerName, modelId: modelId };
	// Pass explicitRoot down
	if (writeConfig(config, explicitRoot)) {
		console.log(
			chalk.green(`Research AI model set to: ${providerName} / ${modelId}`)
		);
		return true;
	} else {
		return false;
	}
}

function writeConfig(config, explicitRoot = null) {
	// Determine the root path to use
	const rootToUse = explicitRoot || findProjectRoot();

	if (!rootToUse) {
		console.error(
			chalk.red(
				'Error: Could not determine project root to write configuration.'
			)
		);
		return false;
	}
	const configPath = path.join(rootToUse, CONFIG_FILE_NAME);

	// Check if file exists, as expected by tests
	if (!fs.existsSync(configPath)) {
		console.error(
			chalk.red(
				`Error: ${CONFIG_FILE_NAME} does not exist. Create it first or initialize project.`
			)
		);
		return false;
	}

	try {
		// Added 'utf-8' encoding
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
		return true;
	} catch (error) {
		console.error(
			chalk.red(`Error writing to ${configPath}: ${error.message}.`)
		);
		return false;
	}
}

export {
	// Not exporting findProjectRoot as it's internal for CLI context now
	readConfig, // Keep exporting if direct access is needed elsewhere
	writeConfig, // Keep exporting if direct access is needed elsewhere
	validateProvider,
	validateProviderModelCombination,
	getMainProvider,
	getMainModelId,
	getResearchProvider,
	getResearchModelId,
	setMainModel,
	setResearchModel,
	VALID_PROVIDERS,
	MODEL_MAP
};
