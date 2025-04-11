/**
 * tools/parsePRD.js
 * Tool to parse PRD document and generate tasks
 */

import { z } from 'zod';
import {
	handleApiResult,
	createErrorResponse,
	getProjectRootFromSession
} from './utils.js';
import { parsePRDDirect } from '../core/task-master-core.js';

/**
 * Register the parsePRD tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerParsePRDTool(server) {
	server.addTool({
		name: 'parse_prd',
		description:
			"Parse a Product Requirements Document (PRD) text file to automatically generate initial tasks. Reinitializing the project is not necessary to run this tool. It is recommended to run parse-prd after initializing the project and creating/importing a prd.txt file in the project root's scripts/ directory.",
		parameters: z.object({
			input: z
				.string()
				.default('scripts/prd.txt')
				.describe('Absolute path to the PRD document file (.txt, .md, etc.)'),
			numTasks: z
				.string()
				.optional()
				.describe(
					'Approximate number of top-level tasks to generate (default: 10). As the agent, if you have enough information, ensure to enter a number of tasks that would logically scale with project complexity. Avoid entering numbers above 50 due to context window limitations.'
				),
			output: z
				.string()
				.optional()
				.describe(
					'Output absolute path for tasks.json file (default: tasks/tasks.json)'
				),
			force: z
				.boolean()
				.optional()
				.describe('Allow overwriting an existing tasks.json file.'),
			projectRoot: z
				.string()
				.describe(
					'Absolute path to the root directory of the project. Required - ALWAYS SET THIS TO THE PROJECT ROOT DIRECTORY.'
				)
		}),
		execute: async (args, { log, session }) => {
			try {
				log.info(`Parsing PRD with args: ${JSON.stringify(args)}`);

				// Make sure projectRoot is passed directly in args or derive from session
				// We prioritize projectRoot from args over session-derived path
				let rootFolder = args.projectRoot;

				// Only if args.projectRoot is undefined or null, try to get it from session
				if (!rootFolder) {
					log.warn(
						'projectRoot not provided in args, attempting to derive from session'
					);
					rootFolder = getProjectRootFromSession(session, log);

					if (!rootFolder) {
						const errorMessage =
							'Could not determine project root directory. Please provide projectRoot parameter.';
						log.error(errorMessage);
						return createErrorResponse(errorMessage);
					}
				}

				log.info(`Using project root: ${rootFolder} for PRD parsing`);

				const result = await parsePRDDirect(
					{
						projectRoot: rootFolder,
						...args
					},
					log,
					{ session }
				);

				if (result.success) {
					log.info(`Successfully parsed PRD: ${result.data.message}`);
				} else {
					log.error(
						`Failed to parse PRD: ${result.error?.message || 'Unknown error'}`
					);
				}

				return handleApiResult(result, log, 'Error parsing PRD');
			} catch (error) {
				log.error(`Error in parse-prd tool: ${error.message}`);
				return createErrorResponse(error.message);
			}
		}
	});
}
