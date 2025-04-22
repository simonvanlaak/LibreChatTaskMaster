import fs from 'fs';
import path from 'path';

import { log, readJSON, writeJSON, isSilentMode } from '../utils.js';

import { startLoadingIndicator, stopLoadingIndicator } from '../ui.js';

import {
	generateSubtasksWithPerplexity,
	_handleAnthropicStream,
	getConfiguredAnthropicClient,
	parseSubtasksFromText
} from '../ai-services.js';

import {
	getDefaultSubtasks,
	getMainModelId,
	getMainMaxTokens,
	getMainTemperature
} from '../config-manager.js';
import generateTaskFiles from './generate-task-files.js';

/**
 * Expand a task into subtasks
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {number} taskId - Task ID to expand
 * @param {number} numSubtasks - Number of subtasks to generate
 * @param {boolean} useResearch - Whether to use research with Perplexity
 * @param {string} additionalContext - Additional context
 * @param {Object} options - Options for expanding tasks
 * @param {function} options.reportProgress - Function to report progress
 * @param {Object} options.mcpLog - MCP logger object
 * @param {Object} options.session - Session object from MCP
 * @returns {Promise<Object>} Expanded task
 */
async function expandTask(
	tasksPath,
	taskId,
	numSubtasks,
	useResearch = false,
	additionalContext = '',
	{ reportProgress, mcpLog, session } = {}
) {
	// Determine output format based on mcpLog presence (simplification)
	const outputFormat = mcpLog ? 'json' : 'text';

	// Create custom reporter that checks for MCP log and silent mode
	const report = (message, level = 'info') => {
		if (mcpLog) {
			mcpLog[level](message);
		} else if (!isSilentMode() && outputFormat === 'text') {
			// Only log to console if not in silent mode and outputFormat is 'text'
			log(level, message);
		}
	};

	// Keep the mcpLog check for specific MCP context logging
	if (mcpLog) {
		mcpLog.info(
			`expandTask - reportProgress available: ${!!reportProgress}, session available: ${!!session}`
		);
	}

	try {
		// Read the tasks.json file
		const data = readJSON(tasksPath);
		if (!data || !data.tasks) {
			throw new Error('Invalid or missing tasks.json');
		}

		// Find the task
		const task = data.tasks.find((t) => t.id === parseInt(taskId, 10));
		if (!task) {
			throw new Error(`Task with ID ${taskId} not found`);
		}

		report(`Expanding task ${taskId}: ${task.title}`);

		// If the task already has subtasks and force flag is not set, return the existing subtasks
		if (task.subtasks && task.subtasks.length > 0) {
			report(`Task ${taskId} already has ${task.subtasks.length} subtasks`);
			return task;
		}

		// Determine the number of subtasks to generate
		let subtaskCount = parseInt(numSubtasks, 10) || getDefaultSubtasks(); // Use getter

		// Check if we have a complexity analysis for this task
		let taskAnalysis = null;
		try {
			const reportPath = 'scripts/task-complexity-report.json';
			if (fs.existsSync(reportPath)) {
				const report = readJSON(reportPath);
				if (report && report.complexityAnalysis) {
					taskAnalysis = report.complexityAnalysis.find(
						(a) => a.taskId === task.id
					);
				}
			}
		} catch (error) {
			report(`Could not read complexity analysis: ${error.message}`, 'warn');
		}

		// Use recommended subtask count if available
		if (taskAnalysis) {
			report(
				`Found complexity analysis for task ${taskId}: Score ${taskAnalysis.complexityScore}/10`
			);

			// Use recommended number of subtasks if available
			if (
				taskAnalysis.recommendedSubtasks &&
				subtaskCount === getDefaultSubtasks() // Use getter
			) {
				subtaskCount = taskAnalysis.recommendedSubtasks;
				report(`Using recommended number of subtasks: ${subtaskCount}`);
			}

			// Use the expansion prompt from analysis as additional context
			if (taskAnalysis.expansionPrompt && !additionalContext) {
				additionalContext = taskAnalysis.expansionPrompt;
				report(`Using expansion prompt from complexity analysis`);
			}
		}

		// Generate subtasks with AI
		let generatedSubtasks = [];

		// Only create loading indicator if not in silent mode and no mcpLog (CLI mode)
		let loadingIndicator = null;
		if (!isSilentMode() && !mcpLog) {
			loadingIndicator = startLoadingIndicator(
				useResearch
					? 'Generating research-backed subtasks...'
					: 'Generating subtasks...'
			);
		}

		try {
			// Determine the next subtask ID
			const nextSubtaskId = 1;

			if (useResearch) {
				// Use Perplexity for research-backed subtasks
				if (!perplexity) {
					report(
						'Perplexity AI is not available. Falling back to Claude AI.',
						'warn'
					);
					useResearch = false;
				} else {
					report('Using Perplexity for research-backed subtasks');
					generatedSubtasks = await generateSubtasksWithPerplexity(
						task,
						subtaskCount,
						nextSubtaskId,
						additionalContext,
						{ reportProgress, mcpLog, silentMode: isSilentMode(), session }
					);
				}
			}

			if (!useResearch) {
				report('Using regular Claude for generating subtasks');

				// Use our getConfiguredAnthropicClient function instead of getAnthropicClient
				const client = getConfiguredAnthropicClient(session);

				// Build the system prompt
				const systemPrompt = `You are an AI assistant helping with task breakdown for software development. 
You need to break down a high-level task into ${subtaskCount} specific subtasks that can be implemented one by one.

Subtasks should:
1. Be specific and actionable implementation steps
2. Follow a logical sequence
3. Each handle a distinct part of the parent task
4. Include clear guidance on implementation approach
5. Have appropriate dependency chains between subtasks
6. Collectively cover all aspects of the parent task

For each subtask, provide:
- A clear, specific title
- Detailed implementation steps
- Dependencies on previous subtasks
- Testing approach

Each subtask should be implementable in a focused coding session.`;

				const contextPrompt = additionalContext
					? `\n\nAdditional context to consider: ${additionalContext}`
					: '';

				const userPrompt = `Please break down this task into ${subtaskCount} specific, actionable subtasks:

Task ID: ${task.id}
Title: ${task.title}
Description: ${task.description}
Current details: ${task.details || 'None provided'}
${contextPrompt}

Return exactly ${subtaskCount} subtasks with the following JSON structure:
[
  {
    "id": ${nextSubtaskId},
    "title": "First subtask title",
    "description": "Detailed description",
    "dependencies": [], 
    "details": "Implementation details"
  },
  ...more subtasks...
]

Note on dependencies: Subtasks can depend on other subtasks with lower IDs. Use an empty array if there are no dependencies.`;

				// Prepare API parameters using getters
				const apiParams = {
					model: getMainModelId(session),
					max_tokens: getMainMaxTokens(session),
					temperature: getMainTemperature(session),
					system: systemPrompt,
					messages: [{ role: 'user', content: userPrompt }]
				};

				// Call the streaming API using our helper
				const responseText = await _handleAnthropicStream(
					client,
					apiParams,
					{ reportProgress, mcpLog, silentMode: isSilentMode() }, // Pass isSilentMode() directly
					!isSilentMode() // Only use CLI mode if not in silent mode
				);

				// Parse the subtasks from the response
				generatedSubtasks = parseSubtasksFromText(
					responseText,
					nextSubtaskId,
					subtaskCount,
					task.id
				);
			}

			// Add the generated subtasks to the task
			task.subtasks = generatedSubtasks;

			// Write the updated tasks back to the file
			writeJSON(tasksPath, data);

			// Generate the individual task files
			await generateTaskFiles(tasksPath, path.dirname(tasksPath));

			return task;
		} catch (error) {
			report(`Error expanding task: ${error.message}`, 'error');
			throw error;
		} finally {
			// Always stop the loading indicator if we created one
			if (loadingIndicator) {
				stopLoadingIndicator(loadingIndicator);
			}
		}
	} catch (error) {
		report(`Error expanding task: ${error.message}`, 'error');
		throw error;
	}
}

export default expandTask;
