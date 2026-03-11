import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';
import { createTrelloMcpServer } from './server-factory.js';

dotenv.config();

const credentials = {
	apiKey: process.env.TRELLO_API_KEY || '',
	apiToken: process.env.TRELLO_API_TOKEN || '',
};

const server = createTrelloMcpServer(credentials);
const transport = new StdioServerTransport();
server.connect(transport);

export default server;
