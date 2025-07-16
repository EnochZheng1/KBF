// server.js

// --- Dependencies ---
const os = require('os')
const express = require('express');
const axios = require('axios');
const multer = require('multer');
const fs = require('node:fs/promises');
const fscb = require('node:fs');
const path = require('path');
const FormData = require('form-data');
const app = express();
const port = 8080;
require('dotenv').config();
const { extractMediaEveryNSeconds } = require('./videoProcessor');
const { generateShortId } = require('./codex');

// --- Middleware ---
// Provides static file serving from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));
// Parses incoming JSON requests
app.use(express.json({ limit: '50mb' }));
// Configures multer for file uploads, storing files in memory
const upload = multer({ storage: multer.memoryStorage() });


// --- Configuration ---
const { BASE_URL,
        KB_API_KEY,
        CKB_API_KEY,
        CQKB_API_KEY,
        CGQA_API_KEY,
        FA_API_KEY,
        FANI_API_KEY,
        CT_API_KEY,
        FAQ_API_KEY,
        MEDIA_URL,
        PHOTO_API_KEY,
        AUDIO_API_KEY } = process.env;

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 15_000;
const MAX_RETRIES_FANI = 7;
const RETRY_DELAY_MS_FANI = 7_000;

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
                'Authorization': `Bearer ${CKB_API_KEY}`,
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
                'Authorization': `Bearer ${CKB_API_KEY}`,
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
                'Authorization': `Bearer ${CQKB_API_KEY}`,
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
    for (attempt = 1; attempt <= MAX_RETRIES; attempt++){
        try {
            const response = await axios.post(`${BASE_URL}/workflows/run`, req.body, {
                headers: {
                    'Authorization': `Bearer ${CGQA_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            const responseMessage = response.data?.data?.outputs;
            const result = responseMessage?.result?.[0];

            if (result?.status == 'failure'){
                let nestedResponse;
                try{
                    nestedResponse = JSON.parse(result.response);
                } catch (e){
                    throw new Error(result.message || 'Unknown failure reason');
                }

                if (nestedResponse.message?.includes("Document is not completed")){
                    if (attempt >= MAX_RETRIES){
                        logWithTimestamp('ERROR', 'Document still not ready after max retries.',{ final_error: nestedResponse });
                        return res.status(504).json({ error: 'Document processing timed out after several checks.' });
                    }

                    logWithTimestamp('WARN', `Attempt ${attempt}: Document not ready. Retrying in ${RETRY_DELAY_MS / 1000} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                    continue;
                } else {
                    throw new Error(nestedResponse.message || result.message);
                }
            }
            logWithTimestamp('INFO', '<-- Success response from /api/qa/generate', { data: response.data });
            return res.json(response.data);
        } catch (error) {
            logWithTimestamp('ERROR', 'Failed to generate Q&A', { error: error.message });
            return res.status(500).json({ error: error.message });
        }
    }
});

// Find an answer to a question
app.post('/api/qa/findAnswer', async (req, res) => {
    logWithTimestamp('INFO', 'Request to find answer', { body: req.body });
    const { query, dataset_id, doc_language, qa_dataset_id, qa_document_id } = req.body.inputs;
    
    if (!query || !dataset_id || !doc_language || !qa_dataset_id || !qa_document_id) {
        return res.status(400).json({ error: 'Missing one or more required inputs for findAnswer workflow.' });
    }
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++){
        try {
            const response = await axios.post(`${BASE_URL}/workflows/run`, req.body, {
                headers: {
                    'Authorization': `Bearer ${FA_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            const result = response.data?.data?.outputs?.result?.[0];
            if (result?.status === 'failure'){
                let nestedResponse;
                try{
                    nestedResponse = JSON.parse(result.response);
                } catch (e) {
                    logWithTimestamp('ERROR', 'Failed to parse nested JSON in failure response for findAnswer.', { rawResponse: result.response });
                    return res.status(500).json({ error: result.message || 'Unknown failure reason in workflow.' });
                }

                if (nestedResponse.message?.includes("Document is not completed")){
                    if (attempt >= MAX_RETRIES){
                        logWithTimestamp('ERROR', 'Document still not ready for findAnswer after max retries');
                        return res.json(504).json({ error:"Document processing timed out." });
                    }
                    logWithTimestamp('WARN', `Attempt ${attempt}: Document not ready for findAnswer. Retrying in ${RETRY_DELAY_MS / 1000} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                    continue;
                } else {
                    logWithTimestamp('ERROR', 'findAnswer workflow returned a failure status.', { details: nestedResponse });
                    return res.status(500).json({ error: nestedResponse.message || result.message });
                }
            } else {
                logWithTimestamp('INFO', '<-- Success response from /api/qa/findAnswer', { data: response.data });
                return res.json(response.data);
            }
        } catch (error) {
            logWithTimestamp('ERROR', 'Failed to find answer', { error: error.message });
            res.status(500).json({ error: error.message });
        }
    }
});


// Get all datasets (knowledge bases)
app.get('/api/datasets', async (req, res) => {
    logWithTimestamp('INFO', 'Request to get knowledge base list', { query: req.query });
    try {
        const response = await axios.get(`${BASE_URL}/datasets`, {
            params: req.query,
            headers: {
                'Authorization': `Bearer ${KB_API_KEY}`,
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
                'Authorization': `Bearer ${KB_API_KEY}`,
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
                'Authorization': `Bearer ${KB_API_KEY}`,
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
                'Authorization': `Bearer ${KB_API_KEY}`,
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
                'Authorization': `Bearer ${KB_API_KEY}`,
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

const videoUpload = multer({ storage: multer.memoryStorage() });

app.post('/api/video/process', videoUpload.single('video'), async (req, res) => {
    const user = (req.body.user || 'frontend-user').trim();
    if (!req.file) {
        return res.status(400).json({ error: 'No video file uploaded.' });
    }

    const { buffer, originalname } = req.file;
    const tmpDir = path.join(os.tmpdir(), 'video_' + Date.now());

    try {
        await fs.mkdir(tmpDir, { recursive: true });
        const videoPath = path.join(tmpDir, originalname);
        await fs.writeFile(videoPath, buffer);

        logWithTimestamp('INFO', 'Starting video extraction...', { videoPath });
        // Extracts media every 10 seconds. You can adjust this interval.
        const { framesDir, audioDir } = await extractMediaEveryNSeconds(videoPath, tmpDir, 600);

        const framePaths = (await fs.readdir(framesDir)).map(f => path.join(framesDir, f)).sort();
        const audioPaths = (await fs.readdir(audioDir)).map(f => path.join(audioDir, f)).sort();

        const segmentStrings = [];
        for (let i = 0; i < Math.min(framePaths.length, audioPaths.length); i++) {
            logWithTimestamp('INFO', `Processing segment ${i + 1}/${framePaths.length}`);
            const [imageResult, audioResult] = await Promise.all([
                processImageFile(framePaths[i], user),
                processAudioFile(audioPaths[i], user),
            ]);
            // Combine the visual summary and audio transcription for each segment
            segmentStrings.push(`Timestamp: ${i*10}-${(i+1)*10} seconds.\nVisual Summary: ${imageResult}\nAudio Transcription: ${audioResult}`);
        }

        // Join all segments into one large block of text
        const videoContextString = segmentStrings.join('\n\n---\n\n');
        logWithTimestamp('INFO', 'Video context assembled', { length: videoContextString.length });

        // **CRITICAL CHANGE**: Simply return the generated text
        res.json({
            success: true,
            full_text: videoContextString
        });

    } catch (error) {
        logWithTimestamp('ERROR', 'Video processing failed', { error: error.message });
        res.status(500).json({ error: error.message });
    } finally {
        // Cleanup the temporary directory
        await fs.rm(tmpDir, { recursive: true, force: true });
        logWithTimestamp('INFO', 'Temporary video directory cleaned up.', { tmpDir });
    }
});

async function processImageFile(filePath, user) {
  const buffer = await fs.readFile(filePath);
  const form = new FormData();
  form.append('file', buffer, {
    filename: path.basename(filePath),
    contentType: 'image/jpeg'
  });
  form.append('user', user);

  logWithTimestamp('INFO', 'Uploading image to Knowledge Factory', { filePath });

  const uploadResp = await axios.post(
    `${MEDIA_URL}/files/upload`,
    form,
    {
      headers: {
        Authorization: `Bearer ${PHOTO_API_KEY}`,
        ...form.getHeaders()
      }
    }
  );

  const fileId = uploadResp.data.id;
  logWithTimestamp('INFO', 'Image uploaded successfully', { fileId });

  logWithTimestamp('INFO', 'Running image-to-text workflow...');

  try {
    const workflowResp = await axios.post(
      `${MEDIA_URL}/workflows/run`,
      {
        inputs: {
          // The input key 'pic' is based on your example.
          // Ensure this matches the expected input in your workflow.
          pic: { 
            "transfer_method": "local_file",
            "upload_file_id": fileId,
            "type": "image"
          }
        },
        response_mode: 'blocking',
        user
      },
      {
        headers: {
          // Use the specific API key for the photo/image workflow
          Authorization: `Bearer ${PHOTO_API_KEY}`
        }
      }
    );

    logWithTimestamp('INFO', 'Image workflow completed successfully.');
    // The exact path to the output text might vary based on your workflow's configuration
    return workflowResp.data.data.outputs.text || '';

  } catch (err) {
    logWithTimestamp('ERROR', 'Error in image workflow', { error: err.response?.data || err.message });
    throw err;
  }
}

async function processAudioFile(filePath, user) {
    const buffer = await fs.readFile(filePath);

    const form = new FormData();
    form.append('file', buffer, {
        filename: path.basename(filePath),
        contentType: 'audio/mpeg'
    });
    form.append('user', user);

    logWithTimestamp('INFO', 'Uploading audio to Knowledge Factory', { filePath });

    // Step 1: Upload the file
    const uploadResp = await axios.post(
        `${MEDIA_URL}/files/upload`,
        form,
        {
            headers: {
                Authorization: `Bearer ${AUDIO_API_KEY}`,
                ...form.getHeaders()
            }
        }
    );

    const fileId = uploadResp.data.id;
    logWithTimestamp('INFO', 'Audio uploaded successfully', { fileId });

    logWithTimestamp('INFO', 'Running audio-to-text workflow...');

    // Step 2: Run the corresponding workflow
    try {
        const workflowResp = await axios.post(
        `${MEDIA_URL}/workflows/run`,
        {
            inputs: {
                // The input key 'speech' is based on your example.
                // Ensure this matches the expected input in your workflow.
                speech: {
                    "transfer_method": "local_file",
                    "upload_file_id": fileId,
                    "type": "audio" 
                }
            },
            response_mode: 'blocking',
            user
        },
        {
            headers: {
            // Use the specific API key for the audio/speech workflow
            Authorization: `Bearer ${AUDIO_API_KEY}`
            }
        }
        );

        logWithTimestamp('INFO', 'Audio workflow completed successfully.');
        return workflowResp.data.data.outputs.text || '';

    } catch (err) {
        logWithTimestamp('ERROR', 'Error in audio workflow', { error: err.response?.data || err.message });
        throw err;
    }
}

app.post('/api/generate-short-id', express.json(), (req, res) => {
    const { longId } = req.body;

    if (!longId) {
        return res.status(400).json({ error: 'longId is required in the request body.' });
    }

    try {
        const shortId = generateShortId(longId);
        res.json({ shortId: shortId });
    } catch (error) {
        console.error('Error generating short ID:', error);
        res.status(500).json({ error: 'Failed to generate short ID.' });
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