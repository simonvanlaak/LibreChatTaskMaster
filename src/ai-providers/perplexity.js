/**
 * src/ai-providers/perplexity.js
 *
 * Implementation for interacting with Perplexity models
 * using the Vercel AI SDK.
 */
import { createPerplexity } from '@ai-sdk/perplexity';
import { generateText, streamText, generateObject, streamObject } from 'ai';
import { log } from '../../scripts/modules/utils.js';

// --- Client Instantiation ---
// Similar to Anthropic, this expects the resolved API key to be passed in.
function getClient(apiKey) {
	if (!apiKey) {
		throw new Error('Perplexity API key is required.');
	}
	// Create and return a new instance directly
	return createPerplexity({
		apiKey: apiKey
	});
}

// --- Standardized Service Function Implementations ---

/**
 * Generates text using a Perplexity model.
 *
 * @param {object} params - Parameters for text generation.
 * @param {string} params.apiKey - The Perplexity API key.
 * @param {string} params.modelId - The Perplexity model ID (e.g., 'sonar-small-32k-online').
 * @param {string} [params.systemPrompt] - The system prompt (optional for some models).
 * @param {string} params.userPrompt - The user prompt.
 * @param {number} [params.maxTokens] - Maximum tokens.
 * @param {number} [params.temperature] - Temperature.
 * @returns {Promise<string>} Generated text.
 */
export async function generatePerplexityText({
	apiKey,
	modelId,
	systemPrompt,
	userPrompt,
	maxTokens,
	temperature
}) {
	log('debug', `Generating Perplexity text with model: ${modelId}`);
	try {
		const client = getClient(apiKey);
		const result = await generateText({
			model: client(modelId),
			system: systemPrompt, // Pass system prompt if provided
			prompt: userPrompt,
			maxTokens: maxTokens,
			temperature: temperature
		});
		log(
			'debug',
			`Perplexity generateText result received. Tokens: ${result.usage.completionTokens}/${result.usage.promptTokens}`
		);
		return result.text;
	} catch (error) {
		log('error', `Perplexity generateText failed: ${error.message}`);
		throw error;
	}
}

/**
 * Streams text using a Perplexity model.
 *
 * @param {object} params - Parameters for text streaming.
 * @param {string} params.apiKey - The Perplexity API key.
 * @param {string} params.modelId - The Perplexity model ID.
 * @param {string} [params.systemPrompt] - The system prompt.
 * @param {string} params.userPrompt - The user prompt.
 * @param {number} [params.maxTokens] - Maximum tokens.
 * @param {number} [params.temperature] - Temperature.
 * @returns {Promise<ReadableStream<string>>} Stream of text deltas.
 */
export async function streamPerplexityText({
	apiKey,
	modelId,
	systemPrompt,
	userPrompt,
	maxTokens,
	temperature
}) {
	log('debug', `Streaming Perplexity text with model: ${modelId}`);
	try {
		const client = getClient(apiKey);
		const stream = await streamText({
			model: client(modelId),
			system: systemPrompt,
			prompt: userPrompt,
			maxTokens: maxTokens,
			temperature: temperature
		});
		return stream.textStream;
	} catch (error) {
		log('error', `Perplexity streamText failed: ${error.message}`);
		throw error;
	}
}

/**
 * Generates a structured object using a Perplexity model.
 * Note: Perplexity's support for structured output/tool use might vary.
 * We assume it follows OpenAI's function/tool calling conventions if supported by the SDK.
 *
 * @param {object} params - Parameters for object generation.
 * @param {string} params.apiKey - The Perplexity API key.
 * @param {string} params.modelId - The Perplexity model ID.
 * @param {string} [params.systemPrompt] - System prompt.
 * @param {string} params.userPrompt - User prompt.
 * @param {import('zod').ZodSchema} params.schema - Zod schema.
 * @param {string} params.objectName - Name for the object/tool.
 * @param {number} [params.maxTokens] - Maximum tokens.
 * @param {number} [params.temperature] - Temperature.
 * @param {number} [params.maxRetries] - Max retries.
 * @returns {Promise<object>} Generated object.
 */
export async function generatePerplexityObject({
	apiKey,
	modelId,
	systemPrompt,
	userPrompt,
	schema,
	objectName = 'generated_object',
	maxTokens,
	temperature,
	maxRetries = 3
}) {
	log(
		'debug',
		`Generating Perplexity object ('${objectName}') with model: ${modelId}`
	);
	try {
		const client = getClient(apiKey);
		// Assuming Perplexity follows OpenAI-like tool mode if supported by SDK
		const result = await generateObject({
			model: client(modelId),
			mode: 'tool',
			schema: schema,
			system: systemPrompt,
			prompt: userPrompt,
			tool: {
				name: objectName,
				description: `Generate a ${objectName} based on the prompt.`
			},
			maxTokens: maxTokens,
			temperature: temperature,
			maxRetries: maxRetries
		});
		log(
			'debug',
			`Perplexity generateObject result received. Tokens: ${result.usage.completionTokens}/${result.usage.promptTokens}`
		);
		return result.object;
	} catch (error) {
		log(
			'error',
			`Perplexity generateObject ('${objectName}') failed: ${error.message}`
		);
		// Check if the error indicates lack of tool support
		if (
			error.message.includes('tool use') ||
			error.message.includes('structured output')
		) {
			log(
				'warn',
				`Model ${modelId} might not support structured output via tools.`
			);
		}
		throw error;
	}
}

// TODO: Implement streamPerplexityObject if needed and supported.
