import { jest } from '@jest/globals';
import path from 'path'; // Needed for mocking fs

// --- Mock Vercel AI SDK Modules ---
// Mock implementations - they just need to be callable and return a basic object
const mockCreateOpenAI = jest.fn(() => ({ provider: 'openai', type: 'mock' }));
const mockCreateAnthropic = jest.fn(() => ({
	provider: 'anthropic',
	type: 'mock'
}));
const mockCreateGoogle = jest.fn(() => ({ provider: 'google', type: 'mock' }));
const mockCreatePerplexity = jest.fn(() => ({
	provider: 'perplexity',
	type: 'mock'
}));
const mockCreateOllama = jest.fn(() => ({ provider: 'ollama', type: 'mock' }));
const mockCreateMistral = jest.fn(() => ({
	provider: 'mistral',
	type: 'mock'
}));
const mockCreateAzure = jest.fn(() => ({ provider: 'azure', type: 'mock' }));
const mockCreateXai = jest.fn(() => ({ provider: 'xai', type: 'mock' }));
// jest.unstable_mockModule('@ai-sdk/grok', () => ({
//     createGrok: mockCreateGrok
// }));
const mockCreateOpenRouter = jest.fn(() => ({
	provider: 'openrouter',
	type: 'mock'
}));

jest.unstable_mockModule('@ai-sdk/openai', () => ({
	createOpenAI: mockCreateOpenAI
}));
jest.unstable_mockModule('@ai-sdk/anthropic', () => ({
	createAnthropic: mockCreateAnthropic
}));
jest.unstable_mockModule('@ai-sdk/google', () => ({
	createGoogle: mockCreateGoogle
}));
jest.unstable_mockModule('@ai-sdk/perplexity', () => ({
	createPerplexity: mockCreatePerplexity
}));
jest.unstable_mockModule('ollama-ai-provider', () => ({
	createOllama: mockCreateOllama
}));
jest.unstable_mockModule('@ai-sdk/mistral', () => ({
	createMistral: mockCreateMistral
}));
jest.unstable_mockModule('@ai-sdk/azure', () => ({
	createAzure: mockCreateAzure
}));
jest.unstable_mockModule('@ai-sdk/xai', () => ({
	createXai: mockCreateXai
}));
// jest.unstable_mockModule('@ai-sdk/openrouter', () => ({
//     createOpenRouter: mockCreateOpenRouter
// }));
jest.unstable_mockModule('@openrouter/ai-sdk-provider', () => ({
	createOpenRouter: mockCreateOpenRouter
}));
// TODO: Mock other providers (OpenRouter, Grok) when added

// --- Mock Config Manager ---
const mockGetProviderAndModelForRole = jest.fn();
const mockFindProjectRoot = jest.fn();
jest.unstable_mockModule('../../scripts/modules/config-manager.js', () => ({
	getProviderAndModelForRole: mockGetProviderAndModelForRole,
	findProjectRoot: mockFindProjectRoot
}));

// --- Mock File System (for supported-models.json loading) ---
const mockFsExistsSync = jest.fn();
const mockFsReadFileSync = jest.fn();
jest.unstable_mockModule('fs', () => ({
	__esModule: true, // Important for ES modules with default exports
	default: {
		// Provide the default export expected by `import fs from 'fs'`
		existsSync: mockFsExistsSync,
		readFileSync: mockFsReadFileSync
	},
	// Also provide named exports if they were directly imported elsewhere, though not needed here
	existsSync: mockFsExistsSync,
	readFileSync: mockFsReadFileSync
}));

// --- Mock path (specifically path.join used for supported-models.json) ---
const mockPathJoin = jest.fn((...args) => args.join(path.sep)); // Simple mock
const actualPath = jest.requireActual('path'); // Get the actual path module
jest.unstable_mockModule('path', () => ({
	__esModule: true, // Indicate ES module mock
	default: {
		// Provide the default export
		...actualPath, // Spread actual functions
		join: mockPathJoin // Override join
	},
	// Also provide named exports for consistency
	...actualPath,
	join: mockPathJoin
}));

// --- Define Mock Data ---
const mockSupportedModels = {
	openai: [
		{ id: 'gpt-4o', allowed_roles: ['main', 'fallback'] },
		{ id: 'gpt-3.5-turbo', allowed_roles: ['main', 'fallback'] }
	],
	anthropic: [
		{ id: 'claude-3.5-sonnet-20240620', allowed_roles: ['main'] },
		{ id: 'claude-3-haiku-20240307', allowed_roles: ['fallback'] }
	],
	perplexity: [{ id: 'sonar-pro', allowed_roles: ['research'] }],
	ollama: [{ id: 'llama3', allowed_roles: ['main', 'fallback'] }],
	google: [{ id: 'gemini-pro', allowed_roles: ['main'] }],
	mistral: [{ id: 'mistral-large-latest', allowed_roles: ['main'] }],
	azure: [{ id: 'azure-gpt4o', allowed_roles: ['main'] }],
	xai: [{ id: 'grok-basic', allowed_roles: ['main'] }],
	openrouter: [{ id: 'openrouter-model', allowed_roles: ['main'] }]
	// Add other providers as needed for tests
};

// --- Import the module AFTER mocks ---
const { getClient, clearClientCache, _resetSupportedModelsCache } =
	await import('../../scripts/modules/ai-client-factory.js');

describe('AI Client Factory (Role-Based)', () => {
	const OLD_ENV = process.env;

	beforeEach(() => {
		// Reset state before each test
		clearClientCache(); // Use the correct function name
		_resetSupportedModelsCache(); // Reset the models cache
		mockFsExistsSync.mockClear();
		mockFsReadFileSync.mockClear();
		mockGetProviderAndModelForRole.mockClear(); // Reset this mock too

		// Reset environment to avoid test pollution
		process.env = { ...OLD_ENV };

		// Default mock implementations (can be overridden)
		mockFindProjectRoot.mockReturnValue('/fake/project/root');
		mockPathJoin.mockImplementation((...args) => args.join(actualPath.sep)); // Use actualPath.sep

		// Default FS mocks for model/config loading
		mockFsExistsSync.mockImplementation((filePath) => {
			// Default to true for the files we expect to load
			if (filePath.endsWith('supported-models.json')) return true;
			// Add other expected files if necessary
			return false; // Default to false for others
		});
		mockFsReadFileSync.mockImplementation((filePath) => {
			if (filePath.endsWith('supported-models.json')) {
				return JSON.stringify(mockSupportedModels);
			}
			// Throw if an unexpected file is read
			throw new Error(`Unexpected readFileSync call in test: ${filePath}`);
		});

		// Default config mock
		mockGetProviderAndModelForRole.mockImplementation((role) => {
			if (role === 'main') return { provider: 'openai', modelId: 'gpt-4o' };
			if (role === 'research')
				return { provider: 'perplexity', modelId: 'sonar-pro' };
			if (role === 'fallback')
				return { provider: 'anthropic', modelId: 'claude-3-haiku-20240307' };
			return {}; // Default empty for unconfigured roles
		});

		// Set default required env vars (can be overridden in tests)
		process.env.OPENAI_API_KEY = 'test-openai-key';
		process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
		process.env.PERPLEXITY_API_KEY = 'test-perplexity-key';
		process.env.GOOGLE_API_KEY = 'test-google-key';
		process.env.MISTRAL_API_KEY = 'test-mistral-key';
		process.env.AZURE_OPENAI_API_KEY = 'test-azure-key';
		process.env.AZURE_OPENAI_ENDPOINT = 'test-azure-endpoint';
		process.env.XAI_API_KEY = 'test-xai-key';
		process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
	});

	afterAll(() => {
		process.env = OLD_ENV;
	});

	test('should throw error if role is missing', () => {
		expect(() => getClient()).toThrow(
			"Client role ('main', 'research', 'fallback') must be specified."
		);
	});

	test('should throw error if config manager fails to get role config', () => {
		mockGetProviderAndModelForRole.mockImplementation((role) => {
			if (role === 'main') throw new Error('Config file not found');
		});
		expect(() => getClient('main')).toThrow(
			"Failed to get configuration for role 'main': Config file not found"
		);
	});

	test('should throw error if config manager returns undefined provider/model', () => {
		mockGetProviderAndModelForRole.mockReturnValue({}); // Empty object
		expect(() => getClient('main')).toThrow(
			"Could not determine provider or modelId for role 'main'"
		);
	});

	test('should throw error if configured model is not supported for the role', () => {
		mockGetProviderAndModelForRole.mockReturnValue({
			provider: 'anthropic',
			modelId: 'claude-3.5-sonnet-20240620' // Only allowed for 'main' in mock data
		});
		expect(() => getClient('research')).toThrow(
			/Model 'claude-3.5-sonnet-20240620' from provider 'anthropic' is either not supported or not allowed for the 'research' role/
		);
	});

	test('should throw error if configured model is not found in supported list', () => {
		mockGetProviderAndModelForRole.mockReturnValue({
			provider: 'openai',
			modelId: 'gpt-unknown'
		});
		expect(() => getClient('main')).toThrow(
			/Model 'gpt-unknown' from provider 'openai' is either not supported or not allowed for the 'main' role/
		);
	});

	test('should throw error if configured provider is not found in supported list', () => {
		mockGetProviderAndModelForRole.mockReturnValue({
			provider: 'unknown-provider',
			modelId: 'some-model'
		});
		expect(() => getClient('main')).toThrow(
			/Model 'some-model' from provider 'unknown-provider' is either not supported or not allowed for the 'main' role/
		);
	});

	test('should skip model validation if supported-models.json is not found', () => {
		mockFsExistsSync.mockReturnValue(false); // Simulate file not found
		const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(); // Suppress warning

		mockGetProviderAndModelForRole.mockReturnValue({
			provider: 'openai',
			modelId: 'gpt-any' // Doesn't matter, validation skipped
		});
		process.env.OPENAI_API_KEY = 'test-key';

		expect(() => getClient('main')).not.toThrow(); // Should not throw validation error
		expect(mockCreateOpenAI).toHaveBeenCalled();
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			expect.stringContaining('Skipping model validation')
		);
		consoleWarnSpy.mockRestore();
	});

	test('should throw environment validation error', () => {
		mockGetProviderAndModelForRole.mockReturnValue({
			provider: 'openai',
			modelId: 'gpt-4o'
		});
		delete process.env.OPENAI_API_KEY; // Trigger missing env var
		expect(() => getClient('main')).toThrow(
			// Expect the original error message from validateEnvironment
			/Missing environment variables for provider 'openai': OPENAI_API_KEY\. Please check your \.env file or session configuration\./
		);
	});

	test('should successfully create client using config and process.env', () => {
		mockGetProviderAndModelForRole.mockReturnValue({
			provider: 'openai',
			modelId: 'gpt-4o'
		});
		process.env.OPENAI_API_KEY = 'env-key';

		const client = getClient('main');

		expect(client).toBeDefined();
		expect(mockGetProviderAndModelForRole).toHaveBeenCalledWith('main');
		expect(mockCreateOpenAI).toHaveBeenCalledWith(
			expect.objectContaining({ apiKey: 'env-key', model: 'gpt-4o' })
		);
	});

	test('should successfully create client using config and session.env', () => {
		mockGetProviderAndModelForRole.mockReturnValue({
			provider: 'anthropic',
			modelId: 'claude-3.5-sonnet-20240620'
		});
		delete process.env.ANTHROPIC_API_KEY;
		const session = { env: { ANTHROPIC_API_KEY: 'session-key' } };

		const client = getClient('main', session);

		expect(client).toBeDefined();
		expect(mockGetProviderAndModelForRole).toHaveBeenCalledWith('main');
		expect(mockCreateAnthropic).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: 'session-key',
				model: 'claude-3.5-sonnet-20240620'
			})
		);
	});

	test('should use overrideOptions when provided', () => {
		process.env.PERPLEXITY_API_KEY = 'env-key';
		const override = { provider: 'perplexity', modelId: 'sonar-pro' };

		const client = getClient('research', null, override);

		expect(client).toBeDefined();
		expect(mockGetProviderAndModelForRole).not.toHaveBeenCalled(); // Config shouldn't be called
		expect(mockCreatePerplexity).toHaveBeenCalledWith(
			expect.objectContaining({ apiKey: 'env-key', model: 'sonar-pro' })
		);
	});

	test('should throw validation error even with override if role is disallowed', () => {
		process.env.OPENAI_API_KEY = 'env-key';
		// gpt-4o is not allowed for 'research' in mock data
		const override = { provider: 'openai', modelId: 'gpt-4o' };

		expect(() => getClient('research', null, override)).toThrow(
			/Model 'gpt-4o' from provider 'openai' is either not supported or not allowed for the 'research' role/
		);
		expect(mockGetProviderAndModelForRole).not.toHaveBeenCalled();
		expect(mockCreateOpenAI).not.toHaveBeenCalled();
	});

	describe('Caching Behavior (Role-Based)', () => {
		test('should return cached client instance for the same provider/model derived from role', () => {
			mockGetProviderAndModelForRole.mockReturnValue({
				provider: 'openai',
				modelId: 'gpt-4o'
			});
			process.env.OPENAI_API_KEY = 'test-key';

			const client1 = getClient('main');
			const client2 = getClient('main'); // Same role, same config result

			expect(client1).toBe(client2); // Should be the exact same instance
			expect(mockGetProviderAndModelForRole).toHaveBeenCalledTimes(2); // Config lookup happens each time
			expect(mockCreateOpenAI).toHaveBeenCalledTimes(1); // Instance created only once
		});

		test('should return different client instances for different roles if config differs', () => {
			mockGetProviderAndModelForRole.mockImplementation((role) => {
				if (role === 'main') return { provider: 'openai', modelId: 'gpt-4o' };
				if (role === 'research')
					return { provider: 'perplexity', modelId: 'sonar-pro' };
				return {};
			});
			process.env.OPENAI_API_KEY = 'test-key-1';
			process.env.PERPLEXITY_API_KEY = 'test-key-2';

			const client1 = getClient('main');
			const client2 = getClient('research');

			expect(client1).not.toBe(client2);
			expect(mockCreateOpenAI).toHaveBeenCalledTimes(1);
			expect(mockCreatePerplexity).toHaveBeenCalledTimes(1);
		});

		test('should return same client instance if different roles resolve to same provider/model', () => {
			mockGetProviderAndModelForRole.mockImplementation((role) => {
				// Both roles point to the same model
				return { provider: 'openai', modelId: 'gpt-4o' };
			});
			process.env.OPENAI_API_KEY = 'test-key';

			const client1 = getClient('main');
			const client2 = getClient('fallback'); // Different role, same config result

			expect(client1).toBe(client2); // Should be the exact same instance
			expect(mockCreateOpenAI).toHaveBeenCalledTimes(1); // Instance created only once
		});
	});

	// Add tests for specific providers
	describe('Specific Provider Instantiation', () => {
		test('should successfully create Google client with GOOGLE_API_KEY', () => {
			mockGetProviderAndModelForRole.mockReturnValue({
				provider: 'google',
				modelId: 'gemini-pro'
			}); // Assume gemini-pro is supported
			process.env.GOOGLE_API_KEY = 'test-google-key';
			const client = getClient('main');
			expect(client).toBeDefined();
			expect(mockCreateGoogle).toHaveBeenCalledWith(
				expect.objectContaining({ apiKey: 'test-google-key' })
			);
		});

		test('should throw environment error if GOOGLE_API_KEY is missing', () => {
			mockGetProviderAndModelForRole.mockReturnValue({
				provider: 'google',
				modelId: 'gemini-pro'
			});
			delete process.env.GOOGLE_API_KEY;
			expect(() => getClient('main')).toThrow(
				/Missing environment variables for provider 'google': GOOGLE_API_KEY/
			);
		});

		test('should successfully create Ollama client with OLLAMA_BASE_URL', () => {
			mockGetProviderAndModelForRole.mockReturnValue({
				provider: 'ollama',
				modelId: 'llama3'
			}); // Use supported llama3
			process.env.OLLAMA_BASE_URL = 'http://test-ollama:11434';
			const client = getClient('main');
			expect(client).toBeDefined();
			expect(mockCreateOllama).toHaveBeenCalledWith(
				expect.objectContaining({ baseURL: 'http://test-ollama:11434' })
			);
		});

		test('should throw environment error if OLLAMA_BASE_URL is missing', () => {
			mockGetProviderAndModelForRole.mockReturnValue({
				provider: 'ollama',
				modelId: 'llama3'
			});
			delete process.env.OLLAMA_BASE_URL;
			expect(() => getClient('main')).toThrow(
				/Missing environment variables for provider 'ollama': OLLAMA_BASE_URL/
			);
		});

		test('should successfully create Mistral client with MISTRAL_API_KEY', () => {
			mockGetProviderAndModelForRole.mockReturnValue({
				provider: 'mistral',
				modelId: 'mistral-large-latest'
			}); // Assume supported
			process.env.MISTRAL_API_KEY = 'test-mistral-key';
			const client = getClient('main');
			expect(client).toBeDefined();
			expect(mockCreateMistral).toHaveBeenCalledWith(
				expect.objectContaining({ apiKey: 'test-mistral-key' })
			);
		});

		test('should throw environment error if MISTRAL_API_KEY is missing', () => {
			mockGetProviderAndModelForRole.mockReturnValue({
				provider: 'mistral',
				modelId: 'mistral-large-latest'
			});
			delete process.env.MISTRAL_API_KEY;
			expect(() => getClient('main')).toThrow(
				/Missing environment variables for provider 'mistral': MISTRAL_API_KEY/
			);
		});

		test('should successfully create Azure client with AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT', () => {
			mockGetProviderAndModelForRole.mockReturnValue({
				provider: 'azure',
				modelId: 'azure-gpt4o'
			}); // Assume supported
			process.env.AZURE_OPENAI_API_KEY = 'test-azure-key';
			process.env.AZURE_OPENAI_ENDPOINT = 'https://test-azure.openai.azure.com';
			const client = getClient('main');
			expect(client).toBeDefined();
			expect(mockCreateAzure).toHaveBeenCalledWith(
				expect.objectContaining({
					apiKey: 'test-azure-key',
					endpoint: 'https://test-azure.openai.azure.com'
				})
			);
		});

		test('should throw environment error if AZURE_OPENAI_API_KEY or AZURE_OPENAI_ENDPOINT is missing', () => {
			mockGetProviderAndModelForRole.mockReturnValue({
				provider: 'azure',
				modelId: 'azure-gpt4o'
			});
			process.env.AZURE_OPENAI_API_KEY = 'test-azure-key';
			delete process.env.AZURE_OPENAI_ENDPOINT;
			expect(() => getClient('main')).toThrow(
				/Missing environment variables for provider 'azure': AZURE_OPENAI_ENDPOINT/
			);

			process.env.AZURE_OPENAI_ENDPOINT = 'https://test-azure.openai.azure.com';
			delete process.env.AZURE_OPENAI_API_KEY;
			expect(() => getClient('main')).toThrow(
				/Missing environment variables for provider 'azure': AZURE_OPENAI_API_KEY/
			);
		});

		test('should successfully create xAI (Grok) client with XAI_API_KEY', () => {
			mockGetProviderAndModelForRole.mockReturnValue({
				provider: 'xai',
				modelId: 'grok-basic'
			});
			process.env.XAI_API_KEY = 'test-xai-key-specific';
			const client = getClient('main');
			expect(client).toBeDefined();
			expect(mockCreateXai).toHaveBeenCalledWith(
				expect.objectContaining({ apiKey: 'test-xai-key-specific' })
			);
		});

		test('should throw environment error if XAI_API_KEY is missing', () => {
			mockGetProviderAndModelForRole.mockReturnValue({
				provider: 'xai',
				modelId: 'grok-basic'
			});
			delete process.env.XAI_API_KEY;
			expect(() => getClient('main')).toThrow(
				/Missing environment variables for provider 'xai': XAI_API_KEY/
			);
		});

		test('should successfully create OpenRouter client with OPENROUTER_API_KEY', () => {
			mockGetProviderAndModelForRole.mockReturnValue({
				provider: 'openrouter',
				modelId: 'openrouter-model'
			});
			process.env.OPENROUTER_API_KEY = 'test-openrouter-key-specific';
			const client = getClient('main');
			expect(client).toBeDefined();
			expect(mockCreateOpenRouter).toHaveBeenCalledWith(
				expect.objectContaining({ apiKey: 'test-openrouter-key-specific' })
			);
		});

		test('should throw environment error if OPENROUTER_API_KEY is missing', () => {
			mockGetProviderAndModelForRole.mockReturnValue({
				provider: 'openrouter',
				modelId: 'openrouter-model'
			});
			delete process.env.OPENROUTER_API_KEY;
			expect(() => getClient('main')).toThrow(
				/Missing environment variables for provider 'openrouter': OPENROUTER_API_KEY/
			);
		});
	});

	describe('Environment Variable Precedence', () => {
		test('should prioritize process.env over session.env for API keys', () => {
			mockGetProviderAndModelForRole.mockReturnValue({
				provider: 'openai',
				modelId: 'gpt-4o'
			});
			process.env.OPENAI_API_KEY = 'process-env-key'; // This should be used
			const session = { env: { OPENAI_API_KEY: 'session-env-key' } };

			const client = getClient('main', session);
			expect(client).toBeDefined();
			expect(mockCreateOpenAI).toHaveBeenCalledWith(
				expect.objectContaining({ apiKey: 'process-env-key', model: 'gpt-4o' })
			);
		});
	});
});
