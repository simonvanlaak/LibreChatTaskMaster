#!/usr/bin/env node

import dotenv from 'dotenv';
import TaskMasterMCPServer from './src/index.js';
import logger from './src/logger.js';

// Load environment variables
dotenv.config();

// Set MCP mode to silence tm-core console output
process.env.TASK_MASTER_MCP = 'true';

/**
 * Start the MCP server
 */
async function startServer() {
	const server = new TaskMasterMCPServer();

	// Handle graceful shutdown
	process.on('SIGINT', async () => {
		logger.info('Received SIGINT, shutting down gracefully...');
		await server.stop();
		process.exit(0);
	});

	process.on('SIGTERM', async () => {
		logger.info('Received SIGTERM, shutting down gracefully...');
		await server.stop();
		process.exit(0);
	});

	try {
		await server.start();
		
		// For HTTP/SSE transport, keep the process alive
		// The server.start() returns immediately, but the HTTP server keeps running
		// We need to prevent the process from exiting
		const isHttpTransport = process.env.HOST && process.env.PORT;
		
		if (isHttpTransport) {
			logger.info('HTTP transport active, server is running and waiting for connections...');
			// Keep the process alive - the HTTP server should keep the event loop alive
			// Add a keep-alive interval as fallback to ensure process doesn't exit
			const keepAliveInterval = setInterval(() => {
				// This keeps the event loop alive
			}, 1000);
			
			// Clear interval on shutdown
			process.on('SIGINT', () => clearInterval(keepAliveInterval));
			process.on('SIGTERM', () => clearInterval(keepAliveInterval));
		} else {
			logger.info('stdio transport active, process will stay alive for stdio communication');
			// For stdio, the process stays alive automatically
		}
	} catch (error) {
		logger.error(`Failed to start MCP server: ${error.message}`);
		logger.error(error.stack);
		process.exit(1);
	}
}

// Start the server
startServer().catch((error) => {
	logger.error(`Unhandled error in startServer: ${error.message}`);
	logger.error(error.stack);
	process.exit(1);
});
