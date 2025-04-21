import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import boxen from 'boxen';

import {
	log,
	writeJSON,
	enableSilentMode,
	disableSilentMode,
	isSilentMode
} from '../utils.js';

import { callClaude } from '../ai-services.js';
import { getDebugFlag } from '../config-manager.js';
import generateTaskFiles from './generate-task-files.js';

/**
 * Parse a PRD file and generate tasks
 * @param {string} prdPath - Path to the PRD file
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {number} numTasks - Number of tasks to generate
 * @param {Object} options - Additional options
 * @param {Object} options.reportProgress - Function to report progress to MCP server (optional)
 * @param {Object} options.mcpLog - MCP logger object (optional)
 * @param {Object} options.session - Session object from MCP server (optional)
 * @param {Object} aiClient - AI client to use (optional)
 * @param {Object} modelConfig - Model configuration (optional)
 */
async function parsePRD(
	prdPath,
	tasksPath,
	numTasks,
	options = {},
	aiClient = null,
	modelConfig = null
) {
	const { reportProgress, mcpLog, session } = options;

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

	try {
		report(`Parsing PRD file: ${prdPath}`, 'info');

		// Read the PRD content
		const prdContent = fs.readFileSync(prdPath, 'utf8');

		// Call Claude to generate tasks, passing the provided AI client if available
		const tasksData = await callClaude(
			prdContent,
			prdPath,
			numTasks,
			0,
			{ reportProgress, mcpLog, session },
			aiClient,
			modelConfig
		);

		// Create the directory if it doesn't exist
		const tasksDir = path.dirname(tasksPath);
		if (!fs.existsSync(tasksDir)) {
			fs.mkdirSync(tasksDir, { recursive: true });
		}
		// Write the tasks to the file
		writeJSON(tasksPath, tasksData);
		report(
			`Successfully generated ${tasksData.tasks.length} tasks from PRD`,
			'success'
		);
		report(`Tasks saved to: ${tasksPath}`, 'info');

		// Generate individual task files
		if (reportProgress && mcpLog) {
			// Enable silent mode when being called from MCP server
			enableSilentMode();
			await generateTaskFiles(tasksPath, tasksDir);
			disableSilentMode();
		} else {
			await generateTaskFiles(tasksPath, tasksDir);
		}

		// Only show success boxes for text output (CLI)
		if (outputFormat === 'text') {
			console.log(
				boxen(
					chalk.green(
						`Successfully generated ${tasksData.tasks.length} tasks from PRD`
					),
					{ padding: 1, borderColor: 'green', borderStyle: 'round' }
				)
			);

			console.log(
				boxen(
					chalk.white.bold('Next Steps:') +
						'\n\n' +
						`${chalk.cyan('1.')} Run ${chalk.yellow('task-master list')} to view all tasks\n` +
						`${chalk.cyan('2.')} Run ${chalk.yellow('task-master expand --id=<id>')} to break down a task into subtasks`,
					{
						padding: 1,
						borderColor: 'cyan',
						borderStyle: 'round',
						margin: { top: 1 }
					}
				)
			);
		}

		return tasksData;
	} catch (error) {
		report(`Error parsing PRD: ${error.message}`, 'error');

		// Only show error UI for text output (CLI)
		if (outputFormat === 'text') {
			console.error(chalk.red(`Error: ${error.message}`));

			if (getDebugFlag()) {
				// Use getter
				console.error(error);
			}

			process.exit(1);
		} else {
			throw error; // Re-throw for JSON output
		}
	}
}

export default parsePRD;
