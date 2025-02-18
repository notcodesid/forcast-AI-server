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
    try {
        const doc = new GoogleSpreadsheet(spreadsheetId, serviceAccountAuth);
        await doc.loadInfo();
        console.log(`Accessed document: ${doc.title}`);
        
        const sheetData = {};
        for (let i = 0; i < doc.sheetCount; i++) {
            const sheet = doc.sheetsByIndex[i];
            console.log(`Processing sheet: ${sheet.title}`);
            
            // Load all cells in the sheet
            await sheet.loadCells();
            
            // Get sheet dimensions
            const rowCount = sheet.rowCount;
            const columnCount = sheet.columnCount;
            
            // Initialize data structure for this sheet
            const rows = [];
            
            // Iterate through all cells and get their values
            for (let row = 0; row < rowCount; row++) {
                const rowData = [];
                for (let col = 0; col < columnCount; col++) {
                    const cell = sheet.getCell(row, col);
                    // Get the formatted value or raw value
                    rowData.push(cell.formattedValue || cell.value || '');
                }
                // Only add rows that have at least one non-empty cell
                if (rowData.some(cell => cell !== '')) {
                    rows.push(rowData);
                }
            }

            sheetData[sheet.title] = {
                title: sheet.title,
                data: rows,
                rowCount: rowCount,
                columnCount: columnCount
            };
        }
        return sheetData;
    } catch (error) {
        console.error('Error accessing sheet:', error);
        throw new Error(`Failed to access sheet: ${error.message}`);
    }
}

async function analyzeSheetData(sheetData, userQuestion) {
    // Extract relevant data for analysis
    const merMakeSheet = sheetData['MER MAKE']?.data || [];
    
    // Process the data to extract ROAS metrics
    const processedData = merMakeSheet.map(row => {
        return {
            date: row[0],  // Date column
            metaRoas: parseFloat(row[3]) || 0,  // Meta ROAS column
            googleRoas: parseFloat(row[5]) || 0  // Google ROAS column
        };
    }).filter(row => row.date && (row.metaRoas || row.googleRoas));

    // Create a focused context with the specific metrics
    const context = `You are an AI analyst specialized in analyzing marketing data.
    You have access to detailed marketing performance data including:
    - Meta and Google ROAS trends over time
    - Daily performance metrics
    - Campaign effectiveness indicators

    The data shows ROAS (Return on Ad Spend) metrics for both Meta and Google campaigns:
    ${JSON.stringify(processedData, null, 2)}

    When analyzing ROAS:
    - Higher ROAS indicates better ad performance
    - Look for trends and patterns over time
    - Compare Meta vs Google performance
    - Identify any significant changes or anomalies

    Please provide a detailed analysis focusing on:
    1. Clear ROAS trends for both platforms
    2. Platform comparison and effectiveness
    3. Specific insights about performance changes
    4. Data-backed observations

    Format your response in a clear, structured way with specific numbers and trends.`;

    // Call OpenAI API with the focused context
    const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
            { role: "system", content: context },
            { role: "user", content: userQuestion }
        ],
        temperature: 0.7,
        max_tokens: 1500
    });

    return response.choices[0].message.content;
}

// Update the WebSocket handler
wss.on('connection', (ws) => {
    console.log('New client connected');

    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            
            let sheetData = {};
            if (message.spreadsheetId) {
                sheetData = await getSheetData(message.spreadsheetId);
                const analysis = await analyzeSheetData(sheetData, message.content);
                
                ws.send(JSON.stringify({
                    role: 'assistant',
                    content: analysis
                }));
            }
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