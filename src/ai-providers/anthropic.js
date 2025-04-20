/**
 * src/ai-providers/anthropic.js
 *
 * Implementation for interacting with Anthropic models (e.g., Claude)
 * using the Vercel AI SDK.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, streamText, generateObject, streamObject } from 'ai';
import { log } from '../../scripts/modules/utils.js'; // Assuming utils is accessible

// TODO: Implement standardized functions for generateText, streamText, generateObject

// --- Client Instantiation ---
// Note: API key resolution should ideally happen closer to the call site
// using the config manager/resolver which checks process.env and session.env.
// This is a placeholder for basic functionality.
// Remove the global variable and caching logic
// let anthropicClient;

function getClient(apiKey) {
	if (!apiKey) {
		// In a real scenario, this would use the config resolver.
		// Throwing error here if key isn't passed for simplicity.
		// Keep the error check for the passed key
		throw new Error('Anthropic API key is required.');
	}
	// Remove the check for anthropicClient
	// if (!anthropicClient) {
	// TODO: Explore passing options like default headers if needed
	// Create and return a new instance directly
	return createAnthropic({
		apiKey: apiKey
	});
	// }
	// return anthropicClient;
}

// --- Standardized Service Function Implementations ---

/**
 * Generates text using an Anthropic model.
 *
 * @param {object} params - Parameters for the text generation.
 * @param {string} params.apiKey - The Anthropic API key.
 * @param {string} params.modelId - The specific Anthropic model ID to use (e.g., 'claude-3-haiku-20240307').
 * @param {string} params.systemPrompt - The system prompt.
 * @param {string} params.userPrompt - The user prompt.
 * @param {number} [params.maxTokens] - Maximum tokens for the response.
 * @param {number} [params.temperature] - Temperature for generation.
 * @returns {Promise<string>} The generated text content.
 * @throws {Error} If the API call fails.
 */
export async function generateAnthropicText({
	apiKey,
	modelId,
	systemPrompt,
	userPrompt,
	maxTokens,
	temperature
}) {
	log('debug', `Generating Anthropic text with model: ${modelId}`);
	try {
		const client = getClient(apiKey);
		const result = await generateText({
			model: client(modelId), // Pass the model ID to the client instance
			system: systemPrompt,
			prompt: userPrompt,
			maxTokens: maxTokens,
			temperature: temperature
			// TODO: Add other relevant parameters like topP, topK if needed
		});
		log(
			'debug',
			`Anthropic generateText result received. Tokens: ${result.usage.completionTokens}/${result.usage.promptTokens}`
		);
		return result.text;
	} catch (error) {
		log('error', `Anthropic generateText failed: ${error.message}`);
		// Consider more specific error handling or re-throwing a standardized error
		throw error;
	}
}

/**
 * Streams text using an Anthropic model.
 *
 * @param {object} params - Parameters for the text streaming.
 * @param {string} params.apiKey - The Anthropic API key.
 * @param {string} params.modelId - The specific Anthropic model ID.
 * @param {string} params.systemPrompt - The system prompt.
 * @param {string} params.userPrompt - The user prompt.
 * @param {number} [params.maxTokens] - Maximum tokens for the response.
 * @param {number} [params.temperature] - Temperature for generation.
 * @returns {Promise<ReadableStream<string>>} A readable stream of text deltas.
 * @throws {Error} If the API call fails to initiate the stream.
 */
export async function streamAnthropicText({
	apiKey,
	modelId,
	systemPrompt,
	userPrompt,
	maxTokens,
	temperature
}) {
	log('debug', `Streaming Anthropic text with model: ${modelId}`);
	try {
		const client = getClient(apiKey);
		const stream = await streamText({
			model: client(modelId),
			system: systemPrompt,
			prompt: userPrompt,
			maxTokens: maxTokens,
			temperature: temperature
			// TODO: Add other relevant parameters
		});

		// We return the stream directly. The consumer will handle reading it.
		// We could potentially wrap it or add logging within the stream pipe if needed.
		return stream.textStream;
	} catch (error) {
		log('error', `Anthropic streamText failed: ${error.message}`);
		throw error;
	}
}

/**
 * Generates a structured object using an Anthropic model.
 * NOTE: Anthropic's tool/function calling support might have limitations
 * compared to OpenAI, especially regarding complex schemas or enforcement.
 * The Vercel AI SDK attempts to abstract this.
 *
 * @param {object} params - Parameters for object generation.
 * @param {string} params.apiKey - The Anthropic API key.
 * @param {string} params.modelId - The specific Anthropic model ID.
 * @param {string} params.systemPrompt - The system prompt (optional).
 * @param {string} params.userPrompt - The user prompt describing the desired object.
 * @param {import('zod').ZodSchema} params.schema - The Zod schema for the object.
 * @param {string} params.objectName - A name for the object/tool.
 * @param {number} [params.maxTokens] - Maximum tokens for the response.
 * @param {number} [params.temperature] - Temperature for generation.
 * @param {number} [params.maxRetries] - Max retries for validation/generation.
 * @returns {Promise<object>} The generated object matching the schema.
 * @throws {Error} If generation or validation fails.
 */
export async function generateAnthropicObject({
	apiKey,
	modelId,
	systemPrompt,
	userPrompt,
	schema,
	objectName = 'generated_object', // Provide a default name
	maxTokens,
	temperature,
	maxRetries = 3
}) {
	log(
		'debug',
		`Generating Anthropic object ('${objectName}') with model: ${modelId}`
	);
	try {
		const client = getClient(apiKey);
		const result = await generateObject({
			model: client(modelId),
			mode: 'tool', // Anthropic generally uses 'tool' mode for structured output
			schema: schema,
			system: systemPrompt,
			prompt: userPrompt,
			tool: {
				name: objectName, // Use the provided or default name
				description: `Generate a ${objectName} based on the prompt.` // Simple description
			},
			maxTokens: maxTokens,
			temperature: temperature,
			maxRetries: maxRetries
		});
		log(
			'debug',
			`Anthropic generateObject result received. Tokens: ${result.usage.completionTokens}/${result.usage.promptTokens}`
		);
		return result.object;
	} catch (error) {
		log(
			'error',
			`Anthropic generateObject ('${objectName}') failed: ${error.message}`
		);
		throw error;
	}
}

// TODO: Implement streamAnthropicObject if needed and supported well by the SDK for Anthropic.
// The basic structure would be similar to generateAnthropicObject but using streamObject.
