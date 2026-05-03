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

// Store temporary user selections and states in memory
const userState = {};

// GitHub Configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

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
    
    'shikha': 'swarnaprava',
    'maa': 'swarnaprava',
    'swarna': 'swarnaprava',
    'swarnaprava': 'swarnaprava',
    
    'papa': 'jitendra',
    'jitendra': 'jitendra'
};

// ---------------------------------------------------------
// Helper functions to send messages via Official API
// ---------------------------------------------------------

async function uploadToGithub(repoPath, localFilePath, commitMessage) {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${repoPath}`;
    
    try {
        let sha;
        // Check if file exists to get SHA (for overwriting)
        try {
            const checkRes = await axios.get(url, {
                headers: { Authorization: `Bearer ${GITHUB_TOKEN}` }
            });
            sha = checkRes.data.sha;
        } catch (e) {
            // File doesn't exist, ignore
        }

        const content = fs.readFileSync(localFilePath).toString('base64');
        
        await axios.put(url, {
            message: commitMessage,
            content: content,
            sha: sha
        }, {
            headers: {
                Authorization: `Bearer ${GITHUB_TOKEN}`,
                Accept: 'application/vnd.github.v3+json'
            }
        });
        console.log(`✅ GitHub Sync Success: ${repoPath}`);
    } catch (err) {
        console.error('❌ GitHub Sync Error:', err.response ? JSON.stringify(err.response.data) : err.message);
    }
}

async function uploadTextToGithub(repoPath, textContent, commitMessage) {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${repoPath}`;
    
    try {
        const content = Buffer.from(textContent).toString('base64');
        await axios.put(url, {
            message: commitMessage,
            content: content
        }, {
            headers: {
                Authorization: `Bearer ${GITHUB_TOKEN}`,
                Accept: 'application/vnd.github.v3+json'
            }
        });
        console.log(`✅ GitHub Folder Created: ${repoPath}`);
    } catch (err) {
        console.error('❌ GitHub Folder Error:', err.response ? JSON.stringify(err.response.data) : err.message);
    }
}
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

async function sendMainMenu(to) {
    const data = {
        messaging_product: "whatsapp",
        to: to,
        type: "interactive",
        interactive: {
            type: "list",
            header: { type: "text", text: "Main Menu" },
            body: { text: "Welcome to the Family Doc Bot! 📁\n\nWhat would you like to do today?" },
            action: {
                button: "Select Action",
                sections: [
                    {
                        title: "Document Actions",
                        rows: [
                            { id: "menu_view", title: "📂 View Documents", description: "See and download files" },
                            { id: "menu_upload", title: "📤 Upload Document", description: "Upload new files to a folder" }
                        ]
                    },
                    {
                        title: "Member Management",
                        rows: [
                            { id: "menu_add_user", title: "👤 Add Member", description: "Create a new family folder" },
                            { id: "menu_delete_user", title: "🗑️ Delete Member", description: "Remove a member and their files" }
                        ]
                    }
                ]
            }
        }
    };

    try {
        await axios.post(`https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`, data, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
        });
    } catch (err) {
        console.error('Error sending main menu:', err.response ? err.response.data : err.message);
    }
}

async function sendMemberList(to, actionType) {
    const docsFolder = path.join(__dirname, 'documents');
    if (!fs.existsSync(docsFolder)) fs.mkdirSync(docsFolder);

    const familyMembers = fs.readdirSync(docsFolder, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

    if (familyMembers.length === 0) {
        return sendTextMessage(to, "The documents folder is currently empty.");
    }

    let rows = familyMembers.map((member) => {
        let desc = "";
        if (actionType === 'view') desc = "See files";
        if (actionType === 'upload') desc = "Upload here";
        if (actionType === 'delete') desc = "⚠️ DELETE THIS MEMBER";

        return {
            id: `${actionType}_${member}`,
            title: member.charAt(0).toUpperCase() + member.slice(1),
            description: desc
        };
    });

    const data = {
        messaging_product: "whatsapp",
        to: to,
        type: "interactive",
        interactive: {
            type: "list",
            header: { type: "text", text: actionType === 'delete' ? "⚠️ Delete Member" : "Select a Member" },
            body: { text: actionType === 'delete' ? "Select the member you want to PERMANENTLY remove:" : "Choose a family member:" },
            action: {
                button: "Choose Member",
                sections: [{ title: "Family Members", rows: rows }]
            }
        }
    };

    try {
        await axios.post(`https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`, data, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
        });
    } catch (err) {
        console.error('Error sending member list:', err.response ? err.response.data : err.message);
    }
}

async function deleteFromGithub(repoPath, commitMessage) {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${repoPath}`;
    try {
        const res = await axios.get(url, {
            headers: { Authorization: `token ${GITHUB_TOKEN}` }
        });
        
        // If it's a file, delete it
        if (!Array.isArray(res.data)) {
            await axios.delete(url, {
                headers: { Authorization: `token ${GITHUB_TOKEN}` },
                data: { message: commitMessage, sha: res.data.sha }
            });
        } else {
            // If it's a folder, delete everything inside recursively
            for (const item of res.data) {
                await deleteFromGithub(item.path, commitMessage);
            }
        }
    } catch (err) {
        // Ignore errors (file might not exist)
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
                    id: `file_${parsedFile.name}`, // Prefixing to distinguish from menu buttons
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
                id: `file_${parsedFile.name}`,
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
        else if (ext === '.docx') mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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

async function downloadMedia(mediaId, savePath) {
    try {
        // 1. Get the download URL
        const res = await axios.get(`https://graph.facebook.com/v17.0/${mediaId}`, {
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
        });
        const url = res.data.url;

        // 2. Download the file
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
        });

        // 3. Save to disk
        const writer = fs.createWriteStream(savePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    } catch (err) {
        console.error('Error downloading media:', err.response ? err.response.data : err.message);
        throw err;
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
        const senderPhone = msg.from;
        
        // Ensure documents folder exists
        const docsFolder = path.join(__dirname, 'documents');
        if (!fs.existsSync(docsFolder)) fs.mkdirSync(docsFolder);

        // --- Handle Media Messages (Upload Flow) ---
        if (msg.type === 'document' || msg.type === 'image') {
            const state = userState[senderPhone];
            if (state && state.action === 'awaiting_upload' && state.member) {
                const mediaId = msg.type === 'document' ? msg.document.id : msg.image.id;
                const fileName = msg.type === 'document' ? msg.document.filename : `image_${Date.now()}.jpg`;
                const memberFolder = path.join(docsFolder, state.member);
                const savePath = path.join(memberFolder, fileName);

                try {
                    await sendTextMessage(senderPhone, `⏳ Uploading *${fileName}* to *${state.member.toUpperCase()}*...`);
                    await downloadMedia(mediaId, savePath);
                    
                    // --- SYNC TO GITHUB ---
                    const githubPath = `documents/${state.member}/${fileName}`;
                    await uploadToGithub(githubPath, savePath, `Add document ${fileName} for ${state.member}`);
                    
                    await sendTextMessage(senderPhone, `✅ Successfully uploaded to *${state.member.toUpperCase()}* and synced to GitHub!`);
                    delete userState[senderPhone]; // Reset state
                    return sendMainMenu(senderPhone);
                } catch (err) {
                    return sendTextMessage(senderPhone, "❌ Failed to upload document. Please try again.");
                }
            } else {
                return sendTextMessage(senderPhone, "Please select 'Upload Document' from the menu before sending a file.");
            }
        }

        // --- Handle Text Messages ---
        if (msg.type === 'text') {
            const rawText = msg.text.body.trim().toLowerCase();
            const state = userState[senderPhone];

            // If we are waiting for a new member name
            if (state && state.action === 'awaiting_member_name') {
                const newMember = rawText.replace(/[^a-z0-9]/g, ''); // Clean name
                if (!newMember) return sendTextMessage(senderPhone, "Invalid name. Please use only letters and numbers.");

                const newPath = path.join(docsFolder, newMember);
                if (fs.existsSync(newPath)) {
                    return sendTextMessage(senderPhone, `The member *${newMember}* already exists! Try a different name.`);
                }

                fs.mkdirSync(newPath);

                // --- SYNC TO GITHUB (Create folder via .gitkeep) ---
                const githubPath = `documents/${newMember}/.gitkeep`;
                await uploadTextToGithub(githubPath, "placeholder", `Add member folder for ${newMember}`);

                await sendTextMessage(senderPhone, `✅ Success! Member *${newMember.toUpperCase()}* has been added.\n\nYou can now upload documents for them.`);
                delete userState[senderPhone];
                return sendMainMenu(senderPhone);
            }

            // Normal text message (usually "hi" or a name)
            const text = nameAliases[rawText] || rawText;
            const familyMembers = fs.readdirSync(docsFolder, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name.toLowerCase());

            if (familyMembers.includes(text)) {
                // Legacy support: if they just type a name, show documents
                const memberFolder = path.join(docsFolder, text);
                const files = fs.readdirSync(memberFolder).filter(file => {
                    return !file.startsWith('.') && fs.statSync(path.join(memberFolder, file)).isFile();
                });
                userState[senderPhone] = { action: 'viewing', member: text };
                return sendListMessage(senderPhone, text, files);
            } else {
                // Send Main Menu for any other text
                return sendMainMenu(senderPhone);
            }
        }

        // --- Handle Interactive Messages (Buttons/Lists) ---
        if (msg.type === 'interactive') {
            const reply = msg.interactive.type === 'list_reply' ? msg.interactive.list_reply : msg.interactive.button_reply;
            const id = reply.id;

            // 1. Main Menu Selections
            if (id === 'menu_view') {
                return sendMemberList(senderPhone, 'view');
            }
            if (id === 'menu_add_user') {
                userState[senderPhone] = { action: 'awaiting_member_name' };
                return sendTextMessage(senderPhone, "👤 *Add New Member*\n\nPlease type the name of the new family member (e.g., 'Swaraj'):");
            }
            if (id === 'menu_upload') {
                return sendMemberList(senderPhone, 'upload');
            }
            if (id === 'menu_delete_user') {
                return sendMemberList(senderPhone, 'delete');
            }

            // 2. Member List Selections (for viewing)
            if (id.startsWith('view_')) {
                const member = id.replace('view_', '');
                const memberFolder = path.join(docsFolder, member);
                const files = fs.readdirSync(memberFolder).filter(file => {
                    return !file.startsWith('.') && fs.statSync(path.join(memberFolder, file)).isFile();
                });

                if (files.length === 0) {
                    await sendTextMessage(senderPhone, `The folder for *${member.toUpperCase()}* is currently empty.`);
                    return sendMainMenu(senderPhone);
                }

                userState[senderPhone] = { action: 'viewing', member: member };
                return sendListMessage(senderPhone, member, files);
            }

            // 3. Member List Selections (for uploading)
            if (id.startsWith('upload_')) {
                const member = id.replace('upload_', '');
                userState[senderPhone] = { action: 'awaiting_upload', member: member };
                return sendTextMessage(senderPhone, `📤 *Upload to ${member.toUpperCase()}*\n\nPlease send the document or image now. You can send PDFs, Images, or DOCX files.`);
            }

            // 4. Member List Selections (for deleting)
            if (id.startsWith('delete_')) {
                const member = id.replace('delete_', '');
                const memberFolder = path.join(docsFolder, member);

                try {
                    await sendTextMessage(senderPhone, `🗑️ Deleting *${member.toUpperCase()}* and all their files...`);
                    
                    // Delete locally
                    if (fs.existsSync(memberFolder)) {
                        fs.rmSync(memberFolder, { recursive: true, force: true });
                    }

                    // Delete from GitHub
                    const githubPath = `documents/${member}`;
                    await deleteFromGithub(githubPath, `Delete member ${member} and files`);

                    await sendTextMessage(senderPhone, `✅ Successfully deleted *${member.toUpperCase()}* from server and GitHub.`);
                    return sendMainMenu(senderPhone);
                } catch (err) {
                    console.error('Error during deletion:', err);
                    return sendTextMessage(senderPhone, "❌ Sorry, there was an error deleting that member.");
                }
            }

            // 5. File Selection (Legacy and New)
            if (id.startsWith('file_')) {
                const selectedDocId = id.replace('file_', '');
                const state = userState[senderPhone];
                const currentMember = state ? state.member : null;

                if (!currentMember) {
                    return sendTextMessage(senderPhone, 'Session expired. Please select a member again.');
                }

                const memberFolder = path.join(docsFolder, currentMember);
                const files = fs.readdirSync(memberFolder);
                const matchedFile = files.find(f => path.parse(f).name === selectedDocId);

                if (matchedFile) {
                    const filePath = path.join(memberFolder, matchedFile);
                    await sendDocument(senderPhone, filePath, matchedFile);
                } else {
                    sendTextMessage(senderPhone, '❌ Sorry, I could not find that document.');
                }
            }
        }
    }
});

// Start the Cloud API Server
app.listen(PORT, () => {
    console.log(`🚀 Official Webhook Server is running on port ${PORT}`);
});
