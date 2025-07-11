// server.js

// --- Dependencies ---
const express = require('express');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const app = express();
const port = 8080;

// --- Middleware ---
// Provides static file serving from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));
// Parses incoming JSON requests
app.use(express.json({ limit: '50mb' }));
// Configures multer for file uploads, storing files in memory
const upload = multer({ storage: multer.memoryStorage() });


// --- Configuration ---
const BASE_URL = "https://agent.helport.ai/v1";
const API_KEYS = {
    KB_API_KEY: "dataset-Wui7Wlhj6jtY10rW0wXjoUqo",      // For general knowledge base operations
    CKB_API_KEY: "app-8eO9ykobHpIHZ9dGicfdRBii",     // For creating knowledge bases from files
    CQKB_API_KEY: "app-grIDUxUxkAOPApD8kAL21VIO",    // For creating empty Q&A knowledge bases
    CGQA_API_KEY: "app-FHPDSyg7cYeczAVFLfbHLTr0",    // For generating Q&A from a chunk of text
    FA_API_KEY: "app-0AoAfHqk1hcmEpZCyuFQE2QA",      // For finding answers to questions
    CT_API_KEY: "app-uQvMedtGR6A5TvAA8U8mf41d", // 场景类别生成
    FAQ_API_KEY: "app-tO3bxAksvtgZ2i9FOg71av6u" // 常见问题生成

};

// --- Logger Utility ---
function logWithTimestamp(level, message, data = {}) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    // Use console.log for info and console.error for errors to get color-coding in most terminals
    const logFunc = level === 'ERROR' || level === 'WARN' ? console.error : console.log;
    logFunc(JSON.stringify({ timestamp, level, message, ...data }, null, 2));
}


// --- API Endpoints ---

// Upload a file to the AI platform
app.post('/api/files/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        logWithTimestamp('WARN', 'File upload failed', { reason: 'No file provided' });
        return res.status(400).send('No file uploaded.');
    }
    // The user ID should be sent in the request body by the frontend
    const { user } = req.body; 
    if (!user) {
        logWithTimestamp('WARN', 'File upload failed', { reason: 'No user ID provided in the request body' });
        return res.status(400).send('User ID is required.');
    }

    try {
        const formData = new FormData();
        formData.append('file', req.file.buffer, { filename: req.file.originalname });
        formData.append('user', user);

        const response = await axios.post(`${BASE_URL}/files/upload`, formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${API_KEYS.CKB_API_KEY}`,
            }
        });
        
        logWithTimestamp('INFO', 'File uploaded successfully', { filename: req.file.originalname });
        res.json(response.data);

    } catch (error) {
        logWithTimestamp('ERROR', 'File upload to AI platform failed', { error: error.message });
        res.status(500).json({ error: 'Failed to upload file to AI platform.' });
    }
});


// Create a new knowledge base
app.post('/api/qa/create_knowledge', async (req, res) => {
    logWithTimestamp('INFO', 'Request to create knowledge base', { body: req.body });
    try {
        const response = await axios.post(`${BASE_URL}/workflows/run`, req.body, {
            headers: {
                'Authorization': `Bearer ${API_KEYS.CKB_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        res.json(response.data);
    } catch (error) {
        logWithTimestamp('ERROR', 'Failed to create knowledge base', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// Create an empty Q&A knowledge base
app.post('/api/qa/create_qa_knowledge', async (req, res) => {
    logWithTimestamp('INFO', 'Request to create Q&A knowledge base', { body: req.body });
    logWithTimestamp('INFO', '--> Received request for /api/qa/create_qa_knowledge', { body: req.body });
    try {
        const response = await axios.post(`${BASE_URL}/workflows/run`, req.body, {
            headers: {
                'Authorization': `Bearer ${API_KEYS.CQKB_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        logWithTimestamp('INFO', '<-- Success response from /api/qa/create_qa_knowledge', { data: response.data });
        res.json(response.data);
    } catch (error) {
        logWithTimestamp('ERROR', 'Failed to create Q&A knowledge base', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// Generate Q&A from a text chunk
app.post('/api/qa/generate', async (req, res) => {
    const { chunk, ...restOfBody } = req.body.inputs;
    logWithTimestamp('INFO', 'Request to generate Q&A', { body: req.body });
    logWithTimestamp('INFO', '--> Received request for /api/qa/generate', { inputs: { ...restOfBody, chunk: `(text chunk of ${chunk.length} chars)` }});
    try {
        const response = await axios.post(`${BASE_URL}/workflows/run`, req.body, {
            headers: {
                'Authorization': `Bearer ${API_KEYS.CGQA_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        logWithTimestamp('INFO', '<-- Success response from /api/qa/generate', { data: response.data });
        res.json(response.data);
    } catch (error) {
        logWithTimestamp('ERROR', 'Failed to generate Q&A', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// Find an answer to a question
app.post('/api/qa/findAnswer', async (req, res) => {
    logWithTimestamp('INFO', 'Request to find answer', { body: req.body });
    const { query, dataset_id, doc_language, qa_dataset_id, qa_document_id } = req.body.inputs;
    
    if (!query || !dataset_id || !doc_language || !qa_dataset_id || !qa_document_id) {
        return res.status(400).json({ error: 'Missing one or more required inputs for findAnswer workflow.' });
    }
    try {
        const response = await axios.post(`${BASE_URL}/workflows/run`, req.body, {
            headers: {
                'Authorization': `Bearer ${API_KEYS.FA_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        res.json(response.data);
    } catch (error) {
        logWithTimestamp('ERROR', 'Failed to find answer', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});


// Get all datasets (knowledge bases)
app.get('/api/datasets', async (req, res) => {
    logWithTimestamp('INFO', 'Request to get knowledge base list', { query: req.query });
    try {
        const response = await axios.get(`${BASE_URL}/datasets`, {
            params: req.query,
            headers: {
                'Authorization': `Bearer ${API_KEYS.KB_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        logWithTimestamp('INFO', '<-- Success response from /api/datasets', { data: response.data });
        if (response.status !== 200) throw new Error(`HTTP Error: ${response.status}`);
        res.json({ data: response.data });
    } catch (error) {
        logWithTimestamp('ERROR', 'Failed to get knowledge base list', { message: error.message });
        res.status(500).json({ error: 'Failed to get knowledge base list', details: error.message });
    }
});

// 2. Get all documents within a specific knowledge base
app.get('/api/datasets/:datasetId/documents', async (req, res) => {
    const { datasetId } = req.params;
    logWithTimestamp('INFO', 'Request to get document list', { dataset_id: datasetId });
    try {
        const response = await axios.get(`${BASE_URL}/datasets/${datasetId}/documents`, {
            params: req.query,
            headers: {
                'Authorization': `Bearer ${API_KEYS.KB_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        logWithTimestamp('INFO', '<-- Success response from /api/datasets/:datasetId/documents', { data: response.data });
        if (response.status !== 200) throw new Error(`HTTP Error: ${response.status}`);
        res.json(response.data);
    } catch (error) {
        logWithTimestamp('ERROR', 'Failed to get document list', { dataset_id: datasetId, message: error.message });
        res.status(500).json({ error: 'Failed to get document list', details: error.message });
    }
});

// 3. Get all segments (Q&A pairs) from a specific document
app.get('/api/datasets/:datasetId/documents/:documentId/segments', async (req, res) => {
    const { datasetId, documentId } = req.params;
    logWithTimestamp('INFO', 'Request to get document segments', { dataset_id: datasetId, document_id: documentId });
    try {
        const response = await axios.get(`${BASE_URL}/datasets/${datasetId}/documents/${documentId}/segments`, {
            params: req.query,
            headers: {
                'Authorization': `Bearer ${API_KEYS.KB_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        logWithTimestamp('INFO', '<-- Success response from /api/datasets/:datasetId/documents/:documentId/segments', { data: response.data });
        if (response.status !== 200) throw new Error(`HTTP Error: ${response.status}`);
        res.json(response.data);
    } catch (error) {
        logWithTimestamp('ERROR', 'Failed to get document segments', { dataset_id: datasetId, message: error.message });
        res.status(500).json({ error: 'Failed to get document segments', details: error.message });
    }
});

app.get('/api/document-status', async(req, res) => {
    const { datasetId, batch } = req.body;
    if (!datasetId || !batch){
        return res.status(400).json({ error: 'datasetId and documentId are required in the body.' });
    }
    logWithTimestamp('INFO', 'Request to get document indexing status', { dataset_id: datasetId, batch: batch });
    try{
        const response = await axios.get(`${BASE_URL}/datasets/${datasetId}/documents/${batch}/indexing-status`, {
            headers: {
                'Authorization': `Bearer ${API_KEYS.KB_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        logWithTimestamp('INFO', '<-- Success response from /indexing-status', { data: response.data });
        res.json(response.data);
    } catch (error) {
        logWithTimestamp('ERROR', 'Failed to get document indexing status', { dataset_id: datasetId, batch: batch, message: error.message });
        res.status(500).json({ error: 'Failed to get document indexing status' });
    }

});

app.delete('/api/datasets/:datasetId', async (req, res) => {
    const { datasetId } = req.params;
    if (!datasetId) {
        return res.status(400).json({ message: 'Dataset ID is required.' });
    }
    console.log(`Forwarding DELETE request for dataset ${datasetId}`);
    try {
        const response = await axios.delete(`${BASE_URL}/datasets/${datasetId}`, {
            headers: {
                // Use 'Authorization' header with a Bearer token, a common standard
                'Authorization': `Bearer ${API_KEYS.KB_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        console.log('Dataset successfully deleted from Helport API.');
        res.status(200).json({
            message: `Dataset with ID: ${datasetId} deleted successfully.`,
            data: response.data
        });
    } catch (error){
        console.error('Error deleting dataset from Helport API:', error.response ? error.response.data : error.message);

        if (error.response) {
            res.status(error.response.status).json({
                message: `Failed to delete dataset with ID: ${datasetId}.`,
                error: error.response.data
            });
        } else {
            res.status(500).json({
                message: 'An unexpected server error occurred.',
                error: error.message
            });
        }
    }

});


// app.post('/api/faq/generate', async (req, res) => {
//     const { scenario, category, num, answer_format, userId } = req.body;

//     if (!scenario || !num || !userId){
//         return res.status(400).json({
//             success: false,
//             message: '缺少必要的输入参数。请确保场景、数量和用户ID都已提供。'
//         });
//     }

//     const numberOfFAQs = parseInt(num, 10);
//     if (isNaN(numberOfFAQs) || numberOfFAQs <= 0){
//         return res.status(400).json({
//             success: false,
//             message: '生成数量（num）必须是正整数。'
//         })
//     }

//     try {

//         if (category){

//         } else {

//         }

//         res.json("placeholder");

//     } catch (error) {
//         console.error('生成FAQ列表时发生错误: ', error);
//         res.status(500).json({
//             success: false,
//             message: `生成FAQ列表失败: ${error.message}`
//         });
//     }
// });

// --- Default Route to Serve Frontend ---
// This must be the last route. It ensures that any request not matching an API endpoint
// will serve the main index.html file, allowing your frontend application to handle routing.
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Start the Server ---
app.listen(port, () => {
    logWithTimestamp('INFO', `Server starting on port ${port}`);
});