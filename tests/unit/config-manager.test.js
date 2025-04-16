import fs from 'fs';
import path from 'path';
import { jest } from '@jest/globals';

// --- Capture Mock Instances ---
const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockMkdirSync = jest.fn();

// --- Mock Setup using unstable_mockModule ---
// Mock 'fs' *before* importing the module that uses it
jest.unstable_mockModule('fs', () => ({
	__esModule: true, // Indicate it's an ES module mock
	default: {
		// Mock the default export if needed (less common for fs)
		existsSync: mockExistsSync,
		readFileSync: mockReadFileSync,
		writeFileSync: mockWriteFileSync,
		mkdirSync: mockMkdirSync
	},
	// Mock named exports directly
	existsSync: mockExistsSync,
	readFileSync: mockReadFileSync,
	writeFileSync: mockWriteFileSync,
	mkdirSync: mockMkdirSync
}));

// Mock path (optional, only if specific path logic needs testing)
// jest.unstable_mockModule('path');

// Mock chalk to prevent console formatting issues in tests
jest.unstable_mockModule('chalk', () => ({
	__esModule: true,
	default: {
		yellow: jest.fn((text) => text),
		red: jest.fn((text) => text),
		green: jest.fn((text) => text)
	},
	yellow: jest.fn((text) => text),
	red: jest.fn((text) => text),
	green: jest.fn((text) => text)
}));

// Mock utils module
import * as utils from '../../scripts/modules/utils.js'; // Revert to namespace import
// import { findProjectRoot } from '../../scripts/modules/utils.js'; // Remove specific import
jest.mock('../../scripts/modules/utils.js', () => {
	const originalModule = jest.requireActual('../../scripts/modules/utils.js');
	const mockFindProjectRoot = jest.fn(); // Create the mock function instance

	// Return the structure of the mocked module
	return {
		__esModule: true, // Indicate it's an ES module mock
		...originalModule, // Spread the original module's exports
		findProjectRoot: mockFindProjectRoot // Explicitly assign the mock function
	};
});

// Test Data
const MOCK_PROJECT_ROOT = '/mock/project';
const MOCK_CONFIG_PATH = path.join(MOCK_PROJECT_ROOT, '.taskmasterconfig');

const DEFAULT_CONFIG = {
	models: {
		main: { provider: 'anthropic', modelId: 'claude-3.7-sonnet-20250219' },
		research: {
			provider: 'perplexity',
			modelId: 'sonar-pro'
		}
	}
};

const VALID_CUSTOM_CONFIG = {
	models: {
		main: { provider: 'openai', modelId: 'gpt-4o' },
		research: { provider: 'google', modelId: 'gemini-1.5-pro-latest' },
		fallback: { provider: undefined, modelId: undefined }
	}
};

const PARTIAL_CONFIG = {
	models: {
		main: { provider: 'openai', modelId: 'gpt-4-turbo' }
		// research missing
		// fallback will be added by readConfig
	}
};

const INVALID_PROVIDER_CONFIG = {
	models: {
		main: { provider: 'invalid-provider', modelId: 'some-model' },
		research: {
			provider: 'perplexity',
			modelId: 'llama-3-sonar-large-32k-online'
		}
	}
};

// Dynamically import the module *after* setting up mocks
let configManager;

// Helper function to reset mocks
const resetMocks = () => {
	mockExistsSync.mockReset();
	mockReadFileSync.mockReset();
	mockWriteFileSync.mockReset();
	mockMkdirSync.mockReset();

	// Default behaviors - CRITICAL: Mock supported-models.json read
	mockReadFileSync.mockImplementation((filePath) => {
		if (filePath.endsWith('supported-models.json')) {
			// Return a mock structure including allowed_roles
			return JSON.stringify({
				openai: [
					{
						id: 'gpt-4o',
						swe_score: 0,
						cost_per_1m_tokens: null,
						allowed_roles: ['main', 'fallback']
					},
					{
						id: 'gpt-4',
						swe_score: 0,
						cost_per_1m_tokens: null,
						allowed_roles: ['main', 'fallback']
					}
				],
				google: [
					{
						id: 'gemini-1.5-pro-latest',
						swe_score: 0,
						cost_per_1m_tokens: null,
						allowed_roles: ['main', 'fallback', 'research']
					}
				],
				perplexity: [
					{
						id: 'sonar-pro',
						swe_score: 0,
						cost_per_1m_tokens: null,
						allowed_roles: ['main', 'fallback', 'research']
					}
				],
				anthropic: [
					{
						id: 'claude-3-opus-20240229',
						swe_score: 0,
						cost_per_1m_tokens: null,
						allowed_roles: ['main', 'fallback']
					},
					{
						id: 'claude-3.5-sonnet-20240620',
						swe_score: 0,
						cost_per_1m_tokens: null,
						allowed_roles: ['main', 'fallback']
					}
				]
				// Add other providers/models as needed for specific tests
			});
		} else if (filePath === MOCK_CONFIG_PATH) {
			// Default for .taskmasterconfig reads
			return JSON.stringify(DEFAULT_CONFIG);
		}
		// Handle other potential reads or throw an error for unexpected paths
		throw new Error(`Unexpected readFileSync call in test: ${filePath}`);
	});

	mockExistsSync.mockReturnValue(true); // Default to file existing
};

// Set up module before tests
beforeAll(async () => {
	resetMocks();

	// Import after mocks are set up
	configManager = await import('../../scripts/modules/config-manager.js');

	// Use spyOn instead of trying to mock the module directly
	jest.spyOn(console, 'error').mockImplementation(() => {});
	jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
	console.error.mockRestore();
	console.warn.mockRestore();
});

// Reset mocks before each test
beforeEach(() => {
	resetMocks();
});

// --- Validation Functions ---
describe('Validation Functions', () => {
	test('validateProvider should return true for valid providers', () => {
		expect(configManager.validateProvider('openai')).toBe(true);
		expect(configManager.validateProvider('anthropic')).toBe(true);
		expect(configManager.validateProvider('google')).toBe(true);
		expect(configManager.validateProvider('perplexity')).toBe(true);
		expect(configManager.validateProvider('ollama')).toBe(true);
		expect(configManager.validateProvider('openrouter')).toBe(true);
		expect(configManager.validateProvider('grok')).toBe(true);
	});

	test('validateProvider should return false for invalid providers', () => {
		expect(configManager.validateProvider('invalid-provider')).toBe(false);
		expect(configManager.validateProvider('')).toBe(false);
		expect(configManager.validateProvider(null)).toBe(false);
	});

	test('validateProviderModelCombination should validate known good combinations', () => {
		expect(
			configManager.validateProviderModelCombination('openai', 'gpt-4o')
		).toBe(true);
		expect(
			configManager.validateProviderModelCombination(
				'anthropic',
				'claude-3.5-sonnet-20240620'
			)
		).toBe(true);
	});

	test('validateProviderModelCombination should return false for known bad combinations', () => {
		expect(
			configManager.validateProviderModelCombination(
				'openai',
				'claude-3-opus-20240229'
			)
		).toBe(false);
	});

	test('validateProviderModelCombination should return true for providers with empty model lists (ollama, openrouter)', () => {
		expect(
			configManager.validateProviderModelCombination(
				'ollama',
				'any-ollama-model'
			)
		).toBe(true);
		expect(
			configManager.validateProviderModelCombination(
				'openrouter',
				'some/model/name'
			)
		).toBe(true);
	});

	test('validateProviderModelCombination should return true for providers not in MODEL_MAP', () => {
		// Assuming 'grok' is valid but not in MODEL_MAP for this test
		expect(
			configManager.validateProviderModelCombination('grok', 'grok-model-x')
		).toBe(true);
	});
});

// --- readConfig Tests ---
describe('readConfig', () => {
	test('should return default config if .taskmasterconfig does not exist', () => {
		// Mock that the config file doesn't exist
		mockExistsSync.mockImplementation((path) => {
			return path !== MOCK_CONFIG_PATH;
		});

		const config = configManager.readConfig(MOCK_PROJECT_ROOT);
		expect(config).toEqual(DEFAULT_CONFIG);
		expect(mockExistsSync).toHaveBeenCalledWith(MOCK_CONFIG_PATH);
		expect(mockReadFileSync).not.toHaveBeenCalled();
	});

	test('should read and parse valid config file', () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CUSTOM_CONFIG));
		const config = configManager.readConfig(MOCK_PROJECT_ROOT);
		expect(config).toEqual(VALID_CUSTOM_CONFIG);
		expect(mockExistsSync).toHaveBeenCalledWith(MOCK_CONFIG_PATH);
		expect(mockReadFileSync).toHaveBeenCalledWith(MOCK_CONFIG_PATH, 'utf-8');
	});

	test('should merge defaults for partial config file', () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(JSON.stringify(PARTIAL_CONFIG));
		const config = configManager.readConfig(MOCK_PROJECT_ROOT);
		expect(config.models.main).toEqual(PARTIAL_CONFIG.models.main);
		expect(config.models.research).toEqual(DEFAULT_CONFIG.models.research);
		expect(mockReadFileSync).toHaveBeenCalled();
	});

	test('should handle JSON parsing error and return defaults', () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue('invalid json');
		const config = configManager.readConfig(MOCK_PROJECT_ROOT);
		expect(config).toEqual(DEFAULT_CONFIG);
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining('Error reading or parsing')
		);
	});

	test('should handle file read error and return defaults', () => {
		mockExistsSync.mockReturnValue(true);
		const readError = new Error('Permission denied');
		mockReadFileSync.mockImplementation(() => {
			throw readError;
		});
		const config = configManager.readConfig(MOCK_PROJECT_ROOT);
		expect(config).toEqual(DEFAULT_CONFIG);
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining(
				'Error reading or parsing /mock/project/.taskmasterconfig: Permission denied. Using default configuration.'
			)
		);
	});

	test('should validate provider and fallback to default if invalid', () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(JSON.stringify(INVALID_PROVIDER_CONFIG));
		const config = configManager.readConfig(MOCK_PROJECT_ROOT);
		expect(console.warn).toHaveBeenCalledWith(
			expect.stringContaining('Invalid main provider "invalid-provider"')
		);
		expect(config.models.main).toEqual(DEFAULT_CONFIG.models.main);
		expect(config.models.research).toEqual(
			INVALID_PROVIDER_CONFIG.models.research
		);
	});
});

// --- writeConfig Tests ---
describe.skip('writeConfig', () => {
	// Set up mocks common to writeConfig tests
	beforeEach(() => {
		resetMocks();
		// Default mock for findProjectRoot for this describe block
		// Use the namespace
		utils.findProjectRoot.mockReturnValue(MOCK_PROJECT_ROOT);
	});

	test('should write valid config to file', () => {
		// Arrange: Ensure existsSync returns true for the directory check implicitly done by writeFileSync usually
		// Although findProjectRoot is mocked, let's assume the path exists for the write attempt.
		// We don't need a specific mock for existsSync here as writeFileSync handles it.
		// Arrange: Ensure writeFileSync succeeds (default mock behavior is fine)
		const success = configManager.writeConfig(VALID_CUSTOM_CONFIG);

		// Assert
		expect(success).toBe(true);
		// We don't mock findProjectRoot's internal checks here, just its return value
		// So, no need to expect calls on mockExistsSync related to root finding.
		expect(mockWriteFileSync).toHaveBeenCalledWith(
			MOCK_CONFIG_PATH,
			JSON.stringify(VALID_CUSTOM_CONFIG, null, 2)
		);
		expect(console.error).not.toHaveBeenCalled();
	});

	test('should return false and log error if write fails', () => {
		// Arrange: Mock findProjectRoot to return the valid path
		// Use the namespace
		utils.findProjectRoot.mockReturnValue(MOCK_PROJECT_ROOT);
		// Arrange: Make writeFileSync throw an error
		const mockWriteError = new Error('Mock file write permission error');
		mockWriteFileSync.mockImplementation(() => {
			throw mockWriteError;
		});

		// Act
		const success = configManager.writeConfig(VALID_CUSTOM_CONFIG);

		// Assert
		expect(success).toBe(false);
		expect(mockWriteFileSync).toHaveBeenCalledWith(
			MOCK_CONFIG_PATH,
			JSON.stringify(VALID_CUSTOM_CONFIG, null, 2)
		);
		// Assert that console.error was called with the write error message
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining(
				`Error writing configuration to ${MOCK_CONFIG_PATH}: ${mockWriteError.message}`
			)
		);
	});

	test('should return false if project root cannot be determined', () => {
		// Arrange: Mock findProjectRoot to return null
		// Use the namespace
		utils.findProjectRoot.mockReturnValue(null);

		// Act
		const success = configManager.writeConfig(VALID_CUSTOM_CONFIG);

		// Assert
		expect(success).toBe(false);
		expect(mockWriteFileSync).not.toHaveBeenCalled();
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining('Could not determine project root')
		);
	});
});

// --- Getter/Setter Tests ---
describe('Getter and Setter Functions', () => {
	test('getMainProvider should return provider from mocked config', () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CUSTOM_CONFIG));
		const provider = configManager.getMainProvider(MOCK_PROJECT_ROOT);
		expect(provider).toBe('openai');
		expect(mockReadFileSync).toHaveBeenCalled();
	});

	test('getMainModelId should return modelId from mocked config', () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CUSTOM_CONFIG));
		const modelId = configManager.getMainModelId(MOCK_PROJECT_ROOT);
		expect(modelId).toBe('gpt-4o');
		expect(mockReadFileSync).toHaveBeenCalledWith(MOCK_CONFIG_PATH, 'utf-8');
	});

	test('getResearchProvider should return provider from mocked config', () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CUSTOM_CONFIG));
		const provider = configManager.getResearchProvider(MOCK_PROJECT_ROOT);
		expect(provider).toBe('google');
		expect(mockReadFileSync).toHaveBeenCalledWith(MOCK_CONFIG_PATH, 'utf-8');
	});

	test('getResearchModelId should return modelId from mocked config', () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(JSON.stringify(VALID_CUSTOM_CONFIG));
		const modelId = configManager.getResearchModelId(MOCK_PROJECT_ROOT);
		expect(modelId).toBe('gemini-1.5-pro-latest');
		expect(mockReadFileSync).toHaveBeenCalledWith(MOCK_CONFIG_PATH, 'utf-8');
	});
});

describe('setMainModel', () => {
	beforeEach(() => {
		resetMocks();

		mockExistsSync.mockImplementation((path) => {
			console.log(`>>> mockExistsSync called with: ${path}`);
			return path.endsWith('.taskmasterconfig');
		});

		mockReadFileSync.mockImplementation((path, encoding) => {
			console.log(`>>> mockReadFileSync called with: ${path}, ${encoding}`);
			return JSON.stringify(DEFAULT_CONFIG);
		});
	});

	test('should return false for invalid provider', () => {
		console.log('>>> Test: Invalid provider');

		const result = configManager.setMainModel('invalid-provider', 'some-model');

		console.log('>>> After setMainModel(invalid-provider, some-model)');
		console.log('>>> mockExistsSync calls:', mockExistsSync.mock.calls);
		console.log('>>> mockReadFileSync calls:', mockReadFileSync.mock.calls);

		expect(result).toBe(false);
		expect(mockReadFileSync).not.toHaveBeenCalled();
		expect(mockWriteFileSync).not.toHaveBeenCalled();
		expect(console.error).toHaveBeenCalledWith(
			'Error: "invalid-provider" is not a valid provider.'
		);
	});

	test('should update config for valid provider', () => {
		console.log('>>> Test: Valid provider');

		const result = configManager.setMainModel(
			'openai',
			'gpt-4',
			MOCK_PROJECT_ROOT
		);

		console.log('>>> After setMainModel(openai, gpt-4, /mock/project)');
		console.log('>>> mockExistsSync calls:', mockExistsSync.mock.calls);
		console.log('>>> mockReadFileSync calls:', mockReadFileSync.mock.calls);
		console.log('>>> mockWriteFileSync calls:', mockWriteFileSync.mock.calls);

		expect(result).toBe(true);
		expect(mockExistsSync).toHaveBeenCalled();
		expect(mockReadFileSync).toHaveBeenCalled();
		expect(mockWriteFileSync).toHaveBeenCalled();

		// Check that the written config has the expected changes
		const writtenConfig = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
		expect(writtenConfig.models.main.provider).toBe('openai');
		expect(writtenConfig.models.main.modelId).toBe('gpt-4');
	});
});

describe('setResearchModel', () => {
	beforeEach(() => {
		resetMocks();
	});

	test('should return false for invalid provider', () => {
		const result = configManager.setResearchModel(
			'invalid-provider',
			'some-model'
		);

		expect(result).toBe(false);
		expect(mockReadFileSync).not.toHaveBeenCalled();
		expect(mockWriteFileSync).not.toHaveBeenCalled();
		expect(console.error).toHaveBeenCalledWith(
			'Error: "invalid-provider" is not a valid provider.'
		);
	});

	test('should update config for valid provider', () => {
		const result = configManager.setResearchModel(
			'google',
			'gemini-1.5-pro-latest',
			MOCK_PROJECT_ROOT
		);

		expect(result).toBe(true);
		expect(mockExistsSync).toHaveBeenCalled();
		expect(mockReadFileSync).toHaveBeenCalled();
		expect(mockWriteFileSync).toHaveBeenCalled();

		// Check that the written config has the expected changes
		const writtenConfig = JSON.parse(mockWriteFileSync.mock.calls[0][1]);
		expect(writtenConfig.models.research.provider).toBe('google');
		expect(writtenConfig.models.research.modelId).toBe('gemini-1.5-pro-latest');
	});
});
