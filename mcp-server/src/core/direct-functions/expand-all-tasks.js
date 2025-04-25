/**
 * Direct function wrapper for expandAllTasks
 */

import { expandAllTasks } from '../../../../scripts/modules/task-manager.js';
import {
	enableSilentMode,
	disableSilentMode,
	isSilentMode
} from '../../../../scripts/modules/utils.js';
import path from 'path';
import fs from 'fs';

/**
 * Expand all pending tasks with subtasks (Direct Function Wrapper)
 * @param {Object} args - Function arguments
 * @param {string} args.tasksJsonPath - Explicit path to the tasks.json file.
 * @param {number|string} [args.num] - Number of subtasks to generate
 * @param {boolean} [args.research] - Enable research-backed subtask generation
 * @param {string} [args.prompt] - Additional context to guide subtask generation
 * @param {boolean} [args.force] - Force regeneration of subtasks for tasks that already have them
 * @param {Object} log - Logger object from FastMCP
 * @param {Object} context - Context object containing session
 * @returns {Promise<{success: boolean, data?: Object, error?: {code: string, message: string}}>}
 */
export async function expandAllTasksDirect(args, log, context = {}) {
	const { session } = context; // Extract session
	// Destructure expected args
	const { tasksJsonPath, num, research, prompt, force } = args;

	// Create the standard logger wrapper
	const logWrapper = {
		info: (message, ...args) => log.info(message, ...args),
		warn: (message, ...args) => log.warn(message, ...args),
		error: (message, ...args) => log.error(message, ...args),
		debug: (message, ...args) => log.debug && log.debug(message, ...args), // Handle optional debug
		success: (message, ...args) => log.info(message, ...args) // Map success to info if needed
	};

	if (!tasksJsonPath) {
		log.error('expandAllTasksDirect called without tasksJsonPath');
		return {
			success: false,
			error: {
				code: 'MISSING_ARGUMENT',
				message: 'tasksJsonPath is required'
			}
		};
	}

	enableSilentMode(); // Enable silent mode for the core function call
	try {
		log.info(
			`Calling core expandAllTasks with args: ${JSON.stringify({ num, research, prompt, force })}`
		);

		// Parse parameters (ensure correct types)
		const numSubtasks = num ? parseInt(num, 10) : undefined;
		const useResearch = research === true;
		const additionalContext = prompt || '';
		const forceFlag = force === true;

		// Call the core function, passing the logger wrapper and session
		const result = await expandAllTasks(
			tasksJsonPath, // Use the provided path
			numSubtasks,
			useResearch,
			additionalContext,
			forceFlag,
			{ mcpLog: logWrapper, session }, // Pass the wrapper and session
			'json' // Explicitly request JSON output format
		);

		// Core function now returns a summary object
		return {
			success: true,
			data: {
				message: `Expand all operation completed. Expanded: ${result.expandedCount}, Failed: ${result.failedCount}, Skipped: ${result.skippedCount}`,
				details: result // Include the full result details
			}
		};
	} catch (error) {
		// Log the error using the MCP logger
		log.error(`Error during core expandAllTasks execution: ${error.message}`);
		// Optionally log stack trace if available and debug enabled
		// if (error.stack && log.debug) { log.debug(error.stack); }

		return {
			success: false,
			error: {
				code: 'CORE_FUNCTION_ERROR', // Or a more specific code if possible
				message: error.message
			}
		};
	} finally {
		disableSilentMode(); // IMPORTANT: Ensure silent mode is always disabled
	}
}
