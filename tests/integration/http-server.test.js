/**
 * Integration test for Task Master MCP HTTP Server
 * Tests that the server starts correctly and responds to HTTP requests
 */

import { describe, it, beforeAll, afterAll, expect } from '@jest/globals';
import http from 'http';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_PORT = 3005; // Use different port to avoid conflicts
const SERVER_ENDPOINT = '/mcp';
const TEST_TIMEOUT = 30000; // 30 seconds

describe('Task Master MCP HTTP Server Integration', () => {
	let serverProcess;
	let serverUrl;

	beforeAll(async () => {
		// Set up environment variables
		const projectRoot = path.resolve(__dirname, '../../../..');
		const envPath = path.join(projectRoot, '.env');
		
		// Load .env file if it exists
		if (fs.existsSync(envPath)) {
			const envContent = fs.readFileSync(envPath, 'utf8');
			const envLines = envContent.split('\n');
			for (const line of envLines) {
				const match = line.match(/^([^=]+)=(.*)$/);
				if (match) {
					const [, key, value] = match;
					if (!process.env[key]) {
						process.env[key] = value;
					}
				}
			}
		}

		// Set required environment variables
		process.env.HOST = '0.0.0.0';
		process.env.PORT = String(SERVER_PORT);
		process.env.MCP_ENDPOINT = SERVER_ENDPOINT;
		process.env.STORAGE_ROOT = path.join(projectRoot, 'data', 'taskmaster-test');
		process.env.TASK_MASTER_TOOLS = 'standard';
		process.env.TASK_MASTER_MCP = 'true';

		// Ensure MISTRAL_API_KEY is set (required for server to start)
		if (!process.env.MISTRAL_API_KEY) {
			console.warn('⚠️  MISTRAL_API_KEY not set - server may fail to start');
		}

		serverUrl = `http://localhost:${SERVER_PORT}${SERVER_ENDPOINT}`;

		// Start the server as a child process
		const serverScript = path.resolve(__dirname, '../../../dist/mcp-server.js');
		
		if (!fs.existsSync(serverScript)) {
			throw new Error(`Server script not found at ${serverScript}. Run 'npm run build' first.`);
		}

		serverProcess = spawn('node', [serverScript], {
			env: process.env,
			stdio: ['ignore', 'pipe', 'pipe']
		});

		// Wait for server to start
		await new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error('Server failed to start within timeout'));
			}, 10000);

			serverProcess.stdout.on('data', (data) => {
				const output = data.toString();
				if (output.includes('HTTP transport active') || output.includes('server is running')) {
					clearTimeout(timeout);
					// Give server a moment to fully start
					setTimeout(resolve, 1000);
				}
			});

			serverProcess.stderr.on('data', (data) => {
				const error = data.toString();
				if (error.includes('Error') || error.includes('Failed')) {
					clearTimeout(timeout);
					reject(new Error(`Server error: ${error}`));
				}
			});

			serverProcess.on('exit', (code) => {
				clearTimeout(timeout);
				if (code !== 0 && code !== null) {
					reject(new Error(`Server exited with code ${code}`));
				}
			});
		});
	}, TEST_TIMEOUT);

	afterAll(async () => {
		if (serverProcess) {
			serverProcess.kill('SIGTERM');
			await new Promise((resolve) => {
				serverProcess.on('exit', resolve);
				setTimeout(resolve, 2000); // Force exit after 2 seconds
			});
		}
	}, 5000);

	it('should start the HTTP server and listen on the configured port', async () => {
		// Check if server is listening by making a simple request
		const response = await fetch(serverUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json, text/event-stream'
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: {
						name: 'test-client',
						version: '1.0.0'
					}
				}
			})
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('application/json');
	}, TEST_TIMEOUT);

	it('should respond to initialize request with capabilities', async () => {
		const response = await fetch(serverUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json, text/event-stream'
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {
						sampling: {}
					},
					clientInfo: {
						name: 'test-client',
						version: '1.0.0'
					}
				}
			})
		});

		const data = await response.json();
		expect(data.jsonrpc).toBe('2.0');
		expect(data.id).toBe(1);
		expect(data.result).toBeDefined();
		expect(data.result.capabilities).toBeDefined();
	}, TEST_TIMEOUT);

	it('should list available tools', async () => {
		const response = await fetch(serverUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json, text/event-stream'
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/list'
			})
		});

		const data = await response.json();
		expect(data.jsonrpc).toBe('2.0');
		expect(data.id).toBe(2);
		expect(data.result).toBeDefined();
		expect(data.result.tools).toBeDefined();
		expect(Array.isArray(data.result.tools)).toBe(true);
		expect(data.result.tools.length).toBeGreaterThan(0);
	}, TEST_TIMEOUT);

	it('should handle user ID from headers for authentication', async () => {
		const userId = 'test-user-123';
		const response = await fetch(serverUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json, text/event-stream',
				'X-LibreChat-User-ID': userId
			},
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 3,
				method: 'initialize',
				params: {
					protocolVersion: '2024-11-05',
					capabilities: {
						sampling: {}
					},
					clientInfo: {
						name: 'test-client',
						version: '1.0.0'
					}
				}
			})
		});

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.jsonrpc).toBe('2.0');
		// Server should accept the request with user ID header
	}, TEST_TIMEOUT);
});























