const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('./config/database');
const fs = require('fs');
const QRCode = require('qrcode');
const Advisor = require('./models/Advisor');

const app = express();

// Import Routes
const advisorRoutes = require('./routes/advisorRoutes');
const feedbackRoutes = require('./routes/feedbackRoutes');

// Function to Get Local IP Address Dynamically
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const iface of Object.values(interfaces)) {
        for (const config of iface) {
            if (config.family === 'IPv4' && !config.internal) {
                return config.address;
            }
        }
    }
    return '127.0.0.1'; // Fallback to localhost if no valid IP found
}

// Get the initial IP and keep it updated
let LOCAL_IP = getLocalIP();
console.log(`Local IP Address: ${LOCAL_IP}`);

// Periodically check for IP changes (every 30 seconds)
setInterval(() => {
    const newIP = getLocalIP();
    if (newIP !== LOCAL_IP) {
        console.log(`IP Changed: ${LOCAL_IP} ➝ ${newIP}`);
        LOCAL_IP = newIP;
    }
}, 30000);

const PORT = process.env.PORT || 5000;

console.log(`Backend running on: http://${LOCAL_IP}:${PORT}`);

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); // Ensure form data works properly

// Ensure QR Codes Directory Exists
const QR_CODE_DIR = path.join(__dirname, 'public/qrcodes');
if (!fs.existsSync(QR_CODE_DIR)) {
    fs.mkdirSync(QR_CODE_DIR, { recursive: true });
    console.log('Created directory for storing QR codes.');
}

// Serve Static Files for QR Codes
app.use('/qrcodes', express.static(QR_CODE_DIR, {
    setHeaders: (res) => {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Cache-Control', 'public, max-age=31557600');
    }
}));

// Generate QR Code for an Advisor (Using Render Backend URL)
const updateAllQRCodes = async () => {
    try {
        const RENDER_BACKEND_URL = "https://qr-feedback-system-backend-czm2.onrender.com"; // Use live backend URL
        const advisors = await Advisor.find({}); // Fetch all advisors

        for (const advisor of advisors) {
            const qrCodePath = path.join(QR_CODE_DIR, `${advisor._id}.png`);
            const newQRCodeURL = `${RENDER_BACKEND_URL}/qrcodes/${advisor._id}.png`;

            // Always regenerate QR Code with the Render Backend URL
            await QRCode.toFile(qrCodePath, `${RENDER_BACKEND_URL}/feedback/${advisor._id}`);

            // Update MongoDB if the QR Code is outdated
            if (advisor.qrCode !== newQRCodeURL) {
                advisor.qrCode = newQRCodeURL;
                await advisor.save(); // Save the updated QR Code to the database
                console.log(`✅ Updated QR Code for ${advisor.name}: ${newQRCodeURL}`);
            }
        }
        console.log("🎉 All QR Codes Updated Successfully!");
    } catch (error) {
        console.error("❌ Error updating QR Codes:", error);
    }
};

// Run this function once when the server starts
updateAllQRCodes();

// Submit Feedback API (Handles Form Submission)
app.post('/submit-feedback', async (req, res) => {
    try {
        const { advisorId, rating, comments } = req.body;

        if (!advisorId || !rating) {
            return res.status(400).json({ message: 'Advisor ID and rating are required' });
        }

        const advisor = await Advisor.findById(advisorId);
        if (!advisor) {
            return res.status(404).json({ message: 'Advisor not found' });
        }

        // Store Feedback in Advisor's Performance Data
        advisor.performanceData.push({
            rating: parseInt(rating),
            comments: comments || "",
            date: new Date()
        });
        await advisor.save();

        console.log(`Feedback submitted for ${advisor.name}: Rating - ${rating}`);
        res.send(`
            <h2>Thank You!</h2>
            <p>Your feedback has been submitted successfully.</p>
            <p>You may now close this page.</p>
        `);
    } catch (error) {
        console.error('Error submitting feedback:', error);
        res.status(500).json({ message: 'Error submitting feedback', error });
    }
});

// Feedback Form Page (Opens when customer scans QR Code)
app.get('/feedback/:advisorId', async (req, res) => {
    try {
        const RENDER_BACKEND_URL = "https://qr-feedback-system-backend-czm2.onrender.com"; // ✅ Use Render's backend
        const { advisorId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(advisorId)) {
            return res.status(400).json({ message: 'Invalid Advisor ID format' });
        }

        const advisor = await Advisor.findById(advisorId);
        if (!advisor) {
            return res.status(404).json({ message: 'Advisor not found' });
        }

        // ✅ Ensure the feedback form submits to Render
        res.send(`
            <html>
            <head>
                <title>Feedback for ${advisor.name}</title>
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }
                    form { display: inline-block; text-align: left; width: 300px; }
                    label { font-weight: bold; display: block; margin-top: 10px; }
                    input, textarea { width: 100%; padding: 8px; margin: 5px 0; }
                    button { background-color: #28a745; color: white; padding: 10px; border: none; cursor: pointer; width: 100%; }
                    button:hover { background-color: #218838; }
                </style>
            </head>
            <body>
                <h2>Provide Feedback for ${advisor.name}</h2>
                <form action="${RENDER_BACKEND_URL}/submit-feedback" method="POST">
                    <input type="hidden" name="advisorId" value="${advisor._id}" />
                    
                    <label for="rating">Rate the Service (1-5):</label>
                    <input type="number" name="rating" min="1" max="5" required />

                    <label for="comments">Optional Comments:</label>
                    <textarea name="comments" placeholder="Write your feedback here..."></textarea>

                    <button type="submit">Submit Feedback</button>
                </form>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('Error fetching feedback page:', error);
        res.status(500).json({ message: 'Server error', error });
    }
});

// Root API Check
app.get('/', (req, res) => {
    res.send(`API is running on: http://${LOCAL_IP}:${PORT}`);
});

// Apply Routes for Advisors & Feedback
app.use('/api/advisors', advisorRoutes);
app.use('/api/feedback', feedbackRoutes);

// Start the Server
(async () => {
    await updateAllQRCodes(); // Regenerate QR Codes at Startup
})();

// Start the Server
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`MongoDB Connected...`);
    console.log(`Server running on http://${LOCAL_IP}:${PORT}`);
});