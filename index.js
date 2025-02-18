// There are some modeuls which helps:

//  Express - create a http server
//  WebSocket - create a websocket server ( easily communicate with the browser {client }))
//  cors - allows to connect with different origins ( urls)
//  OpenAI - connect with the OpenAI API

import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { readFileSync } from 'fs';
dotenv.config();


const app = express(); // create a new express application
app.use(cors()); // allow cross-origin requests
app.use(express.json()); // get the data and convert data into json

// Resource to learn about web socket { https://projects.100xdevs.com/tracks/ABEC/ABEC-3}

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Initialize Google Sheets Authentication
const credentials = JSON.parse(readFileSync('./google-credentials.json'));
const serviceAccountAuth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

async function getSheetData(spreadsheetId) {
    const doc = new GoogleSpreadsheet(spreadsheetId, serviceAccountAuth);
    await doc.loadInfo();
    
    const sheetData = {};
    for (let i = 0; i < doc.sheetCount; i++) {
        const sheet = doc.sheetsByIndex[i];
        await sheet.loadCells();
        const rows = await sheet.getRows();
        sheetData[sheet.title] = {
            title: sheet.title,
            headers: rows[0] ? Object.keys(rows[0]).filter(key => !key.startsWith('_')) : [],
            rows: rows.map(row => {
                const rowData = {};
                Object.keys(row).filter(key => !key.startsWith('_')).forEach(key => {
                    rowData[key] = row[key];
                });
                return rowData;
            })
        };
    }
    return sheetData;
}

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('New client connected');

    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            
            // If spreadsheet ID is provided, fetch the data
            let sheetData = {};
            if (message.spreadsheetId) {
                sheetData = await getSheetData(message.spreadsheetId);
            }

            // Prepare context for GPT
            const context = `You are an AI analyst specialized in analyzing spreadsheet data and providing insights. 
            You have access to the following spreadsheet data: ${JSON.stringify(sheetData, null, 2)}
            
            Please analyze this data and provide insights based on the user's question. 
            Consider:
            1. Trends and patterns in the data
            2. Key metrics and their relationships
            3. Potential forecasts based on historical data
            4. Any anomalies or interesting findings
            
            Format your response in a clear, structured way with sections for:
            - Summary of findings
            - Detailed analysis
            - Recommendations (if applicable)
            - Data limitations or caveats`;

            // Call OpenAI API with enhanced context
            const response = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: context },
                    { role: "user", content: message.content }
                ],
                temperature: 0.7,
                max_tokens: 2000
            });

            // Send response back to client
            ws.send(JSON.stringify({
                role: 'assistant',
                content: response.choices[0].message.content
            }));
        } catch (error) {
            console.error('Error:', error);
            ws.send(JSON.stringify({
                role: 'assistant',
                content: 'Sorry, there was an error processing your request: ' + error.message
            }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

// Basic health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Start the backend server
const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 