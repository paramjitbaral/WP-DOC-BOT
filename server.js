require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const app = express();
app.use(express.json());

// Load Environment Variables (Tokens from Meta)
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'my_family_bot_secret';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// Store temporary user selections in memory
const userState = {};

// Nicknames / Aliases mapping for family members
const nameAliases = {
    'nunu': 'paramjit',
    'swaraj': 'paramjit',
    'beta': 'paramjit',
    'paramjit': 'paramjit',
    
    'manu': 'prangyasha',
    'priti': 'prangyasha',
    'bate': 'prangyasha',
    'prangyasha': 'prangyasha',
    
    'shikha': 'swarnaparav',
    'maa': 'swarnaparav',
    'swarna': 'swarnaparav',
    'swarnaparav': 'swarnaparav',
    
    'papa': 'jitendra',
    'jitendra': 'jitendra'
};

// ---------------------------------------------------------
// 1. WEBHOOK VERIFICATION (Meta uses this to verify your server)
// ---------------------------------------------------------

// Health Check Route for UptimeRobot
app.get('/', (req, res) => {
    res.status(200).send('Bot is awake and running!');
});

app.get('/webhook', (req, res) => {
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('✅ Webhook Verified by Meta!');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    }
});

// ---------------------------------------------------------
// Helper functions to send messages via Official API
// ---------------------------------------------------------
async function sendTextMessage(to, text) {
    try {
        await axios.post(`https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`, {
            messaging_product: 'whatsapp',
            to: to,
            text: { body: text }
        }, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
        });
    } catch (err) {
        console.error('Error sending text:', err.response ? err.response.data : err.message);
    }
}

async function sendListMessage(to, memberName, files) {
    let data;

    // If 3 or fewer files, we can show them as direct buttons in the chat!
    if (files.length <= 3) {
        let buttons = files.map((file) => {
            const parsedFile = path.parse(file);
            return {
                type: "reply",
                reply: {
                    id: parsedFile.name, // The unique ID
                    title: parsedFile.name.substring(0, 20) // Max 20 chars
                }
            };
        });

        data = {
            messaging_product: "whatsapp",
            to: to,
            type: "interactive",
            interactive: {
                type: "button",
                header: { type: "text", text: `${memberName.toUpperCase()}'s Documents` },
                body: { text: "Please tap a document below to view it:" },
                action: { buttons: buttons }
            }
        };
    } else {
        // If more than 3 files, WhatsApp forces us to use a List Menu
        let rows = files.map((file) => {
            const parsedFile = path.parse(file);
            return {
                id: parsedFile.name,
                title: parsedFile.name.substring(0, 24),
                description: `File Type: ${parsedFile.ext.toUpperCase().replace('.', '')}`.substring(0, 72)
            };
        });

        data = {
            messaging_product: "whatsapp",
            to: to,
            type: "interactive",
            interactive: {
                type: "list",
                header: { type: "text", text: `${memberName.toUpperCase()}'s Documents` },
                body: { text: "Please select a document from the menu to view it:" },
                footer: { text: "Family Bot" },
                action: {
                    button: "View Documents",
                    sections: [{ title: "Available Files", rows: rows }]
                }
            }
        };
    }

    try {
        await axios.post(`https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`, data, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
        });
    } catch (err) {
        console.error('Error sending interactive msg:', err.response ? err.response.data : err.message);
    }
}

async function sendDocument(to, filePath, fileName) {
    try {
        // Step A: Determine the correct file type
        const ext = path.extname(filePath).toLowerCase();
        let mime = 'application/octet-stream';
        if (ext === '.pdf') mime = 'application/pdf';
        else if (ext === '.jpg' || ext === '.jpeg') mime = 'image/jpeg';
        else if (ext === '.png') mime = 'image/png';

        // Step B: Upload file securely to Meta's servers
        const form = new FormData();
        form.append('file', fs.createReadStream(filePath));
        form.append('type', mime);
        form.append('messaging_product', 'whatsapp');

        const uploadRes = await axios.post(`https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/media`, form, {
            headers: { ...form.getHeaders(), Authorization: `Bearer ${WHATSAPP_TOKEN}` }
        });
        
        const mediaId = uploadRes.data.id;

        // Step C: Send the uploaded media to the user
        let msgType = mime.startsWith('image/') ? 'image' : 'document';
        const sendData = {
            messaging_product: 'whatsapp',
            to: to,
            type: msgType,
        };
        sendData[msgType] = { id: mediaId };
        if (msgType === 'document') sendData[msgType].filename = fileName;

        await axios.post(`https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`, sendData, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
        });

    } catch (err) {
        console.error('Error sending document:', err.response ? err.response.data : err.message);
        await sendTextMessage(to, "❌ Sorry, I had an issue sending that file. Please try again.");
    }
}

// ---------------------------------------------------------
// 2. RECEIVE MESSAGES FROM WHATSAPP
// ---------------------------------------------------------
app.post('/webhook', async (req, res) => {
    // Send 200 OK immediately so Meta knows we got the message
    res.sendStatus(200);

    const body = req.body;

    if (body.object && body.entry && body.entry[0].changes && body.entry[0].changes[0].value.messages) {
        const msg = body.entry[0].changes[0].value.messages[0];
        const senderPhone = msg.from; // User's phone number
        
        // Ensure documents folder exists
        const docsFolder = path.join(__dirname, 'documents');
        if (!fs.existsSync(docsFolder)) fs.mkdirSync(docsFolder);

        const familyMembers = fs.readdirSync(docsFolder, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name.toLowerCase());

        // --- User sent a normal TEXT message ---
        if (msg.type === 'text') {
            const rawText = msg.text.body.trim().toLowerCase();
            const text = nameAliases[rawText] || rawText;

            // Scenario A: Valid family member / nickname typed
            if (familyMembers.includes(text)) {
                const memberFolder = path.join(docsFolder, text);
                const files = fs.readdirSync(memberFolder).filter(file => {
                    return !file.startsWith('.') && fs.statSync(path.join(memberFolder, file)).isFile();
                });

                if (files.length === 0) {
                    return sendTextMessage(senderPhone, `The folder for *${text.toUpperCase()}* is currently empty.`);
                }

                // Remember their choice
                userState[senderPhone] = text;
                return sendListMessage(senderPhone, text, files);
                
            } else {
                // Scenario B: Invalid name typed
                if (familyMembers.length > 0) {
                    const availableList = familyMembers.map(m => `- ${m}`).join('\n');
                    sendTextMessage(senderPhone, `👋 Hello!\n\nI didn't recognize that name.\nAvailable main folders are:\n${availableList}\n\n(You can also use your nicknames!)\n\n👉 *Please type a name to view documents.*`);
                } else {
                    sendTextMessage(senderPhone, `👋 Welcome! The documents folder is currently empty.`);
                }
            }
        }

        // --- User clicked a button from the LIST menu or a DIRECT REPLY BUTTON ---
        if (msg.type === 'interactive') {
            let selectedDocId;
            if (msg.interactive.type === 'list_reply') {
                selectedDocId = msg.interactive.list_reply.id;
            } else if (msg.interactive.type === 'button_reply') {
                selectedDocId = msg.interactive.button_reply.id;
            } else {
                return; // Ignore other interactive types
            }
            const currentMember = userState[senderPhone];

            if (!currentMember) {
                return sendTextMessage(senderPhone, 'Session expired. Please type the family member name again.');
            }

            const memberFolder = path.join(docsFolder, currentMember);
            if (!fs.existsSync(memberFolder)) return;

            const files = fs.readdirSync(memberFolder);
            
            // Find the physical file that matches the ID (filename without extension)
            const matchedFile = files.find(f => path.parse(f).name === selectedDocId);

            if (matchedFile) {
                const filePath = path.join(memberFolder, matchedFile);
                await sendDocument(senderPhone, filePath, matchedFile);
            } else {
                sendTextMessage(senderPhone, '❌ Sorry, I could not find that document.');
            }
        }
    }
});

// Start the Cloud API Server
app.listen(PORT, () => {
    console.log(`🚀 Official Webhook Server is running on port ${PORT}`);
});
