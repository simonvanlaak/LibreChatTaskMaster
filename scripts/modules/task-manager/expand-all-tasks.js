import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import boxen from 'boxen';

import { log, readJSON, writeJSON, truncate, isSilentMode } from '../utils.js';

import {
	displayBanner,
	startLoadingIndicator,
	stopLoadingIndicator
} from '../ui.js';

import { getDefaultSubtasks } from '../config-manager.js';
import generateTaskFiles from './generate-task-files.js';

/**
 * Expand all pending tasks with subtasks
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {number} numSubtasks - Number of subtasks per task
 * @param {boolean} useResearch - Whether to use research (Perplexity)
 * @param {string} additionalContext - Additional context
 * @param {boolean} forceFlag - Force regeneration for tasks with subtasks
 * @param {Object} options - Options for expanding tasks
 * @param {function} options.reportProgress - Function to report progress
 * @param {Object} options.mcpLog - MCP logger object
 * @param {Object} options.session - Session object from MCP
 * @param {string} outputFormat - Output format (text or json)
 */
async function expandAllTasks(
	tasksPath,
	numSubtasks = getDefaultSubtasks(), // Use getter
	useResearch = false,
	additionalContext = '',
	forceFlag = false,
	{ reportProgress, mcpLog, session } = {},
	outputFormat = 'text'
) {
	// Create custom reporter that checks for MCP log and silent mode
	const report = (message, level = 'info') => {
		if (mcpLog) {
			mcpLog[level](message);
		} else if (!isSilentMode() && outputFormat === 'text') {
			// Only log to console if not in silent mode and outputFormat is 'text'
			log(level, message);
		}
	};

	// Only display banner and UI elements for text output (CLI)
	if (outputFormat === 'text') {
		displayBanner();
	}

	// Parse numSubtasks as integer if it's a string
	if (typeof numSubtasks === 'string') {
		numSubtasks = parseInt(numSubtasks, 10);
		if (isNaN(numSubtasks)) {
			numSubtasks = getDefaultSubtasks(); // Use getter
		}
	}

	report(`Expanding all pending tasks with ${numSubtasks} subtasks each...`);
	if (useResearch) {
		report('Using research-backed AI for more detailed subtasks');
	}

	// Load tasks
	let data;
	try {
		data = readJSON(tasksPath);
		if (!data || !data.tasks) {
			throw new Error('No valid tasks found');
		}
	} catch (error) {
		report(`Error loading tasks: ${error.message}`, 'error');
		throw error;
	}

	// Get all tasks that are pending/in-progress and don't have subtasks (or force regeneration)
	const tasksToExpand = data.tasks.filter(
		(task) =>
			(task.status === 'pending' || task.status === 'in-progress') &&
			(!task.subtasks || task.subtasks.length === 0 || forceFlag)
	);

	if (tasksToExpand.length === 0) {
		report(
			'No tasks eligible for expansion. Tasks should be in pending/in-progress status and not have subtasks already.',
			'info'
		);

		// Return structured result for MCP
		return {
			success: true,
			expandedCount: 0,
			tasksToExpand: 0,
			message: 'No tasks eligible for expansion'
		};
	}

	report(`Found ${tasksToExpand.length} tasks to expand`);

	// Check if we have a complexity report to prioritize complex tasks
	let complexityReport;
	const reportPath = path.join(
		path.dirname(tasksPath),
		'../scripts/task-complexity-report.json'
	);
	if (fs.existsSync(reportPath)) {
		try {
			complexityReport = readJSON(reportPath);
			report('Using complexity analysis to prioritize tasks');
		} catch (error) {
			report(`Could not read complexity report: ${error.message}`, 'warn');
		}
	}

	// Only create loading indicator if not in silent mode and outputFormat is 'text'
	let loadingIndicator = null;
	if (!isSilentMode() && outputFormat === 'text') {
		loadingIndicator = startLoadingIndicator(
			`Expanding ${tasksToExpand.length} tasks with ${numSubtasks} subtasks each`
		);
	}

	let expandedCount = 0;
	let expansionErrors = 0;
	try {
		// Sort tasks by complexity if report exists, otherwise by ID
		if (complexityReport && complexityReport.complexityAnalysis) {
			report('Sorting tasks by complexity...');

			// Create a map of task IDs to complexity scores
			const complexityMap = new Map();
			complexityReport.complexityAnalysis.forEach((analysis) => {
				complexityMap.set(analysis.taskId, analysis.complexityScore);
			});

			// Sort tasks by complexity score (high to low)
			tasksToExpand.sort((a, b) => {
				const scoreA = complexityMap.get(a.id) || 0;
				const scoreB = complexityMap.get(b.id) || 0;
				return scoreB - scoreA;
			});
		}

		// Process each task
		for (const task of tasksToExpand) {
			if (loadingIndicator && outputFormat === 'text') {
				loadingIndicator.text = `Expanding task ${task.id}: ${truncate(task.title, 30)} (${expandedCount + 1}/${tasksToExpand.length})`;
			}

			// Report progress to MCP if available
			if (reportProgress) {
				reportProgress({
					status: 'processing',
					current: expandedCount + 1,
					total: tasksToExpand.length,
					message: `Expanding task ${task.id}: ${truncate(task.title, 30)}`
				});
			}

			report(`Expanding task ${task.id}: ${truncate(task.title, 50)}`);

			// Check if task already has subtasks and forceFlag is enabled
			if (task.subtasks && task.subtasks.length > 0 && forceFlag) {
				report(
					`Task ${task.id} already has ${task.subtasks.length} subtasks. Clearing them for regeneration.`
				);
				task.subtasks = [];
			}

			try {
				// Get complexity analysis for this task if available
				let taskAnalysis;
				if (complexityReport && complexityReport.complexityAnalysis) {
					taskAnalysis = complexityReport.complexityAnalysis.find(
						(a) => a.taskId === task.id
					);
				}

				let thisNumSubtasks = numSubtasks;

				// Use recommended number of subtasks from complexity analysis if available
				if (taskAnalysis && taskAnalysis.recommendedSubtasks) {
					report(
						`Using recommended ${taskAnalysis.recommendedSubtasks} subtasks based on complexity score ${taskAnalysis.complexityScore}/10 for task ${task.id}`
					);
					thisNumSubtasks = taskAnalysis.recommendedSubtasks;
				}

				// Generate prompt for subtask creation based on task details
				const prompt = generateSubtaskPrompt(
					task,
					thisNumSubtasks,
					additionalContext,
					taskAnalysis
				);

				// Use AI to generate subtasks
				const aiResponse = await getSubtasksFromAI(
					prompt,
					useResearch,
					session,
					mcpLog
				);

				if (
					aiResponse &&
					aiResponse.subtasks &&
					Array.isArray(aiResponse.subtasks) &&
					aiResponse.subtasks.length > 0
				) {
					// Process and add the subtasks to the task
					task.subtasks = aiResponse.subtasks.map((subtask, index) => ({
						id: index + 1,
						title: subtask.title || `Subtask ${index + 1}`,
						description: subtask.description || 'No description provided',
						status: 'pending',
						dependencies: subtask.dependencies || [],
						details: subtask.details || ''
					}));

					report(`Added ${task.subtasks.length} subtasks to task ${task.id}`);
					expandedCount++;
				} else if (aiResponse && aiResponse.error) {
					// Handle error response
					const errorMsg = `Failed to generate subtasks for task ${task.id}: ${aiResponse.error}`;
					report(errorMsg, 'error');

					// Add task ID to error info and provide actionable guidance
					const suggestion = aiResponse.suggestion.replace('<id>', task.id);
					report(`Suggestion: ${suggestion}`, 'info');

					expansionErrors++;
				} else {
					report(`Failed to generate subtasks for task ${task.id}`, 'error');
					report(
						`Suggestion: Run 'task-master update-task --id=${task.id} --prompt="Generate subtasks for this task"' to manually create subtasks.`,
						'info'
					);
					expansionErrors++;
				}
			} catch (error) {
				report(`Error expanding task ${task.id}: ${error.message}`, 'error');
				expansionErrors++;
			}

			// Small delay to prevent rate limiting
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		// Save the updated tasks
		writeJSON(tasksPath, data);

		// Generate task files
		if (outputFormat === 'text') {
			// Only perform file generation for CLI (text) mode
			const outputDir = path.dirname(tasksPath);
			await generateTaskFiles(tasksPath, outputDir);
		}

		// Return structured result for MCP
		return {
			success: true,
			expandedCount,
			tasksToExpand: tasksToExpand.length,
			expansionErrors,
			message: `Successfully expanded ${expandedCount} out of ${tasksToExpand.length} tasks${expansionErrors > 0 ? ` (${expansionErrors} errors)` : ''}`
		};
	} catch (error) {
		report(`Error expanding tasks: ${error.message}`, 'error');
		throw error;
	} finally {
		// Stop the loading indicator if it was created
		if (loadingIndicator && outputFormat === 'text') {
			stopLoadingIndicator(loadingIndicator);
		}

		// Final progress report
		if (reportProgress) {
			reportProgress({
				status: 'completed',
				current: expandedCount,
				total: tasksToExpand.length,
				message: `Completed expanding ${expandedCount} out of ${tasksToExpand.length} tasks`
			});
		}

		// Display completion message for CLI mode
		if (outputFormat === 'text') {
			console.log(
				boxen(
					chalk.white.bold(`Task Expansion Completed`) +
						'\n\n' +
						chalk.white(
							`Expanded ${expandedCount} out of ${tasksToExpand.length} tasks`
						) +
						'\n' +
						chalk.white(
							`Each task now has detailed subtasks to guide implementation`
						),
					{
						padding: 1,
						borderColor: 'green',
						borderStyle: 'round',
						margin: { top: 1 }
					}
				)
			);

			// Suggest next actions
			if (expandedCount > 0) {
				console.log(chalk.bold('\nNext Steps:'));
				console.log(
					chalk.cyan(
						`1. Run ${chalk.yellow('task-master list --with-subtasks')} to see all tasks with their subtasks`
					)
				);
				console.log(
					chalk.cyan(
						`2. Run ${chalk.yellow('task-master next')} to find the next task to work on`
					)
				);
				console.log(
					chalk.cyan(
						`3. Run ${chalk.yellow('task-master set-status --id=<taskId> --status=in-progress')} to start working on a task`
					)
				);
			}
		}
	}
}

export default expandAllTasks;
