import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import boxen from 'boxen';
import Table from 'cli-table3';

import {
	getStatusWithColor,
	startLoadingIndicator,
	stopLoadingIndicator
} from '../ui.js';
import { log, readJSON, writeJSON, truncate, isSilentMode } from '../utils.js';
import { getAvailableAIModel } from '../ai-services.js';
import { getDebugFlag } from '../config-manager.js';
import generateTaskFiles from './generate-task-files.js';

/**
 * Update a subtask by appending additional information to its description and details
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {string} subtaskId - ID of the subtask to update in format "parentId.subtaskId"
 * @param {string} prompt - Prompt for generating additional information
 * @param {boolean} useResearch - Whether to use Perplexity AI for research-backed updates
 * @param {function} reportProgress - Function to report progress to MCP server (optional)
 * @param {Object} mcpLog - MCP logger object (optional)
 * @param {Object} session - Session object from MCP server (optional)
 * @returns {Object|null} - The updated subtask or null if update failed
 */
async function updateSubtaskById(
	tasksPath,
	subtaskId,
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

	let loadingIndicator = null;
	try {
		report(`Updating subtask ${subtaskId} with prompt: "${prompt}"`, 'info');

		// Validate subtask ID format
		if (
			!subtaskId ||
			typeof subtaskId !== 'string' ||
			!subtaskId.includes('.')
		) {
			throw new Error(
				`Invalid subtask ID format: ${subtaskId}. Subtask ID must be in format "parentId.subtaskId"`
			);
		}

		// Validate prompt
		if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
			throw new Error(
				'Prompt cannot be empty. Please provide context for the subtask update.'
			);
		}

		// Prepare for fallback handling
		let claudeOverloaded = false;

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

		// Parse parent and subtask IDs
		const [parentIdStr, subtaskIdStr] = subtaskId.split('.');
		const parentId = parseInt(parentIdStr, 10);
		const subtaskIdNum = parseInt(subtaskIdStr, 10);

		if (
			isNaN(parentId) ||
			parentId <= 0 ||
			isNaN(subtaskIdNum) ||
			subtaskIdNum <= 0
		) {
			throw new Error(
				`Invalid subtask ID format: ${subtaskId}. Both parent ID and subtask ID must be positive integers.`
			);
		}

		// Find the parent task
		const parentTask = data.tasks.find((task) => task.id === parentId);
		if (!parentTask) {
			throw new Error(
				`Parent task with ID ${parentId} not found. Please verify the task ID and try again.`
			);
		}

		// Find the subtask
		if (!parentTask.subtasks || !Array.isArray(parentTask.subtasks)) {
			throw new Error(`Parent task ${parentId} has no subtasks.`);
		}

		const subtask = parentTask.subtasks.find((st) => st.id === subtaskIdNum);
		if (!subtask) {
			throw new Error(
				`Subtask with ID ${subtaskId} not found. Please verify the subtask ID and try again.`
			);
		}

		// Check if subtask is already completed
		if (subtask.status === 'done' || subtask.status === 'completed') {
			report(
				`Subtask ${subtaskId} is already marked as done and cannot be updated`,
				'warn'
			);

			// Only show UI elements for text output (CLI)
			if (outputFormat === 'text') {
				console.log(
					boxen(
						chalk.yellow(
							`Subtask ${subtaskId} is already marked as ${subtask.status} and cannot be updated.`
						) +
							'\n\n' +
							chalk.white(
								'Completed subtasks are locked to maintain consistency. To modify a completed subtask, you must first:'
							) +
							'\n' +
							chalk.white(
								'1. Change its status to "pending" or "in-progress"'
							) +
							'\n' +
							chalk.white('2. Then run the update-subtask command'),
						{ padding: 1, borderColor: 'yellow', borderStyle: 'round' }
					)
				);
			}
			return null;
		}

		// Only show UI elements for text output (CLI)
		if (outputFormat === 'text') {
			// Show the subtask that will be updated
			const table = new Table({
				head: [
					chalk.cyan.bold('ID'),
					chalk.cyan.bold('Title'),
					chalk.cyan.bold('Status')
				],
				colWidths: [10, 55, 10]
			});

			table.push([
				subtaskId,
				truncate(subtask.title, 52),
				getStatusWithColor(subtask.status)
			]);

			console.log(
				boxen(chalk.white.bold(`Updating Subtask #${subtaskId}`), {
					padding: 1,
					borderColor: 'blue',
					borderStyle: 'round',
					margin: { top: 1, bottom: 0 }
				})
			);

			console.log(table.toString());

			// Start the loading indicator - only for text output
			loadingIndicator = startLoadingIndicator(
				'Generating additional information with AI...'
			);
		}

		// Create the system prompt (as before)
		const systemPrompt = `You are an AI assistant helping to update software development subtasks with additional information.
Given a subtask, you will provide additional details, implementation notes, or technical insights based on user request.
Focus only on adding content that enhances the subtask - don't repeat existing information.
Be technical, specific, and implementation-focused rather than general.
Provide concrete examples, code snippets, or implementation details when relevant.`;

		// Replace the old research/Claude code with the new model selection approach
		let additionalInformation = '';
		let modelAttempts = 0;
		const maxModelAttempts = 2; // Try up to 2 models before giving up

		while (modelAttempts < maxModelAttempts && !additionalInformation) {
			modelAttempts++; // Increment attempt counter at the start
			const isLastAttempt = modelAttempts >= maxModelAttempts;
			let modelType = null; // Declare modelType outside the try block

			try {
				// Get the best available model based on our current state
				const result = getAvailableAIModel({
					claudeOverloaded,
					requiresResearch: useResearch
				});
				modelType = result.type;
				const client = result.client;

				report(
					`Attempt ${modelAttempts}/${maxModelAttempts}: Generating subtask info using ${modelType}`,
					'info'
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

				const subtaskData = JSON.stringify(subtask, null, 2);
				const userMessageContent = `Here is the subtask to enhance:\n${subtaskData}\n\nPlease provide additional information addressing this request:\n${prompt}\n\nReturn ONLY the new information to add - do not repeat existing content.`;

				if (modelType === 'perplexity') {
					// Construct Perplexity payload
					const perplexityModel =
						process.env.PERPLEXITY_MODEL ||
						session?.env?.PERPLEXITY_MODEL ||
						'sonar-pro';
					const response = await client.chat.completions.create({
						model: perplexityModel,
						messages: [
							{ role: 'system', content: systemPrompt },
							{ role: 'user', content: userMessageContent }
						],
						temperature: parseFloat(
							process.env.TEMPERATURE ||
								session?.env?.TEMPERATURE ||
								CONFIG.temperature
						),
						max_tokens: parseInt(
							process.env.MAX_TOKENS ||
								session?.env?.MAX_TOKENS ||
								CONFIG.maxTokens
						)
					});
					additionalInformation = response.choices[0].message.content.trim();
				} else {
					// Claude
					let responseText = '';
					let streamingInterval = null;

					try {
						// Only update streaming indicator for text output
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

						// Construct Claude payload
						const stream = await client.messages.create({
							model: CONFIG.model,
							max_tokens: CONFIG.maxTokens,
							temperature: CONFIG.temperature,
							system: systemPrompt,
							messages: [{ role: 'user', content: userMessageContent }],
							stream: true
						});

						for await (const chunk of stream) {
							if (chunk.type === 'content_block_delta' && chunk.delta.text) {
								responseText += chunk.delta.text;
							}
							if (reportProgress) {
								await reportProgress({
									progress: (responseText.length / CONFIG.maxTokens) * 100
								});
							}
							if (mcpLog) {
								mcpLog.info(
									`Progress: ${(responseText.length / CONFIG.maxTokens) * 100}%`
								);
							}
						}
					} finally {
						if (streamingInterval) clearInterval(streamingInterval);
						// Clear the loading dots line - only for text output
						if (outputFormat === 'text') {
							const readline = await import('readline');
							readline.cursorTo(process.stdout, 0);
							process.stdout.clearLine(0);
						}
					}

					report(
						`Completed streaming response from Claude API! (Attempt ${modelAttempts})`,
						'info'
					);
					additionalInformation = responseText.trim();
				}

				// Success - break the loop
				if (additionalInformation) {
					report(
						`Successfully generated information using ${modelType} on attempt ${modelAttempts}.`,
						'info'
					);
					break;
				} else {
					// Handle case where AI gave empty response without erroring
					report(
						`AI (${modelType}) returned empty response on attempt ${modelAttempts}.`,
						'warn'
					);
					if (isLastAttempt) {
						throw new Error(
							'AI returned empty response after maximum attempts.'
						);
					}
					// Allow loop to continue to try another model/attempt if possible
				}
			} catch (modelError) {
				const failedModel =
					modelType || modelError.modelType || 'unknown model';
				report(
					`Attempt ${modelAttempts} failed using ${failedModel}: ${modelError.message}`,
					'warn'
				);

				// --- More robust overload check ---
				let isOverload = false;
				// Check 1: SDK specific property (common pattern)
				if (modelError.type === 'overloaded_error') {
					isOverload = true;
				}
				// Check 2: Check nested error property (as originally intended)
				else if (modelError.error?.type === 'overloaded_error') {
					isOverload = true;
				}
				// Check 3: Check status code if available (e.g., 429 Too Many Requests or 529 Overloaded)
				else if (modelError.status === 429 || modelError.status === 529) {
					isOverload = true;
				}
				// Check 4: Check the message string itself (less reliable)
				else if (modelError.message?.toLowerCase().includes('overloaded')) {
					isOverload = true;
				}
				// --- End robust check ---

				if (isOverload) {
					// Use the result of the check
					claudeOverloaded = true; // Mark Claude as overloaded for the *next* potential attempt
					if (!isLastAttempt) {
						report(
							'Claude overloaded. Will attempt fallback model if available.',
							'info'
						);
						// Stop the current indicator before continuing - only for text output
						if (outputFormat === 'text' && loadingIndicator) {
							stopLoadingIndicator(loadingIndicator);
							loadingIndicator = null; // Reset indicator
						}
						continue; // Go to next iteration of the while loop to try fallback
					} else {
						// It was the last attempt, and it failed due to overload
						report(
							`Overload error on final attempt (${modelAttempts}/${maxModelAttempts}). No fallback possible.`,
							'error'
						);
						// Let the error be thrown after the loop finishes, as additionalInformation will be empty.
						// We don't throw immediately here, let the loop exit and the check after the loop handle it.
					}
				} else {
					// Error was NOT an overload
					// If it's not an overload, throw it immediately to be caught by the outer catch.
					report(
						`Non-overload error on attempt ${modelAttempts}: ${modelError.message}`,
						'error'
					);
					throw modelError; // Re-throw non-overload errors immediately.
				}
			} // End inner catch
		} // End while loop

		// If loop finished without getting information
		if (!additionalInformation) {
			// Only show debug info for text output (CLI)
			if (outputFormat === 'text') {
				console.log(
					'>>> DEBUG: additionalInformation is falsy! Value:',
					additionalInformation
				);
			}
			throw new Error(
				'Failed to generate additional information after all attempts.'
			);
		}

		// Only show debug info for text output (CLI)
		if (outputFormat === 'text') {
			console.log(
				'>>> DEBUG: Got additionalInformation:',
				additionalInformation.substring(0, 50) + '...'
			);
		}

		// Create timestamp
		const currentDate = new Date();
		const timestamp = currentDate.toISOString();

		// Format the additional information with timestamp
		const formattedInformation = `\n\n<info added on ${timestamp}>\n${additionalInformation}\n</info added on ${timestamp}>`;

		// Only show debug info for text output (CLI)
		if (outputFormat === 'text') {
			console.log(
				'>>> DEBUG: formattedInformation:',
				formattedInformation.substring(0, 70) + '...'
			);
		}

		// Append to subtask details and description
		// Only show debug info for text output (CLI)
		if (outputFormat === 'text') {
			console.log('>>> DEBUG: Subtask details BEFORE append:', subtask.details);
		}

		if (subtask.details) {
			subtask.details += formattedInformation;
		} else {
			subtask.details = `${formattedInformation}`;
		}

		// Only show debug info for text output (CLI)
		if (outputFormat === 'text') {
			console.log('>>> DEBUG: Subtask details AFTER append:', subtask.details);
		}

		if (subtask.description) {
			// Only append to description if it makes sense (for shorter updates)
			if (additionalInformation.length < 200) {
				// Only show debug info for text output (CLI)
				if (outputFormat === 'text') {
					console.log(
						'>>> DEBUG: Subtask description BEFORE append:',
						subtask.description
					);
				}
				subtask.description += ` [Updated: ${currentDate.toLocaleDateString()}]`;
				// Only show debug info for text output (CLI)
				if (outputFormat === 'text') {
					console.log(
						'>>> DEBUG: Subtask description AFTER append:',
						subtask.description
					);
				}
			}
		}

		// Only show debug info for text output (CLI)
		if (outputFormat === 'text') {
			console.log('>>> DEBUG: About to call writeJSON with updated data...');
		}

		// Write the updated tasks to the file
		writeJSON(tasksPath, data);

		// Only show debug info for text output (CLI)
		if (outputFormat === 'text') {
			console.log('>>> DEBUG: writeJSON call completed.');
		}

		report(`Successfully updated subtask ${subtaskId}`, 'success');

		// Generate individual task files
		await generateTaskFiles(tasksPath, path.dirname(tasksPath));

		// Stop indicator before final console output - only for text output (CLI)
		if (outputFormat === 'text') {
			if (loadingIndicator) {
				stopLoadingIndicator(loadingIndicator);
				loadingIndicator = null;
			}

			console.log(
				boxen(
					chalk.green(`Successfully updated subtask #${subtaskId}`) +
						'\n\n' +
						chalk.white.bold('Title:') +
						' ' +
						subtask.title +
						'\n\n' +
						chalk.white.bold('Information Added:') +
						'\n' +
						chalk.white(truncate(additionalInformation, 300, true)),
					{ padding: 1, borderColor: 'green', borderStyle: 'round' }
				)
			);
		}

		return subtask;
	} catch (error) {
		// Outer catch block handles final errors after loop/attempts
		// Stop indicator on error - only for text output (CLI)
		if (outputFormat === 'text' && loadingIndicator) {
			stopLoadingIndicator(loadingIndicator);
			loadingIndicator = null;
		}

		report(`Error updating subtask: ${error.message}`, 'error');

		// Only show error UI for text output (CLI)
		if (outputFormat === 'text') {
			console.error(chalk.red(`Error: ${error.message}`));

			// Provide helpful error messages based on error type
			if (error.message?.includes('ANTHROPIC_API_KEY')) {
				console.log(
					chalk.yellow('\nTo fix this issue, set your Anthropic API key:')
				);
				console.log('  export ANTHROPIC_API_KEY=your_api_key_here');
			} else if (error.message?.includes('PERPLEXITY_API_KEY')) {
				console.log(chalk.yellow('\nTo fix this issue:'));
				console.log(
					'  1. Set your Perplexity API key: export PERPLEXITY_API_KEY=your_api_key_here'
				);
				console.log(
					'  2. Or run without the research flag: task-master update-subtask --id=<id> --prompt=\"...\"'
				);
			} else if (error.message?.includes('overloaded')) {
				// Catch final overload error
				console.log(
					chalk.yellow(
						'\nAI model overloaded, and fallback failed or was unavailable:'
					)
				);
				console.log('  1. Try again in a few minutes.');
				console.log('  2. Ensure PERPLEXITY_API_KEY is set for fallback.');
				console.log('  3. Consider breaking your prompt into smaller updates.');
			} else if (error.message?.includes('not found')) {
				console.log(chalk.yellow('\nTo fix this issue:'));
				console.log(
					'  1. Run task-master list --with-subtasks to see all available subtask IDs'
				);
				console.log(
					'  2. Use a valid subtask ID with the --id parameter in format \"parentId.subtaskId\"'
				);
			} else if (error.message?.includes('empty response from AI')) {
				console.log(
					chalk.yellow(
						'\nThe AI model returned an empty response. This might be due to the prompt or API issues. Try rephrasing or trying again later.'
					)
				);
			}

			if (getDebugFlag()) {
				// Use getter
				console.error(error);
			}
		} else {
			throw error; // Re-throw for JSON output
		}

		return null;
	} finally {
		// Final cleanup check for the indicator, although it should be stopped by now
		if (outputFormat === 'text' && loadingIndicator) {
			stopLoadingIndicator(loadingIndicator);
		}
	}
}

export default updateSubtaskById;
