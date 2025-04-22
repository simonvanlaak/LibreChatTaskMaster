import path from 'path';
import chalk from 'chalk';
import boxen from 'boxen';
import Table from 'cli-table3';

import {
	displayBanner,
	getStatusWithColor,
	startLoadingIndicator,
	stopLoadingIndicator
} from '../ui.js';
import { log, readJSON, writeJSON, truncate } from '../utils.js';
import { _handleAnthropicStream } from '../ai-services.js';
import {
	getDefaultPriority,
	getResearchModelId,
	getResearchTemperature,
	getResearchMaxTokens,
	getMainModelId,
	getMainTemperature,
	getMainMaxTokens
} from '../config-manager.js';

/**
 * Add a new task using AI
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {string} prompt - Description of the task to add (required for AI-driven creation)
 * @param {Array} dependencies - Task dependencies
 * @param {string} priority - Task priority
 * @param {function} reportProgress - Function to report progress to MCP server (optional)
 * @param {Object} mcpLog - MCP logger object (optional)
 * @param {Object} session - Session object from MCP server (optional)
 * @param {string} outputFormat - Output format (text or json)
 * @param {Object} customEnv - Custom environment variables (optional)
 * @param {Object} manualTaskData - Manual task data (optional, for direct task creation without AI)
 * @returns {number} The new task ID
 */
async function addTask(
	tasksPath,
	prompt,
	dependencies = [],
	priority = getDefaultPriority(), // Use getter
	{ reportProgress, mcpLog, session } = {},
	outputFormat = 'text',
	customEnv = null,
	manualTaskData = null
) {
	let loadingIndicator = null; // Keep indicator variable accessible

	try {
		// Only display banner and UI elements for text output (CLI)
		if (outputFormat === 'text') {
			displayBanner();

			console.log(
				boxen(chalk.white.bold(`Creating New Task`), {
					padding: 1,
					borderColor: 'blue',
					borderStyle: 'round',
					margin: { top: 1, bottom: 1 }
				})
			);
		}

		// Read the existing tasks
		const data = readJSON(tasksPath);
		if (!data || !data.tasks) {
			log('error', 'Invalid or missing tasks.json.');
			throw new Error('Invalid or missing tasks.json.');
		}

		// Find the highest task ID to determine the next ID
		const highestId = Math.max(...data.tasks.map((t) => t.id));
		const newTaskId = highestId + 1;

		// Only show UI box for CLI mode
		if (outputFormat === 'text') {
			console.log(
				boxen(chalk.white.bold(`Creating New Task #${newTaskId}`), {
					padding: 1,
					borderColor: 'blue',
					borderStyle: 'round',
					margin: { top: 1, bottom: 1 }
				})
			);
		}

		// Validate dependencies before proceeding
		const invalidDeps = dependencies.filter((depId) => {
			return !data.tasks.some((t) => t.id === depId);
		});

		if (invalidDeps.length > 0) {
			log(
				'warn',
				`The following dependencies do not exist: ${invalidDeps.join(', ')}`
			);
			log('info', 'Removing invalid dependencies...');
			dependencies = dependencies.filter(
				(depId) => !invalidDeps.includes(depId)
			);
		}

		let taskData;

		// Check if manual task data is provided
		if (manualTaskData) {
			// Use manual task data directly
			log('info', 'Using manually provided task data');
			taskData = manualTaskData;
		} else {
			// Use AI to generate task data
			// Create context string for task creation prompt
			let contextTasks = '';
			if (dependencies.length > 0) {
				// Provide context for the dependent tasks
				const dependentTasks = data.tasks.filter((t) =>
					dependencies.includes(t.id)
				);
				contextTasks = `\nThis task depends on the following tasks:\n${dependentTasks
					.map((t) => `- Task ${t.id}: ${t.title} - ${t.description}`)
					.join('\n')}`;
			} else {
				// Provide a few recent tasks as context
				const recentTasks = [...data.tasks]
					.sort((a, b) => b.id - a.id)
					.slice(0, 3);
				contextTasks = `\nRecent tasks in the project:\n${recentTasks
					.map((t) => `- Task ${t.id}: ${t.title} - ${t.description}`)
					.join('\n')}`;
			}

			// Start the loading indicator - only for text mode
			if (outputFormat === 'text') {
				loadingIndicator = startLoadingIndicator(
					'Generating new task with Claude AI...'
				);
			}

			try {
				// Import the AI services - explicitly importing here to avoid circular dependencies
				const {
					_handleAnthropicStream,
					_buildAddTaskPrompt,
					parseTaskJsonResponse,
					getAvailableAIModel
				} = await import('./ai-services.js');

				// Initialize model state variables
				let claudeOverloaded = false;
				let modelAttempts = 0;
				const maxModelAttempts = 2; // Try up to 2 models before giving up
				let aiGeneratedTaskData = null;

				// Loop through model attempts
				while (modelAttempts < maxModelAttempts && !aiGeneratedTaskData) {
					modelAttempts++; // Increment attempt counter
					const isLastAttempt = modelAttempts >= maxModelAttempts;
					let modelType = null; // Track which model we're using

					try {
						// Get the best available model based on our current state
						const result = getAvailableAIModel({
							claudeOverloaded,
							requiresResearch: false // We're not using the research flag here
						});
						modelType = result.type;
						const client = result.client;

						log(
							'info',
							`Attempt ${modelAttempts}/${maxModelAttempts}: Generating task using ${modelType}`
						);

						// Update loading indicator text - only for text output
						if (outputFormat === 'text') {
							if (loadingIndicator) {
								stopLoadingIndicator(loadingIndicator); // Stop previous indicator
							}
							loadingIndicator = startLoadingIndicator(
								`Attempt ${modelAttempts}: Using ${modelType.toUpperCase()}...`
							);
						}

						// Build the prompts using the helper
						const { systemPrompt, userPrompt } = _buildAddTaskPrompt(
							prompt,
							contextTasks,
							{ newTaskId }
						);

						if (modelType === 'perplexity') {
							// Use Perplexity AI
							const response = await client.chat.completions.create({
								model: getResearchModelId(session),
								messages: [
									{ role: 'system', content: systemPrompt },
									{ role: 'user', content: userPrompt }
								],
								temperature: getResearchTemperature(session),
								max_tokens: getResearchMaxTokens(session)
							});

							const responseText = response.choices[0].message.content;
							aiGeneratedTaskData = parseTaskJsonResponse(responseText);
						} else {
							// Use Claude (default)
							// Prepare API parameters using getters, preserving customEnv override
							const apiParams = {
								model: customEnv?.ANTHROPIC_MODEL || getMainModelId(session),
								max_tokens: customEnv?.MAX_TOKENS || getMainMaxTokens(session),
								temperature:
									customEnv?.TEMPERATURE || getMainTemperature(session),
								system: systemPrompt,
								messages: [{ role: 'user', content: userPrompt }]
							};

							// Call the streaming API using our helper
							try {
								const fullResponse = await _handleAnthropicStream(
									client,
									apiParams,
									{ reportProgress, mcpLog },
									outputFormat === 'text' // CLI mode flag
								);

								log(
									'debug',
									`Streaming response length: ${fullResponse.length} characters`
								);

								// Parse the response using our helper
								aiGeneratedTaskData = parseTaskJsonResponse(fullResponse);
							} catch (streamError) {
								// Process stream errors explicitly
								log('error', `Stream error: ${streamError.message}`);

								// Check if this is an overload error
								let isOverload = false;
								// Check 1: SDK specific property
								if (streamError.type === 'overloaded_error') {
									isOverload = true;
								}
								// Check 2: Check nested error property
								else if (streamError.error?.type === 'overloaded_error') {
									isOverload = true;
								}
								// Check 3: Check status code
								else if (
									streamError.status === 429 ||
									streamError.status === 529
								) {
									isOverload = true;
								}
								// Check 4: Check message string
								else if (
									streamError.message?.toLowerCase().includes('overloaded')
								) {
									isOverload = true;
								}

								if (isOverload) {
									claudeOverloaded = true;
									log(
										'warn',
										'Claude overloaded. Will attempt fallback model if available.'
									);
									// Throw to continue to next model attempt
									throw new Error('Claude overloaded');
								} else {
									// Re-throw non-overload errors
									throw streamError;
								}
							}
						}

						// If we got here without errors and have task data, we're done
						if (aiGeneratedTaskData) {
							log(
								'info',
								`Successfully generated task data using ${modelType} on attempt ${modelAttempts}`
							);
							break;
						}
					} catch (modelError) {
						const failedModel = modelType || 'unknown model';
						log(
							'warn',
							`Attempt ${modelAttempts} failed using ${failedModel}: ${modelError.message}`
						);

						// Continue to next attempt if we have more attempts and this was specifically an overload error
						const wasOverload = modelError.message
							?.toLowerCase()
							.includes('overload');

						if (wasOverload && !isLastAttempt) {
							if (modelType === 'claude') {
								claudeOverloaded = true;
								log('info', 'Will attempt with Perplexity AI next');
							}
							continue; // Continue to next attempt
						} else if (isLastAttempt) {
							log(
								'error',
								`Final attempt (${modelAttempts}/${maxModelAttempts}) failed. No fallback possible.`
							);
							throw modelError; // Re-throw on last attempt
						} else {
							throw modelError; // Re-throw for non-overload errors
						}
					}
				}

				// If we don't have task data after all attempts, throw an error
				if (!aiGeneratedTaskData) {
					throw new Error(
						'Failed to generate task data after all model attempts'
					);
				}

				// Set the AI-generated task data
				taskData = aiGeneratedTaskData;
			} catch (error) {
				// Handle AI errors
				log('error', `Error generating task with AI: ${error.message}`);

				// Stop any loading indicator
				if (outputFormat === 'text' && loadingIndicator) {
					stopLoadingIndicator(loadingIndicator);
				}

				throw error;
			}
		}

		// Create the new task object
		const newTask = {
			id: newTaskId,
			title: taskData.title,
			description: taskData.description,
			details: taskData.details || '',
			testStrategy: taskData.testStrategy || '',
			status: 'pending',
			dependencies: dependencies,
			priority: priority
		};

		// Add the task to the tasks array
		data.tasks.push(newTask);

		// Write the updated tasks to the file
		writeJSON(tasksPath, data);

		// Generate markdown task files
		log('info', 'Generating task files...');
		await generateTaskFiles(tasksPath, path.dirname(tasksPath));

		// Stop the loading indicator if it's still running
		if (outputFormat === 'text' && loadingIndicator) {
			stopLoadingIndicator(loadingIndicator);
		}

		// Show success message - only for text output (CLI)
		if (outputFormat === 'text') {
			const table = new Table({
				head: [
					chalk.cyan.bold('ID'),
					chalk.cyan.bold('Title'),
					chalk.cyan.bold('Description')
				],
				colWidths: [5, 30, 50]
			});

			table.push([
				newTask.id,
				truncate(newTask.title, 27),
				truncate(newTask.description, 47)
			]);

			console.log(chalk.green('✅ New task created successfully:'));
			console.log(table.toString());

			// Show success message
			console.log(
				boxen(
					chalk.white.bold(`Task ${newTaskId} Created Successfully`) +
						'\n\n' +
						chalk.white(`Title: ${newTask.title}`) +
						'\n' +
						chalk.white(`Status: ${getStatusWithColor(newTask.status)}`) +
						'\n' +
						chalk.white(
							`Priority: ${chalk.keyword(getPriorityColor(newTask.priority))(newTask.priority)}`
						) +
						'\n' +
						(dependencies.length > 0
							? chalk.white(`Dependencies: ${dependencies.join(', ')}`) + '\n'
							: '') +
						'\n' +
						chalk.white.bold('Next Steps:') +
						'\n' +
						chalk.cyan(
							`1. Run ${chalk.yellow(`task-master show ${newTaskId}`)} to see complete task details`
						) +
						'\n' +
						chalk.cyan(
							`2. Run ${chalk.yellow(`task-master set-status --id=${newTaskId} --status=in-progress`)} to start working on it`
						) +
						'\n' +
						chalk.cyan(
							`3. Run ${chalk.yellow(`task-master expand --id=${newTaskId}`)} to break it down into subtasks`
						),
					{ padding: 1, borderColor: 'green', borderStyle: 'round' }
				)
			);
		}

		// Return the new task ID
		return newTaskId;
	} catch (error) {
		// Stop any loading indicator
		if (outputFormat === 'text' && loadingIndicator) {
			stopLoadingIndicator(loadingIndicator);
		}

		log('error', `Error adding task: ${error.message}`);
		if (outputFormat === 'text') {
			console.error(chalk.red(`Error: ${error.message}`));
		}
		throw error;
	}
}

export default addTask;
