import { jest } from '@jest/globals';

// Mock ai-client-factory
const mockGetClient = jest.fn();
jest.unstable_mockModule('../../scripts/modules/ai-client-factory.js', () => ({
	getClient: mockGetClient
}));

// Mock AI SDK Core
const mockGenerateText = jest.fn();
jest.unstable_mockModule('ai', () => ({
	generateText: mockGenerateText
	// Mock other AI SDK functions like streamText as needed
}));

// Mock utils logger
const mockLog = jest.fn();
jest.unstable_mockModule('../../scripts/modules/utils.js', () => ({
	log: mockLog
	// Keep other exports if utils has more, otherwise just log
}));

// Import the module to test (AFTER mocks)
const { generateTextService } = await import(
	'../../scripts/modules/ai-services-unified.js'
);

describe('Unified AI Services', () => {
	beforeEach(() => {
		// Clear mocks before each test
		mockGetClient.mockClear();
		mockGenerateText.mockClear();
		mockLog.mockClear(); // Clear log mock
	});

	describe('generateTextService', () => {
		test('should get client and call generateText with correct parameters', async () => {
			const mockClient = { type: 'mock-client' };
			mockGetClient.mockResolvedValue(mockClient);
			mockGenerateText.mockResolvedValue({ text: 'Mock response' });

			const serviceParams = {
				role: 'main',
				session: { env: { SOME_KEY: 'value' } }, // Example session
				overrideOptions: { provider: 'override' }, // Example overrides
				prompt: 'Test prompt',
				// Other generateText options like maxTokens, temperature etc.
				maxTokens: 100
			};

			const result = await generateTextService(serviceParams);

			// Verify getClient call
			expect(mockGetClient).toHaveBeenCalledTimes(1);
			expect(mockGetClient).toHaveBeenCalledWith(
				serviceParams.role,
				serviceParams.session,
				serviceParams.overrideOptions
			);

			// Verify generateText call
			expect(mockGenerateText).toHaveBeenCalledTimes(1);
			expect(mockGenerateText).toHaveBeenCalledWith({
				model: mockClient, // Ensure the correct client is passed
				prompt: serviceParams.prompt,
				maxTokens: serviceParams.maxTokens
				// Add other expected generateText options here
			});

			// Verify result
			expect(result).toEqual({ text: 'Mock response' });
		});

		test('should retry generateText on specific errors and succeed', async () => {
			const mockClient = { type: 'mock-client' };
			mockGetClient.mockResolvedValue(mockClient);

			// Simulate failure then success
			mockGenerateText
				.mockRejectedValueOnce(new Error('Rate limit exceeded')) // Retryable error
				.mockRejectedValueOnce(new Error('Service temporarily unavailable')) // Retryable error
				.mockResolvedValue({ text: 'Success after retries' });

			const serviceParams = { role: 'main', prompt: 'Retry test' };

			// Use jest.advanceTimersByTime for delays if implemented
			// jest.useFakeTimers();

			const result = await generateTextService(serviceParams);

			expect(mockGetClient).toHaveBeenCalledTimes(1); // Client fetched once
			expect(mockGenerateText).toHaveBeenCalledTimes(3); // Initial call + 2 retries
			expect(result).toEqual({ text: 'Success after retries' });

			// jest.useRealTimers(); // Restore real timers if faked
		});

		test('should fail after exhausting retries', async () => {
			jest.setTimeout(15000); // Increase timeout further
			const mockClient = { type: 'mock-client' };
			mockGetClient.mockResolvedValue(mockClient);

			// Simulate persistent failure
			mockGenerateText.mockRejectedValue(new Error('Rate limit exceeded'));

			const serviceParams = { role: 'main', prompt: 'Retry failure test' };

			await expect(generateTextService(serviceParams)).rejects.toThrow(
				'Rate limit exceeded'
			);

			// Sequence is main -> fallback -> research. It tries all client gets even if main fails.
			expect(mockGetClient).toHaveBeenCalledTimes(3);
			expect(mockGenerateText).toHaveBeenCalledTimes(3); // Initial call + max retries (assuming 2 retries)
		});

		test('should not retry on non-retryable errors', async () => {
			const mockMainClient = { type: 'mock-main' };
			const mockFallbackClient = { type: 'mock-fallback' };
			const mockResearchClient = { type: 'mock-research' };

			// Simulate a non-retryable error
			const nonRetryableError = new Error('Invalid request parameters');
			mockGenerateText.mockRejectedValueOnce(nonRetryableError); // Fail only once

			const serviceParams = { role: 'main', prompt: 'No retry test' };

			// Sequence is main -> fallback -> research. Even if main fails non-retryably,
			// it will still try to get clients for fallback and research before throwing.
			// Let's assume getClient succeeds for all three.
			mockGetClient
				.mockResolvedValueOnce(mockMainClient)
				.mockResolvedValueOnce(mockFallbackClient)
				.mockResolvedValueOnce(mockResearchClient);

			await expect(generateTextService(serviceParams)).rejects.toThrow(
				'Invalid request parameters'
			);
			expect(mockGetClient).toHaveBeenCalledTimes(3); // Tries main, fallback, research
			expect(mockGenerateText).toHaveBeenCalledTimes(1); // Called only once for main
		});

		test('should log service entry, client info, attempts, and success', async () => {
			const mockClient = {
				type: 'mock-client',
				provider: 'test-provider',
				model: 'test-model'
			}; // Add mock details
			mockGetClient.mockResolvedValue(mockClient);
			mockGenerateText.mockResolvedValue({ text: 'Success' });

			const serviceParams = { role: 'main', prompt: 'Log test' };
			await generateTextService(serviceParams);

			// Check logs (in order)
			expect(mockLog).toHaveBeenNthCalledWith(
				1,
				'info',
				'generateTextService called',
				{ role: 'main' }
			);
			expect(mockLog).toHaveBeenNthCalledWith(
				2,
				'info',
				'New AI service call with role: main'
			);
			expect(mockLog).toHaveBeenNthCalledWith(
				3,
				'info',
				'Retrieved AI client',
				{
					provider: mockClient.provider,
					model: mockClient.model
				}
			);
			expect(mockLog).toHaveBeenNthCalledWith(
				4,
				expect.stringMatching(
					/Attempt 1\/3 calling generateText for role main/i
				)
			);
			expect(mockLog).toHaveBeenNthCalledWith(
				5,
				'info',
				'generateText succeeded for role main on attempt 1' // Original success log from helper
			);
			expect(mockLog).toHaveBeenNthCalledWith(
				6,
				'info',
				'generateTextService succeeded using role: main' // Final success log from service
			);

			// Ensure no failure/retry logs were called
			expect(mockLog).not.toHaveBeenCalledWith(
				'warn',
				expect.stringContaining('failed')
			);
			expect(mockLog).not.toHaveBeenCalledWith(
				'info',
				expect.stringContaining('Retrying')
			);
		});

		test('should log retry attempts and eventual failure', async () => {
			jest.setTimeout(15000); // Increase timeout further
			const mockClient = {
				type: 'mock-client',
				provider: 'test-provider',
				model: 'test-model'
			};
			const mockFallbackClient = { type: 'mock-fallback' };
			const mockResearchClient = { type: 'mock-research' };
			mockGetClient
				.mockResolvedValueOnce(mockClient)
				.mockResolvedValueOnce(mockFallbackClient)
				.mockResolvedValueOnce(mockResearchClient);
			mockGenerateText.mockRejectedValue(new Error('Rate limit'));

			const serviceParams = { role: 'main', prompt: 'Log retry failure' };
			await expect(generateTextService(serviceParams)).rejects.toThrow(
				'Rate limit'
			);

			// Check logs
			expect(mockLog).toHaveBeenCalledWith(
				'info',
				'generateTextService called',
				{ role: 'main' }
			);
			expect(mockLog).toHaveBeenCalledWith(
				'info',
				'New AI service call with role: main'
			);
			expect(mockLog).toHaveBeenCalledWith('info', 'Retrieved AI client', {
				provider: mockClient.provider,
				model: mockClient.model
			});
			expect(mockLog).toHaveBeenCalledWith(
				expect.stringMatching(
					/Attempt 1\/3 calling generateText for role main/i
				)
			);
			expect(mockLog).toHaveBeenCalledWith(
				'warn',
				'Attempt 1 failed for role main: Rate limit'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'info',
				'Retryable error detected. Retrying in 1s...'
			);
			expect(mockLog).toHaveBeenCalledWith(
				expect.stringMatching(
					/Attempt 2\/3 calling generateText for role main/i
				)
			);
			expect(mockLog).toHaveBeenCalledWith(
				'warn',
				'Attempt 2 failed for role main: Rate limit'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'info',
				'Retryable error detected. Retrying in 2s...'
			);
			expect(mockLog).toHaveBeenCalledWith(
				expect.stringMatching(
					/Attempt 3\/3 calling generateText for role main/i
				)
			);
			expect(mockLog).toHaveBeenCalledWith(
				'warn',
				'Attempt 3 failed for role main: Rate limit'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'error',
				'Non-retryable error or max retries reached for role main (generateText).'
			);
			// Check subsequent fallback attempts (which also fail)
			expect(mockLog).toHaveBeenCalledWith(
				'info',
				'New AI service call with role: fallback'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'error',
				'Service call failed for role fallback: Rate limit'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'info',
				'New AI service call with role: research'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'error',
				'Service call failed for role research: Rate limit'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'error',
				'All roles in the sequence [main,fallback,research] failed.'
			);
		});

		test('should use fallback client after primary fails, then succeed', async () => {
			const mockMainClient = { type: 'mock-client', provider: 'main-provider' };
			const mockFallbackClient = {
				type: 'mock-client',
				provider: 'fallback-provider'
			};

			// Setup calls: main client fails, fallback succeeds
			mockGetClient
				.mockResolvedValueOnce(mockMainClient) // First call for 'main' role
				.mockResolvedValueOnce(mockFallbackClient); // Second call for 'fallback' role
			mockGenerateText
				.mockRejectedValueOnce(new Error('Main Rate limit')) // Main attempt 1 fail
				.mockRejectedValueOnce(new Error('Main Rate limit')) // Main attempt 2 fail
				.mockRejectedValueOnce(new Error('Main Rate limit')) // Main attempt 3 fail
				.mockResolvedValue({ text: 'Fallback success' }); // Fallback attempt 1 success

			const serviceParams = { role: 'main', prompt: 'Fallback test' };
			const result = await generateTextService(serviceParams);

			// Check calls
			expect(mockGetClient).toHaveBeenCalledTimes(2);
			expect(mockGetClient).toHaveBeenNthCalledWith(
				1,
				'main',
				undefined,
				undefined
			);
			expect(mockGetClient).toHaveBeenNthCalledWith(
				2,
				'fallback',
				undefined,
				undefined
			);
			expect(mockGenerateText).toHaveBeenCalledTimes(4); // 3 main fails, 1 fallback success
			expect(mockGenerateText).toHaveBeenNthCalledWith(4, {
				model: mockFallbackClient,
				prompt: 'Fallback test'
			});
			expect(result).toEqual({ text: 'Fallback success' });

			// Check logs for fallback attempt
			expect(mockLog).toHaveBeenCalledWith(
				'error',
				'Service call failed for role main: Main Rate limit'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'warn',
				'Retries exhausted or non-retryable error for role main, trying next role in sequence...'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'info',
				'New AI service call with role: fallback'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'info',
				'generateTextService succeeded using role: fallback'
			);
		});

		test('should use research client after primary and fallback fail, then succeed', async () => {
			const mockMainClient = { type: 'mock-client', provider: 'main-provider' };
			const mockFallbackClient = {
				type: 'mock-client',
				provider: 'fallback-provider'
			};
			const mockResearchClient = {
				type: 'mock-client',
				provider: 'research-provider'
			};

			// Setup calls: main fails, fallback fails, research succeeds
			mockGetClient
				.mockResolvedValueOnce(mockMainClient)
				.mockResolvedValueOnce(mockFallbackClient)
				.mockResolvedValueOnce(mockResearchClient);
			mockGenerateText
				.mockRejectedValueOnce(new Error('Main fail 1')) // Main 1
				.mockRejectedValueOnce(new Error('Main fail 2')) // Main 2
				.mockRejectedValueOnce(new Error('Main fail 3')) // Main 3
				.mockRejectedValueOnce(new Error('Fallback fail 1')) // Fallback 1
				.mockRejectedValueOnce(new Error('Fallback fail 2')) // Fallback 2
				.mockRejectedValueOnce(new Error('Fallback fail 3')) // Fallback 3
				.mockResolvedValue({ text: 'Research success' }); // Research 1 success

			const serviceParams = { role: 'main', prompt: 'Research fallback test' };
			const result = await generateTextService(serviceParams);

			// Check calls
			expect(mockGetClient).toHaveBeenCalledTimes(3);
			expect(mockGetClient).toHaveBeenNthCalledWith(
				1,
				'main',
				undefined,
				undefined
			);
			expect(mockGetClient).toHaveBeenNthCalledWith(
				2,
				'fallback',
				undefined,
				undefined
			);
			expect(mockGetClient).toHaveBeenNthCalledWith(
				3,
				'research',
				undefined,
				undefined
			);
			expect(mockGenerateText).toHaveBeenCalledTimes(7); // 3 main, 3 fallback, 1 research
			expect(mockGenerateText).toHaveBeenNthCalledWith(7, {
				model: mockResearchClient,
				prompt: 'Research fallback test'
			});
			expect(result).toEqual({ text: 'Research success' });

			// Check logs for fallback attempt
			expect(mockLog).toHaveBeenCalledWith(
				'error',
				'Service call failed for role main: Main fail 3' // Error from last attempt for role
			);
			expect(mockLog).toHaveBeenCalledWith(
				'warn',
				'Retries exhausted or non-retryable error for role main, trying next role in sequence...'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'error',
				'Service call failed for role fallback: Fallback fail 3' // Error from last attempt for role
			);
			expect(mockLog).toHaveBeenCalledWith(
				'warn',
				'Retries exhausted or non-retryable error for role fallback, trying next role in sequence...'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'info',
				'New AI service call with role: research'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'info',
				'generateTextService succeeded using role: research'
			);
		});

		test('should fail if primary, fallback, and research clients all fail', async () => {
			const mockMainClient = { type: 'mock-client', provider: 'main' };
			const mockFallbackClient = { type: 'mock-client', provider: 'fallback' };
			const mockResearchClient = { type: 'mock-client', provider: 'research' };

			// Setup calls: all fail
			mockGetClient
				.mockResolvedValueOnce(mockMainClient)
				.mockResolvedValueOnce(mockFallbackClient)
				.mockResolvedValueOnce(mockResearchClient);
			mockGenerateText
				.mockRejectedValueOnce(new Error('Main fail 1'))
				.mockRejectedValueOnce(new Error('Main fail 2'))
				.mockRejectedValueOnce(new Error('Main fail 3'))
				.mockRejectedValueOnce(new Error('Fallback fail 1'))
				.mockRejectedValueOnce(new Error('Fallback fail 2'))
				.mockRejectedValueOnce(new Error('Fallback fail 3'))
				.mockRejectedValueOnce(new Error('Research fail 1'))
				.mockRejectedValueOnce(new Error('Research fail 2'))
				.mockRejectedValueOnce(new Error('Research fail 3')); // Last error

			const serviceParams = { role: 'main', prompt: 'All fail test' };

			await expect(generateTextService(serviceParams)).rejects.toThrow(
				'Research fail 3' // Should throw the error from the LAST failed attempt
			);

			// Check calls
			expect(mockGetClient).toHaveBeenCalledTimes(3);
			expect(mockGenerateText).toHaveBeenCalledTimes(9); // 3 for each role
			expect(mockLog).toHaveBeenCalledWith(
				'error',
				'All roles in the sequence [main,fallback,research] failed.'
			);
		});

		test('should handle error getting fallback client', async () => {
			const mockMainClient = { type: 'mock-client', provider: 'main' };

			// Setup calls: main fails, getting fallback client fails, research succeeds (to test sequence)
			const mockResearchClient = { type: 'mock-client', provider: 'research' };
			mockGetClient
				.mockResolvedValueOnce(mockMainClient)
				.mockRejectedValueOnce(new Error('Cannot get fallback client'))
				.mockResolvedValueOnce(mockResearchClient);

			mockGenerateText
				.mockRejectedValueOnce(new Error('Main fail 1'))
				.mockRejectedValueOnce(new Error('Main fail 2'))
				.mockRejectedValueOnce(new Error('Main fail 3')) // Main fails 3 times
				.mockResolvedValue({ text: 'Research success' }); // Research succeeds on its 1st attempt

			const serviceParams = { role: 'main', prompt: 'Fallback client error' };

			// Should eventually succeed with research after main+fallback fail
			const result = await generateTextService(serviceParams);
			expect(result).toEqual({ text: 'Research success' });

			expect(mockGetClient).toHaveBeenCalledTimes(3); // Tries main, fallback (fails), research
			expect(mockGenerateText).toHaveBeenCalledTimes(4); // 3 main attempts, 1 research attempt
			expect(mockLog).toHaveBeenCalledWith(
				'error',
				'Service call failed for role fallback: Cannot get fallback client'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'warn',
				'Could not get client for role fallback, trying next role in sequence...'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'info',
				'New AI service call with role: research'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'info',
				expect.stringContaining(
					'generateTextService succeeded using role: research'
				)
			);
		});

		test('should try research after fallback fails if initial role is fallback', async () => {
			const mockFallbackClient = { type: 'mock-client', provider: 'fallback' };
			const mockResearchClient = { type: 'mock-client', provider: 'research' };

			mockGetClient
				.mockResolvedValueOnce(mockFallbackClient)
				.mockResolvedValueOnce(mockResearchClient);
			mockGenerateText
				.mockRejectedValueOnce(new Error('Fallback fail 1')) // Fallback 1
				.mockRejectedValueOnce(new Error('Fallback fail 2')) // Fallback 2
				.mockRejectedValueOnce(new Error('Fallback fail 3')) // Fallback 3
				.mockResolvedValue({ text: 'Research success' }); // Research 1

			const serviceParams = { role: 'fallback', prompt: 'Start with fallback' };
			const result = await generateTextService(serviceParams);

			expect(mockGetClient).toHaveBeenCalledTimes(2); // Fallback, Research
			expect(mockGetClient).toHaveBeenNthCalledWith(
				1,
				'fallback',
				undefined,
				undefined
			);
			expect(mockGetClient).toHaveBeenNthCalledWith(
				2,
				'research',
				undefined,
				undefined
			);
			expect(mockGenerateText).toHaveBeenCalledTimes(4); // 3 fallback, 1 research
			expect(result).toEqual({ text: 'Research success' });

			// Check logs for sequence
			expect(mockLog).toHaveBeenCalledWith(
				'info',
				'New AI service call with role: fallback'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'error',
				'Service call failed for role fallback: Fallback fail 3'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'warn',
				expect.stringContaining(
					'Retries exhausted or non-retryable error for role fallback'
				)
			);
			expect(mockLog).toHaveBeenCalledWith(
				'info',
				'New AI service call with role: research'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'info',
				expect.stringContaining(
					'generateTextService succeeded using role: research'
				)
			);
		});

		test('should try fallback after research fails if initial role is research', async () => {
			const mockResearchClient = { type: 'mock-client', provider: 'research' };
			const mockFallbackClient = { type: 'mock-client', provider: 'fallback' };

			mockGetClient
				.mockResolvedValueOnce(mockResearchClient)
				.mockResolvedValueOnce(mockFallbackClient);
			mockGenerateText
				.mockRejectedValueOnce(new Error('Research fail 1')) // Research 1
				.mockRejectedValueOnce(new Error('Research fail 2')) // Research 2
				.mockRejectedValueOnce(new Error('Research fail 3')) // Research 3
				.mockResolvedValue({ text: 'Fallback success' }); // Fallback 1

			const serviceParams = { role: 'research', prompt: 'Start with research' };
			const result = await generateTextService(serviceParams);

			expect(mockGetClient).toHaveBeenCalledTimes(2); // Research, Fallback
			expect(mockGetClient).toHaveBeenNthCalledWith(
				1,
				'research',
				undefined,
				undefined
			);
			expect(mockGetClient).toHaveBeenNthCalledWith(
				2,
				'fallback',
				undefined,
				undefined
			);
			expect(mockGenerateText).toHaveBeenCalledTimes(4); // 3 research, 1 fallback
			expect(result).toEqual({ text: 'Fallback success' });

			// Check logs for sequence
			expect(mockLog).toHaveBeenCalledWith(
				'info',
				'New AI service call with role: research'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'error',
				'Service call failed for role research: Research fail 3'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'warn',
				expect.stringContaining(
					'Retries exhausted or non-retryable error for role research'
				)
			);
			expect(mockLog).toHaveBeenCalledWith(
				'info',
				'New AI service call with role: fallback'
			);
			expect(mockLog).toHaveBeenCalledWith(
				'info',
				expect.stringContaining(
					'generateTextService succeeded using role: fallback'
				)
			);
		});

		test('should use default sequence and log warning for unknown initial role', async () => {
			const mockMainClient = { type: 'mock-client', provider: 'main' };
			const mockFallbackClient = { type: 'mock-client', provider: 'fallback' };

			mockGetClient
				.mockResolvedValueOnce(mockMainClient)
				.mockResolvedValueOnce(mockFallbackClient);
			mockGenerateText
				.mockRejectedValueOnce(new Error('Main fail 1')) // Main 1
				.mockRejectedValueOnce(new Error('Main fail 2')) // Main 2
				.mockRejectedValueOnce(new Error('Main fail 3')) // Main 3
				.mockResolvedValue({ text: 'Fallback success' }); // Fallback 1

			const serviceParams = {
				role: 'invalid-role',
				prompt: 'Unknown role test'
			};
			const result = await generateTextService(serviceParams);

			// Check warning log for unknown role
			expect(mockLog).toHaveBeenCalledWith(
				'warn',
				'Unknown initial role: invalid-role. Defaulting to main -> fallback -> research sequence.'
			);

			// Check it followed the default main -> fallback sequence
			expect(mockGetClient).toHaveBeenCalledTimes(2); // Main, Fallback
			expect(mockGetClient).toHaveBeenNthCalledWith(
				1,
				'main',
				undefined,
				undefined
			);
			expect(mockGetClient).toHaveBeenNthCalledWith(
				2,
				'fallback',
				undefined,
				undefined
			);
			expect(mockGenerateText).toHaveBeenCalledTimes(4); // 3 main, 1 fallback
			expect(result).toEqual({ text: 'Fallback success' });
		});
	});
});
