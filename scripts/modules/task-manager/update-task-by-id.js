import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import boxen from 'boxen';
import Table from 'cli-table3';

import { log, readJSON, writeJSON, truncate, isSilentMode } from '../utils.js';

import {
	getStatusWithColor,
	startLoadingIndicator,
	stopLoadingIndicator
} from '../ui.js';

import { _handleAnthropicStream } from '../ai-services.js';
import {
	getDebugFlag,
	getMainModelId,
	getMainMaxTokens,
	getMainTemperature,
	getResearchModelId,
	getResearchMaxTokens,
	getResearchTemperature,
	isApiKeySet
} from '../config-manager.js';
import generateTaskFiles from './generate-task-files.js';

/**
 * Update a single task by ID
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {number} taskId - Task ID to update
 * @param {string} prompt - Prompt with new context
 * @param {boolean} useResearch - Whether to use Perplexity AI for research
 * @param {function} reportProgress - Function to report progress to MCP server (optional)
 * @param {Object} mcpLog - MCP logger object (optional)
 * @param {Object} session - Session object from MCP server (optional)
 * @returns {Object} - Updated task data or null if task wasn't updated
 */
async function updateTaskById(
	tasksPath,
	taskId,
	prompt,
	useResearch = false,
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

	try {
		report(`Updating single task ${taskId} with prompt: "${prompt}"`, 'info');

		// Validate task ID is a positive integer
		if (!Number.isInteger(taskId) || taskId <= 0) {
			throw new Error(
				`Invalid task ID: ${taskId}. Task ID must be a positive integer.`
			);
		}

		// Validate prompt
		if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
			throw new Error(
				'Prompt cannot be empty. Please provide context for the task update.'
			);
		}

		// Validate research flag and API key
		if (useResearch && !isApiKeySet('perplexity', session)) {
			report(
				'Perplexity AI research requested but API key is not set. Falling back to main AI.',
				'warn'
			);

			// Only show UI elements for text output (CLI)
			if (outputFormat === 'text') {
				console.log(
					chalk.yellow(
						'Perplexity AI is not available (API key may be missing). Falling back to Claude AI.'
					)
				);
			}
			useResearch = false;
		}

		// Validate tasks file exists
		if (!fs.existsSync(tasksPath)) {
			throw new Error(`Tasks file not found at path: ${tasksPath}`);
		}

		// Read the tasks file
		const data = readJSON(tasksPath);
		if (!data || !data.tasks) {
			throw new Error(
				`No valid tasks found in ${tasksPath}. The file may be corrupted or have an invalid format.`
			);
		}

		// Find the specific task to update
		const taskToUpdate = data.tasks.find((task) => task.id === taskId);
		if (!taskToUpdate) {
			throw new Error(
				`Task with ID ${taskId} not found. Please verify the task ID and try again.`
			);
		}

		// Check if task is already completed
		if (taskToUpdate.status === 'done' || taskToUpdate.status === 'completed') {
			report(
				`Task ${taskId} is already marked as done and cannot be updated`,
				'warn'
			);

			// Only show warning box for text output (CLI)
			if (outputFormat === 'text') {
				console.log(
					boxen(
						chalk.yellow(
							`Task ${taskId} is already marked as ${taskToUpdate.status} and cannot be updated.`
						) +
							'\n\n' +
							chalk.white(
								'Completed tasks are locked to maintain consistency. To modify a completed task, you must first:'
							) +
							'\n' +
							chalk.white(
								'1. Change its status to "pending" or "in-progress"'
							) +
							'\n' +
							chalk.white('2. Then run the update-task command'),
						{ padding: 1, borderColor: 'yellow', borderStyle: 'round' }
					)
				);
			}
			return null;
		}

		// Only show UI elements for text output (CLI)
		if (outputFormat === 'text') {
			// Show the task that will be updated
			const table = new Table({
				head: [
					chalk.cyan.bold('ID'),
					chalk.cyan.bold('Title'),
					chalk.cyan.bold('Status')
				],
				colWidths: [5, 60, 10]
			});

			table.push([
				taskToUpdate.id,
				truncate(taskToUpdate.title, 57),
				getStatusWithColor(taskToUpdate.status)
			]);

			console.log(
				boxen(chalk.white.bold(`Updating Task #${taskId}`), {
					padding: 1,
					borderColor: 'blue',
					borderStyle: 'round',
					margin: { top: 1, bottom: 0 }
				})
			);

			console.log(table.toString());

			// Display a message about how completed subtasks are handled
			console.log(
				boxen(
					chalk.cyan.bold('How Completed Subtasks Are Handled:') +
						'\n\n' +
						chalk.white(
							'• Subtasks marked as "done" or "completed" will be preserved\n'
						) +
						chalk.white(
							'• New subtasks will build upon what has already been completed\n'
						) +
						chalk.white(
							'• If completed work needs revision, a new subtask will be created instead of modifying done items\n'
						) +
						chalk.white(
							'• This approach maintains a clear record of completed work and new requirements'
						),
					{
						padding: 1,
						borderColor: 'blue',
						borderStyle: 'round',
						margin: { top: 1, bottom: 1 }
					}
				)
			);
		}

		// Build the system prompt
		const systemPrompt = `You are an AI assistant helping to update a software development task based on new context.
You will be given a task and a prompt describing changes or new implementation details.
Your job is to update the task to reflect these changes, while preserving its basic structure.

Guidelines:
1. VERY IMPORTANT: NEVER change the title of the task - keep it exactly as is
2. Maintain the same ID, status, and dependencies unless specifically mentioned in the prompt
3. Update the description, details, and test strategy to reflect the new information
4. Do not change anything unnecessarily - just adapt what needs to change based on the prompt
5. Return a complete valid JSON object representing the updated task
6. VERY IMPORTANT: Preserve all subtasks marked as "done" or "completed" - do not modify their content
7. For tasks with completed subtasks, build upon what has already been done rather than rewriting everything
8. If an existing completed subtask needs to be changed/undone based on the new context, DO NOT modify it directly
9. Instead, add a new subtask that clearly indicates what needs to be changed or replaced
10. Use the existence of completed subtasks as an opportunity to make new subtasks more specific and targeted
11. Ensure any new subtasks have unique IDs that don't conflict with existing ones

The changes described in the prompt should be thoughtfully applied to make the task more accurate and actionable.`;

		const taskData = JSON.stringify(taskToUpdate, null, 2);

		// Initialize variables for model selection and fallback
		let updatedTask;
		let loadingIndicator = null;
		let claudeOverloaded = false;
		let modelAttempts = 0;
		const maxModelAttempts = 2; // Try up to 2 models before giving up

		// Only create initial loading indicator for text output (CLI)
		if (outputFormat === 'text') {
			loadingIndicator = startLoadingIndicator(
				useResearch
					? 'Updating task with Perplexity AI research...'
					: 'Updating task with Claude AI...'
			);
		}

		try {
			// Import the getAvailableAIModel function
			const { getAvailableAIModel } = await import('./ai-services.js');

			// Try different models with fallback
			while (modelAttempts < maxModelAttempts && !updatedTask) {
				modelAttempts++;
				const isLastAttempt = modelAttempts >= maxModelAttempts;
				let modelType = null;

				try {
					// Get the appropriate model based on current state
					const result = getAvailableAIModel({
						claudeOverloaded,
						requiresResearch: useResearch
					});
					modelType = result.type;
					const client = result.client;

					report(
						`Attempt ${modelAttempts}/${maxModelAttempts}: Updating task using ${modelType}`,
						'info'
					);

					// Update loading indicator - only for text output
					if (outputFormat === 'text') {
						if (loadingIndicator) {
							stopLoadingIndicator(loadingIndicator);
						}
						loadingIndicator = startLoadingIndicator(
							`Attempt ${modelAttempts}: Using ${modelType.toUpperCase()}...`
						);
					}

					if (modelType === 'perplexity') {
						// Call Perplexity AI
						const perplexityModel =
							process.env.PERPLEXITY_MODEL ||
							session?.env?.PERPLEXITY_MODEL ||
							'sonar-pro';
						const result = await client.chat.completions.create({
							model: getResearchModelId(session),
							messages: [
								{
									role: 'system',
									content: `${systemPrompt}\n\nAdditionally, please research the latest best practices, implementation details, and considerations when updating this task. Use your online search capabilities to gather relevant information. Remember to strictly follow the guidelines about preserving completed subtasks and building upon what has already been done rather than modifying or replacing it.`
								},
								{
									role: 'user',
									content: `Here is the task to update:
${taskData}

Please update this task based on the following new context:
${prompt}

IMPORTANT: In the task JSON above, any subtasks with "status": "done" or "status": "completed" should be preserved exactly as is. Build your changes around these completed items.

Return only the updated task as a valid JSON object.`
								}
							],
							temperature: getResearchTemperature(session),
							max_tokens: getResearchMaxTokens(session)
						});

						const responseText = result.choices[0].message.content;

						// Extract JSON from response
						const jsonStart = responseText.indexOf('{');
						const jsonEnd = responseText.lastIndexOf('}');

						if (jsonStart === -1 || jsonEnd === -1) {
							throw new Error(
								`Could not find valid JSON object in ${modelType}'s response. The response may be malformed.`
							);
						}

						const jsonText = responseText.substring(jsonStart, jsonEnd + 1);

						try {
							updatedTask = JSON.parse(jsonText);
						} catch (parseError) {
							throw new Error(
								`Failed to parse ${modelType} response as JSON: ${parseError.message}\nResponse fragment: ${jsonText.substring(0, 100)}...`
							);
						}
					} else {
						// Call Claude to update the task with streaming
						let responseText = '';
						let streamingInterval = null;

						try {
							// Update loading indicator to show streaming progress - only for text output
							if (outputFormat === 'text') {
								let dotCount = 0;
								const readline = await import('readline');
								streamingInterval = setInterval(() => {
									readline.cursorTo(process.stdout, 0);
									process.stdout.write(
										`Receiving streaming response from Claude${'.'.repeat(dotCount)}`
									);
									dotCount = (dotCount + 1) % 4;
								}, 500);
							}

							// Use streaming API call
							const stream = await client.messages.create({
								model: getMainModelId(session),
								max_tokens: getMainMaxTokens(session),
								temperature: getMainTemperature(session),
								system: systemPrompt,
								messages: [
									{
										role: 'user',
										content: `Here is the task to update:
${taskData}

Please update this task based on the following new context:
${prompt}

IMPORTANT: In the task JSON above, any subtasks with "status": "done" or "status": "completed" should be preserved exactly as is. Build your changes around these completed items.

Return only the updated task as a valid JSON object.`
									}
								],
								stream: true
							});

							// Process the stream
							for await (const chunk of stream) {
								if (chunk.type === 'content_block_delta' && chunk.delta.text) {
									responseText += chunk.delta.text;
								}
								if (reportProgress) {
									await reportProgress({
										progress:
											(responseText.length / getMainMaxTokens(session)) * 100
									});
								}
								if (mcpLog) {
									mcpLog.info(
										`Progress: ${(responseText.length / getMainMaxTokens(session)) * 100}%`
									);
								}
							}

							if (streamingInterval) clearInterval(streamingInterval);

							report(
								`Completed streaming response from ${modelType} API (Attempt ${modelAttempts})`,
								'info'
							);

							// Extract JSON from response
							const jsonStart = responseText.indexOf('{');
							const jsonEnd = responseText.lastIndexOf('}');

							if (jsonStart === -1 || jsonEnd === -1) {
								throw new Error(
									`Could not find valid JSON object in ${modelType}'s response. The response may be malformed.`
								);
							}

							const jsonText = responseText.substring(jsonStart, jsonEnd + 1);

							try {
								updatedTask = JSON.parse(jsonText);
							} catch (parseError) {
								throw new Error(
									`Failed to parse ${modelType} response as JSON: ${parseError.message}\nResponse fragment: ${jsonText.substring(0, 100)}...`
								);
							}
						} catch (streamError) {
							if (streamingInterval) clearInterval(streamingInterval);

							// Process stream errors explicitly
							report(`Stream error: ${streamError.message}`, 'error');

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
								report(
									'Claude overloaded. Will attempt fallback model if available.',
									'warn'
								);
								// Let the loop continue to try the next model
								throw new Error('Claude overloaded');
							} else {
								// Re-throw non-overload errors
								throw streamError;
							}
						}
					}

					// If we got here successfully, break out of the loop
					if (updatedTask) {
						report(
							`Successfully updated task using ${modelType} on attempt ${modelAttempts}`,
							'success'
						);
						break;
					}
				} catch (modelError) {
					const failedModel = modelType || 'unknown model';
					report(
						`Attempt ${modelAttempts} failed using ${failedModel}: ${modelError.message}`,
						'warn'
					);

					// Continue to next attempt if we have more attempts and this was an overload error
					const wasOverload = modelError.message
						?.toLowerCase()
						.includes('overload');

					if (wasOverload && !isLastAttempt) {
						if (modelType === 'claude') {
							claudeOverloaded = true;
							report('Will attempt with Perplexity AI next', 'info');
						}
						continue; // Continue to next attempt
					} else if (isLastAttempt) {
						report(
							`Final attempt (${modelAttempts}/${maxModelAttempts}) failed. No fallback possible.`,
							'error'
						);
						throw modelError; // Re-throw on last attempt
					} else {
						throw modelError; // Re-throw for non-overload errors
					}
				}
			}

			// If we don't have updated task after all attempts, throw an error
			if (!updatedTask) {
				throw new Error(
					'Failed to generate updated task after all model attempts'
				);
			}

			// Validation of the updated task
			if (!updatedTask || typeof updatedTask !== 'object') {
				throw new Error(
					'Received invalid task object from AI. The response did not contain a valid task.'
				);
			}

			// Ensure critical fields exist
			if (!updatedTask.title || !updatedTask.description) {
				throw new Error(
					'Updated task is missing required fields (title or description).'
				);
			}

			// Ensure ID is preserved
			if (updatedTask.id !== taskId) {
				report(
					`Task ID was modified in the AI response. Restoring original ID ${taskId}.`,
					'warn'
				);
				updatedTask.id = taskId;
			}

			// Ensure status is preserved unless explicitly changed in prompt
			if (
				updatedTask.status !== taskToUpdate.status &&
				!prompt.toLowerCase().includes('status')
			) {
				report(
					`Task status was modified without explicit instruction. Restoring original status '${taskToUpdate.status}'.`,
					'warn'
				);
				updatedTask.status = taskToUpdate.status;
			}

			// Ensure completed subtasks are preserved
			if (taskToUpdate.subtasks && taskToUpdate.subtasks.length > 0) {
				if (!updatedTask.subtasks) {
					report(
						'Subtasks were removed in the AI response. Restoring original subtasks.',
						'warn'
					);
					updatedTask.subtasks = taskToUpdate.subtasks;
				} else {
					// Check for each completed subtask
					const completedSubtasks = taskToUpdate.subtasks.filter(
						(st) => st.status === 'done' || st.status === 'completed'
					);

					for (const completedSubtask of completedSubtasks) {
						const updatedSubtask = updatedTask.subtasks.find(
							(st) => st.id === completedSubtask.id
						);

						// If completed subtask is missing or modified, restore it
						if (!updatedSubtask) {
							report(
								`Completed subtask ${completedSubtask.id} was removed. Restoring it.`,
								'warn'
							);
							updatedTask.subtasks.push(completedSubtask);
						} else if (
							updatedSubtask.title !== completedSubtask.title ||
							updatedSubtask.description !== completedSubtask.description ||
							updatedSubtask.details !== completedSubtask.details ||
							updatedSubtask.status !== completedSubtask.status
						) {
							report(
								`Completed subtask ${completedSubtask.id} was modified. Restoring original.`,
								'warn'
							);
							// Find and replace the modified subtask
							const index = updatedTask.subtasks.findIndex(
								(st) => st.id === completedSubtask.id
							);
							if (index !== -1) {
								updatedTask.subtasks[index] = completedSubtask;
							}
						}
					}

					// Ensure no duplicate subtask IDs
					const subtaskIds = new Set();
					const uniqueSubtasks = [];

					for (const subtask of updatedTask.subtasks) {
						if (!subtaskIds.has(subtask.id)) {
							subtaskIds.add(subtask.id);
							uniqueSubtasks.push(subtask);
						} else {
							report(
								`Duplicate subtask ID ${subtask.id} found. Removing duplicate.`,
								'warn'
							);
						}
					}

					updatedTask.subtasks = uniqueSubtasks;
				}
			}

			// Update the task in the original data
			const index = data.tasks.findIndex((t) => t.id === taskId);
			if (index !== -1) {
				data.tasks[index] = updatedTask;
			} else {
				throw new Error(`Task with ID ${taskId} not found in tasks array.`);
			}

			// Write the updated tasks to the file
			writeJSON(tasksPath, data);

			report(`Successfully updated task ${taskId}`, 'success');

			// Generate individual task files
			await generateTaskFiles(tasksPath, path.dirname(tasksPath));

			// Only show success box for text output (CLI)
			if (outputFormat === 'text') {
				console.log(
					boxen(
						chalk.green(`Successfully updated task #${taskId}`) +
							'\n\n' +
							chalk.white.bold('Updated Title:') +
							' ' +
							updatedTask.title,
						{ padding: 1, borderColor: 'green', borderStyle: 'round' }
					)
				);
			}

			// Return the updated task for testing purposes
			return updatedTask;
		} finally {
			// Stop the loading indicator if it was created
			if (loadingIndicator) {
				stopLoadingIndicator(loadingIndicator);
				loadingIndicator = null;
			}
		}
	} catch (error) {
		report(`Error updating task: ${error.message}`, 'error');

		// Only show error UI for text output (CLI)
		if (outputFormat === 'text') {
			console.error(chalk.red(`Error: ${error.message}`));

			// Provide more helpful error messages for common issues
			if (error.message.includes('ANTHROPIC_API_KEY')) {
				console.log(
					chalk.yellow('\nTo fix this issue, set your Anthropic API key:')
				);
				console.log('  export ANTHROPIC_API_KEY=your_api_key_here');
			} else if (error.message.includes('PERPLEXITY_API_KEY')) {
				console.log(chalk.yellow('\nTo fix this issue:'));
				console.log(
					'  1. Set your Perplexity API key: export PERPLEXITY_API_KEY=your_api_key_here'
				);
				console.log(
					'  2. Or run without the research flag: task-master update-task --id=<id> --prompt="..."'
				);
			} else if (
				error.message.includes('Task with ID') &&
				error.message.includes('not found')
			) {
				console.log(chalk.yellow('\nTo fix this issue:'));
				console.log('  1. Run task-master list to see all available task IDs');
				console.log('  2. Use a valid task ID with the --id parameter');
			}

			if (getDebugFlag(session)) {
				// Use getter
				console.error(error);
			}
		} else {
			throw error; // Re-throw for JSON output
		}

		return null;
	}
}

export default updateTaskById;
