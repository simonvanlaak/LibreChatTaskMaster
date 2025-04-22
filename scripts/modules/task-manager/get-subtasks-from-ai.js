import { log, isSilentMode } from '../utils.js';

import {
	_handleAnthropicStream,
	getConfiguredAnthropicClient,
	parseSubtasksFromText
} from '../ai-services.js';

// Import necessary config getters
import {
	getMainModelId,
	getMainMaxTokens,
	getMainTemperature,
	getResearchModelId,
	getResearchMaxTokens,
	getResearchTemperature
} from '../config-manager.js';

/**
 * Call AI to generate subtasks based on a prompt
 * @param {string} prompt - The prompt to send to the AI
 * @param {boolean} useResearch - Whether to use Perplexity for research
 * @param {Object} session - Session object from MCP
 * @param {Object} mcpLog - MCP logger object
 * @returns {Object} - Object containing generated subtasks
 */
async function getSubtasksFromAI(
	prompt,
	useResearch = false,
	session = null,
	mcpLog = null
) {
	try {
		// Get the configured client
		const client = getConfiguredAnthropicClient(session);

		// Prepare API parameters
		const apiParams = {
			model: getMainModelId(session),
			max_tokens: getMainMaxTokens(session),
			temperature: getMainTemperature(session),
			system:
				'You are an AI assistant helping with task breakdown for software development.',
			messages: [{ role: 'user', content: prompt }]
		};

		if (mcpLog) {
			mcpLog.info('Calling AI to generate subtasks');
		}

		let responseText;

		// Call the AI - with research if requested
		if (useResearch && perplexity) {
			if (mcpLog) {
				mcpLog.info('Using Perplexity AI for research-backed subtasks');
			}

			const perplexityModel = getResearchModelId(session);
			const result = await perplexity.chat.completions.create({
				model: perplexityModel,
				messages: [
					{
						role: 'system',
						content:
							'You are an AI assistant helping with task breakdown for software development. Research implementation details and provide comprehensive subtasks.'
					},
					{ role: 'user', content: prompt }
				],
				temperature: getResearchTemperature(session),
				max_tokens: getResearchMaxTokens(session)
			});

			responseText = result.choices[0].message.content;
		} else {
			// Use regular Claude
			if (mcpLog) {
				mcpLog.info('Using Claude for generating subtasks');
			}

			// Call the streaming API
			responseText = await _handleAnthropicStream(
				client,
				apiParams,
				{ mcpLog, silentMode: isSilentMode() },
				!isSilentMode()
			);
		}

		// Ensure we have a valid response
		if (!responseText) {
			throw new Error('Empty response from AI');
		}

		// Try to parse the subtasks
		try {
			const parsedSubtasks = parseSubtasksFromText(responseText);
			if (
				!parsedSubtasks ||
				!Array.isArray(parsedSubtasks) ||
				parsedSubtasks.length === 0
			) {
				throw new Error(
					'Failed to parse valid subtasks array from AI response'
				);
			}
			return { subtasks: parsedSubtasks };
		} catch (parseError) {
			if (mcpLog) {
				mcpLog.error(`Error parsing subtasks: ${parseError.message}`);
				mcpLog.error(`Response start: ${responseText.substring(0, 200)}...`);
			} else {
				log('error', `Error parsing subtasks: ${parseError.message}`);
			}
			// Return error information instead of fallback subtasks
			return {
				error: parseError.message,
				taskId: null, // This will be filled in by the calling function
				suggestion:
					'Use \'task-master update-task --id=<id> --prompt="Generate subtasks for this task"\' to manually create subtasks.'
			};
		}
	} catch (error) {
		if (mcpLog) {
			mcpLog.error(`Error generating subtasks: ${error.message}`);
		} else {
			log('error', `Error generating subtasks: ${error.message}`);
		}
		// Return error information instead of fallback subtasks
		return {
			error: error.message,
			taskId: null, // This will be filled in by the calling function
			suggestion:
				'Use \'task-master update-task --id=<id> --prompt="Generate subtasks for this task"\' to manually create subtasks.'
		};
	}
}

export default getSubtasksFromAI;
