import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as Sentry from '@sentry/node';
import dotenv from 'dotenv';
import { FastMCP } from 'fastmcp';
import packageJson from '../../package.json' with { type: 'json' };
import ProviderRegistry from '../../src/provider-registry/index.js';
import { initializeSentry } from '../../src/telemetry/sentry.js';
import logger from './logger.js';
import { MCPProvider } from './providers/mcp-provider.js';
import {
	getToolsConfiguration,
	registerTaskMasterTools
} from './tools/index.js';

dotenv.config();

// Initialize Sentry after .env is loaded
initializeSentry();

// Constants
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Main MCP server class that integrates with Task Master
 */
class TaskMasterMCPServer {
	constructor() {
		this.options = {
			name: 'Task Master MCP Server',
			version: packageJson.version,
			// Authenticate function to extract user ID from headers for HTTP transport
			// Only used for SSE/HTTP transport, not for stdio
			authenticate: async (request) => {
				// Check if request exists and has headers (HTTP transport)
				if (!request || !request.headers) {
					// This is likely stdio transport, no authentication needed
					return undefined;
				}
				
				// Extract user ID from X-LibreChat-User-ID header (case-insensitive)
				const userId = request.headers['x-librechat-user-id'] || 
				               request.headers['X-LibreChat-User-ID'];
				
				if (userId && !userId.startsWith('{{')) {
					return { userId };
				}
				
				// If no user ID in header, return undefined (no auth required, but no user isolation)
				return undefined;
			}
		};

		// Create FastMCP instance
		const fastmcpServer = new FastMCP(this.options);

		// Wrap the underlying MCP server with Sentry instrumentation
		// FastMCP exposes the internal MCP server via _mcpServer property
		if (fastmcpServer._mcpServer && Sentry.wrapMcpServerWithSentry) {
			try {
				fastmcpServer._mcpServer = Sentry.wrapMcpServerWithSentry(
					fastmcpServer._mcpServer
				);
			} catch (error) {
				logger.warn(`Failed to wrap MCP server with Sentry: ${error.message}`);
			}
		}

		this.server = fastmcpServer;
		this.initialized = false;
		this.sseServer = null; // Store reference to SSE server for HTTP transport

		this.init = this.init.bind(this);
		this.start = this.start.bind(this);
		this.stop = this.stop.bind(this);

		this.logger = logger;
	}

	/**
	 * Initialize the MCP server with necessary tools and routes
	 */
	async init() {
		if (this.initialized) return;

		const normalizedToolMode = getToolsConfiguration();

		this.logger.info('Task Master MCP Server starting...');
		this.logger.info(`Tool mode configuration: ${normalizedToolMode}`);

		const registrationResult = registerTaskMasterTools(
			this.server,
			normalizedToolMode
		);

		this.logger.info(
			`Normalized tool mode: ${registrationResult.normalizedMode}`
		);
		this.logger.info(
			`Registered ${registrationResult.registeredTools.length} tools successfully`
		);

		if (registrationResult.registeredTools.length > 0) {
			this.logger.debug(
				`Registered tools: ${registrationResult.registeredTools.join(', ')}`
			);
		}

		if (registrationResult.failedTools.length > 0) {
			this.logger.warn(
				`Failed to register ${registrationResult.failedTools.length} tools: ${registrationResult.failedTools.join(', ')}`
			);
		}

		this.initialized = true;

		return this;
	}

	/**
	 * Start the MCP server
	 */
	async start() {
		if (!this.initialized) {
			await this.init();
		}

		// Set up session connect handler (for both transport types)
		this.server.on('connect', (event) => {
			const session = event.session;
			
			event.session.server.sendLoggingMessage({
				data: {
					context: event.session.context,
					message: `MCP Server connected: ${event.session.name}`
				},
				level: 'info'
			});

			// Extract user ID from session auth (set by authenticate function) for HTTP transport
			if (session.auth?.userId) {
				// Set LIBRECHAT_USER_ID in session env for path resolver
				if (!session.env) {
					session.env = {};
				}
				session.env.LIBRECHAT_USER_ID = session.auth.userId;
				this.logger.info(`Session authenticated for user: ${session.auth.userId}`);
			}

			this.registerRemoteProvider(session);
		});

		// Determine transport type based on environment
		// If HOST and PORT are set, use HTTP (SSE) transport for Docker/containerized deployment
		// Otherwise, use stdio for local/spawned processes
		const host = process.env.HOST;
		const port = process.env.PORT;
		// Only use HTTP/SSE transport if explicitly enabled via MCP_USE_HTTP env var
		// When spawned as stdio by LibreChat, we should use stdio transport
		const useHttpTransport = process.env.MCP_USE_HTTP === 'true' && host && port;

		if (useHttpTransport) {
			// HTTP/SSE transport for containerized deployment
			const endpoint = process.env.MCP_ENDPOINT || '/mcp';
			const portNum = parseInt(port, 10);

			// Ensure endpoint starts with /
			const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

			this.logger.info(
				`Starting MCP server on HTTP (SSE) transport at http://${host}:${portNum}${normalizedEndpoint}`
			);

			try {
				this.logger.info(`Calling server.start() with transportType: sse, endpoint: ${normalizedEndpoint}, port: ${portNum}`);
				
				await this.server.start({
					transportType: 'sse',
					sse: {
						endpoint: normalizedEndpoint,
						port: portNum
					}
				});

				this.logger.info('server.start() completed, checking for SSE server instance...');

				// For HTTP transport, keep the process alive
				// Store reference to prevent garbage collection and keep event loop alive
				// FastMCP stores the SSE server internally in a private field
				// Try to access it via reflection or check if server is actually listening
				this.sseServer = this.server._sseServer || this.server.sseServer;
				
				if (!this.sseServer) {
					this.logger.warn('SSE server reference not found in expected locations');
					this.logger.warn('Server may still be running - FastMCP stores it in a private field');
				} else {
					this.logger.info('SSE server reference found and stored');
				}
				
				this.logger.info(`MCP server startup completed for HTTP transport at http://${host}:${portNum}${normalizedEndpoint}`);
			} catch (error) {
				this.logger.error(`Failed to start SSE server: ${error.message}`);
				this.logger.error(error.stack);
				throw error;
			}
		} else {
			// stdio transport for spawned processes
			this.logger.info('Starting MCP server on stdio transport');

			await this.server.start({
				transportType: 'stdio',
				timeout: 120000 // 2 minutes timeout (in milliseconds)
			});
		}

		return this;
	}

	/**
	 * Register both MCP providers with the provider registry
	 */
	registerRemoteProvider(session) {
		// Check if the server has at least one session
		if (session) {
			// Make sure session has required capabilities
			if (!session.clientCapabilities || !session.clientCapabilities.sampling) {
				session.server.sendLoggingMessage({
					data: {
						context: session.context,
						message: `MCP session missing required sampling capabilities, providers not registered`
					},
					level: 'info'
				});
				return;
			}

			// Register MCP provider with the Provider Registry

			// Register the unified MCP provider
			const mcpProvider = new MCPProvider();
			mcpProvider.setSession(session);

			// Register provider with the registry
			const providerRegistry = ProviderRegistry.getInstance();
			providerRegistry.registerProvider('mcp', mcpProvider);

			session.server.sendLoggingMessage({
				data: {
					context: session.context,
					message: `MCP Server connected`
				},
				level: 'info'
			});
		} else {
			session.server.sendLoggingMessage({
				data: {
					context: session.context,
					message: `No MCP sessions available, providers not registered`
				},
				level: 'warn'
			});
		}
	}

	/**
	 * Stop the MCP server
	 */
	async stop() {
		if (this.server) {
			await this.server.stop();
		}
		if (this.sseServer) {
			// Additional cleanup if needed
			this.sseServer = null;
		}
	}
}

export default TaskMasterMCPServer;
