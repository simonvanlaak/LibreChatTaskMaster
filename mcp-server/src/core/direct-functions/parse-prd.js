/**
 * parse-prd.js
 * Direct function implementation for parsing PRD documents
 */

import path from 'path';
import fs from 'fs';
import { parsePRD } from '../../../../scripts/modules/task-manager.js';
import {
	enableSilentMode,
	disableSilentMode
} from '../../../../scripts/modules/utils.js';

/**
 * Direct function wrapper for parsing PRD documents and generating tasks.
 *
 * @param {Object} args - Command arguments containing projectRoot, input, output, numTasks options.
 * @param {Object} log - Logger object.
 * @param {Object} context - Context object containing session data.
 * @returns {Promise<Object>} - Result object with success status and data/error information.
 */
export async function parsePRDDirect(args, log, context = {}) {
	const { session } = context; // Only extract session

	try {
		log.info(`Parsing PRD document with args: ${JSON.stringify(args)}`);

		// Validate required parameters
		if (!args.projectRoot) {
			const errorMessage = 'Project root is required for parsePRDDirect';
			log.error(errorMessage);
			return {
				success: false,
				error: { code: 'MISSING_PROJECT_ROOT', message: errorMessage },
				fromCache: false
			};
		}
		if (!args.input) {
			const errorMessage = 'Input file path is required for parsePRDDirect';
			log.error(errorMessage);
			return {
				success: false,
				error: { code: 'MISSING_INPUT_PATH', message: errorMessage },
				fromCache: false
			};
		}
		if (!args.output) {
			const errorMessage = 'Output file path is required for parsePRDDirect';
			log.error(errorMessage);
			return {
				success: false,
				error: { code: 'MISSING_OUTPUT_PATH', message: errorMessage },
				fromCache: false
			};
		}

		// Resolve input path (expecting absolute path or path relative to project root)
		const projectRoot = args.projectRoot;
		const inputPath = path.isAbsolute(args.input)
			? args.input
			: path.resolve(projectRoot, args.input);

		// Verify input file exists
		if (!fs.existsSync(inputPath)) {
			const errorMessage = `Input file not found: ${inputPath}`;
			log.error(errorMessage);
			return {
				success: false,
				error: {
					code: 'INPUT_FILE_NOT_FOUND',
					message: errorMessage,
					details: `Checked path: ${inputPath}\nProject root: ${projectRoot}\nInput argument: ${args.input}`
				},
				fromCache: false
			};
		}

		// Resolve output path (expecting absolute path or path relative to project root)
		const outputPath = path.isAbsolute(args.output)
			? args.output
			: path.resolve(projectRoot, args.output);

		// Ensure output directory exists
		const outputDir = path.dirname(outputPath);
		if (!fs.existsSync(outputDir)) {
			log.info(`Creating output directory: ${outputDir}`);
			fs.mkdirSync(outputDir, { recursive: true });
		}

		// Parse number of tasks - handle both string and number values
		let numTasks = 10; // Default
		if (args.numTasks) {
			numTasks =
				typeof args.numTasks === 'string'
					? parseInt(args.numTasks, 10)
					: args.numTasks;
			if (isNaN(numTasks)) {
				numTasks = 10; // Fallback to default if parsing fails
				log.warn(`Invalid numTasks value: ${args.numTasks}. Using default: 10`);
			}
		}

		log.info(
			`Preparing to parse PRD from ${inputPath} and output to ${outputPath} with ${numTasks} tasks`
		);

		// Create the logger wrapper for proper logging in the core function
		const logWrapper = {
			info: (message, ...args) => log.info(message, ...args),
			warn: (message, ...args) => log.warn(message, ...args),
			error: (message, ...args) => log.error(message, ...args),
			debug: (message, ...args) => log.debug && log.debug(message, ...args),
			success: (message, ...args) => log.info(message, ...args) // Map success to info
		};

		// Enable silent mode to prevent console logs from interfering with JSON response
		enableSilentMode();
		try {
			// Execute core parsePRD function - It now handles AI internally
			const tasksDataResult = await parsePRD(inputPath, outputPath, numTasks, {
				mcpLog: logWrapper,
				session
			});

			// Check the result from the core function (assuming it might return data or null/undefined)
			if (!tasksDataResult || !tasksDataResult.tasks) {
				throw new Error(
					'Core parsePRD function did not return valid task data.'
				);
			}

			log.info(
				`Successfully parsed PRD and generated ${tasksDataResult.tasks?.length || 0} tasks`
			);

			return {
				success: true,
				data: {
					message: `Successfully generated ${tasksDataResult.tasks?.length || 0} tasks from PRD`,
					taskCount: tasksDataResult.tasks?.length || 0,
					outputPath
				},
				fromCache: false // This operation always modifies state
			};
		} finally {
			// Always restore normal logging
			disableSilentMode();
		}
	} catch (error) {
		// Make sure to restore normal logging even if there's an error
		disableSilentMode();

		log.error(`Error parsing PRD: ${error.message}`);
		return {
			success: false,
			error: {
				code: error.code || 'PARSE_PRD_ERROR', // Use error code if available
				message: error.message || 'Unknown error parsing PRD'
			},
			fromCache: false
		};
	}
}
