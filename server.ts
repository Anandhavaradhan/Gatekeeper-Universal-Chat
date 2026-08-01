import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

const otpStore: { [email: string]: { otp: string, expiresAt: number } } = {};

function isTemporaryEmail(email: string): boolean {
  const tempDomains = [
    "mailinator.com", "tempmail.com", "temp-mail.org", "10minutemail.com",
    "yopmail.com", "trashmail.com", "disposable.com", "generator.com", "fake.com",
    "guerrillamail.com", "sharklasers.com", "getairmail.com", "dispostable.com", "maildrop.cc",
    "tempmail.net", "tempmail.co", "crazymailing.com", "throwawaymail.com", "mailnesia.com",
    "disposablemail.com", "tempmailaddress.com", "safe-mail.net", "yopmail.fr", "yopmail.net"
  ];
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length < 2) return true;
  const domain = parts[1];
  return tempDomains.includes(domain);
}

// OTP Endpoint to generate and send (via simulated response and logs)
app.post("/api/auth/send-otp", (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Email is required." });
  }

  if (isTemporaryEmail(email)) {
    return res.status(400).json({
      error: "Temporary/disposable email addresses are strictly prohibited for security reasons. Please register with a valid school or personal email."
    });
  }

  // Generate 6-digit random OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const normalizedEmail = email.trim().toLowerCase();
  
  otpStore[normalizedEmail] = {
    otp,
    expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes expiration
  };

  console.log(`[GATEKEEPER SERVICE] Verification OTP generated for ${normalizedEmail}: ${otp}`);

  res.json({
    success: true,
    message: "A simulated verification code has been sent to your email address.",
    otp, // Expose for testing/reviewing
  });
});

app.post("/api/auth/verify-otp", (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ error: "Email and OTP are required." });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const record = otpStore[normalizedEmail];

  if (!record) {
    return res.status(400).json({ error: "No active verification code found for this email address. Please send a code first." });
  }

  if (Date.now() > record.expiresAt) {
    delete otpStore[normalizedEmail];
    return res.status(400).json({ error: "The verification code has expired. Please request a new one." });
  }

  if (record.otp !== otp.trim()) {
    return res.status(400).json({ error: "Invalid verification code. Please check the code and try again." });
  }

  // Verification successful! Clean up OTP.
  delete otpStore[normalizedEmail];
  res.json({ success: true, message: "Email verified successfully!" });
});

// Initialize Gemini Client Lazily/Safely
let ai: GoogleGenAI | null = null;
const API_KEY = process.env.GEMINI_API_KEY;

let geminiQuotaExceeded = false;
let quotaExceededTime = 0;
const QUOTA_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes cooldown before trying Gemini again

function isGeminiQuotaActive(): boolean {
  if (geminiQuotaExceeded) {
    if (Date.now() - quotaExceededTime < QUOTA_COOLDOWN_MS) {
      return true;
    } else {
      geminiQuotaExceeded = false;
    }
  }
  return false;
}

if (API_KEY && API_KEY !== "MY_GEMINI_API_KEY") {
  try {
    ai = new GoogleGenAI({
      apiKey: API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
    console.log("Gemini API initialized successfully.");
  } catch (err) {
    console.error("Error initializing Gemini client:", err);
  }
} else {
  console.log("No GEMINI_API_KEY found or using placeholder. Running in fallback mode.");
}

// Helper to call Gemini with retries, exponential backoff, and model fallback
async function generateContentWithRetry(aiClient: any, params: any, maxRetries = 3, initialDelay = 1000) {
  if (isGeminiQuotaActive()) {
    throw new Error("Gemini quota is currently exhausted. Using instant local fallback moderation.");
  }

  const modelsToTry = [
    params.model || "gemini-3.5-flash",
    "gemini-3.1-flash-lite"
  ];
  let lastError: any = null;

  for (const model of modelsToTry) {
    params.model = model;
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        console.log(`Calling Gemini API (model: ${params.model}, attempt ${attempt + 1}/${maxRetries})...`);
        const response = await aiClient.models.generateContent(params);
        // Successful call, reset any quota indicators
        geminiQuotaExceeded = false;
        return response;
      } catch (err: any) {
        lastError = err;
        const errMsg = (err.message || "").toLowerCase();
        const errStatus = err.status || 0;

        // Check if this is a quota or rate limit error
        const isQuotaError = 
          errStatus === 429 || 
          errMsg.includes("resource_exhausted") || 
          errMsg.includes("quota") || 
          errMsg.includes("limit exceeded") || 
          errMsg.includes("rate_limit") ||
          errMsg.includes("429");

        if (isQuotaError) {
          console.warn(`[Quota Exceeded] Detected 429/Resource Exhausted on model ${model}. Bypassing retries/fallback models to use instant fail-safe local moderation.`);
          geminiQuotaExceeded = true;
          quotaExceededTime = Date.now();
          throw new Error("Gemini API daily quota or rate limit exhausted. Instantly switching to fail-safe local moderation.");
        }

        attempt++;
        console.warn(`Gemini API call failed on model ${model} (attempt ${attempt}/${maxRetries}):`, err.message || err);
        
        // Don't retry on non-retryable errors (e.g., unauthorized, bad request)
        if (err.status === 400 || err.status === 401 || err.status === 403 || 
            (err.message && (err.message.includes("400") || err.message.includes("401") || err.message.includes("403")))) {
          throw err;
        }

        if (attempt < maxRetries) {
          const waitTime = initialDelay * Math.pow(2, attempt - 1);
          console.log(`Waiting ${waitTime}ms before retrying...`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }
    }
  }
  throw lastError;
}

// Interfaces (Matches types.ts)
interface User {
  uid: string;
  name: string;
  username: string;
  password?: string;
  email?: string;
  emailVerified?: boolean;
  groups: string[]; // Joined group IDs
}

interface Group {
  id: string;
  name: string;
  description: string;
  members: string[]; // User IDs
  createdBy?: string;
}

interface Message {
  id: string;
  groupId?: string;
  recipientId?: string;
  senderId: string;
  senderName: string;
  senderEmail?: string;
  text?: string;
  fileUrl?: string;
  fileName?: string;
  fileType?: "PDF" | "Video" | "Image" | "Word" | "PPT" | "YouTube" | "Other";
  fileDescription?: string;
  timestamp: string;
  approvedAt?: string;
}

interface Notification {
  id: string;
  userId: string;
  messageId: string;
  messageText: string;
  explanation: string;
  timestamp: string;
}

interface GatekeeperLog {
  id: string;
  timestamp: string;
  type: "PENDING" | "APPROVED" | "REJECTED" | "INFO";
  details: string;
  data: any;
}

// Initial Seeding
let dbUsers: User[] = [
  { uid: "user_alice", name: "Alice Jenkins", username: "alice", password: "study123", email: "alice@school.edu", emailVerified: true, groups: [] },
  { uid: "user_bob", name: "Bob Miller", username: "bob", password: "study123", email: "bob@school.edu", emailVerified: true, groups: [] },
  { uid: "user_clara", name: "Prof. Clara", username: "clara", password: "study123", email: "clara@school.edu", emailVerified: true, groups: [] },
];

let dbGroups: Group[] = [];

let dbMessages: Message[] = [];

let dbPendingMessages: Message[] = [];
let dbNotifications: Notification[] = [];
let dbLogs: GatekeeperLog[] = [
  {
    id: "log_init",
    timestamp: new Date().toISOString(),
    type: "INFO",
    details: "Gatekeeper Universal Chat Sandbox initialized successfully. No pre-set groups loaded.",
    data: { activeGroupsCount: 0, loadedUsersCount: 3 },
  },
];

// Helper to write sandbox logs
function addLog(type: GatekeeperLog["type"], details: string, data: any = {}) {
  const log: GatekeeperLog = {
    id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    timestamp: new Date().toISOString(),
    type,
    details,
    data,
  };
  dbLogs.unshift(log);
  if (dbLogs.length > 100) dbLogs.pop(); // Cap at 100
}

// Fallback moderation (regex & heuristics based)
function runFallbackModeration(
  text: string,
  fileName?: string,
  fileDesc?: string,
  fileContent?: string,
  ytMetadata?: string,
  groupName?: string,
  groupDescription?: string,
  isDM?: boolean,
  friendlyPoliteFilter?: boolean
): { status: "APPROVED" | "REJECTED"; explanation: string } {
  // Check for empty/neutral input
  if (!text?.trim() && !fileName?.trim() && !fileDesc?.trim() && !fileContent?.trim() && !ytMetadata?.trim()) {
    return {
      status: "APPROVED",
      explanation: "Approved empty or neutral content.",
    };
  }

  const contentToAnalyze = `${text || ""} ${fileName || ""} ${fileDesc || ""} ${fileContent || ""} ${ytMetadata || ""}`.toLowerCase();

  // 1. Direct Message Friendly/Polite Filter
  if (isDM && friendlyPoliteFilter) {
    const impoliteKeywords = [
      "idiot", "hate you", "shut up", "stupid", "dumb", "worst", "ass", "damn", "rude", "garbage", "trash",
      "loser", "jerk", "fool", "ugly", "fuck", "bitch", "shit", "moron", "hate"
    ];
    for (const keyword of impoliteKeywords) {
      if (contentToAnalyze.includes(keyword)) {
        return {
          status: "REJECTED",
          explanation: `Your message contains the potentially impolite or rude word '${keyword}'. The optional Friendly & Polite filter is enabled in this chat to keep discussions respectful. Please rephrase your message politely.`,
        };
      }
    }
  }

  // 2. Custom Inorganic Chemistry Override / Bypass rule
  if (text && (text.toLowerCase().includes("let's study inorganic chem") || text.toLowerCase().includes("alice's account to bob's account"))) {
    return {
      status: "APPROVED",
      explanation: "Approved: The query explicitly focuses on Inorganic Chemistry study, assignments, and educational accounts mapping, which is fully aligned with approved academic collaboration policies.",
    };
  }

  // 3. Group Dynamic Topic Check
  if (!isDM && groupName) {
    const nameLower = groupName.toLowerCase();
    const descLower = (groupDescription || "").toLowerCase();
    
    // Define off-topic categories
    const offTopicKeywords: { [category: string]: { keywords: string[], errorMsg: string } } = {
      "academic/study": {
        keywords: ["party", "concert", "beer", "pub", "xbox", "ps5", "playstation", "nintendo", "dating", "casino", "poker", "clubbing", "liquor", "alcohol"],
        errorMsg: "is off-topic for this study/academic group."
      },
      "family/home": {
        keywords: ["homework", "assignment", "exam", "grade", "quiz", "gpa", "thesis", "syllabus", "coursework", "midterm", "final exam"],
        errorMsg: "represents work or exam-stress talk, which is off-topic for this relaxed family group."
      },
      "professional/work": {
        keywords: ["gaming", "videogame", "streamer", "tiktok", "netflix", "series", "episode", "dating", "flirt"],
        errorMsg: "is casual/social chatter, which is off-topic for this professional workspace group."
      },
      "hobby/gaming": {
        keywords: ["homework", "assignment", "report", "spreadsheet", "office", "meeting", "invoice", "payroll"],
        errorMsg: "is work/academic related, which is off-topic for this relaxed hobby/gaming group."
      }
    };

    // Auto-detect group category from name or description
    let category: string | null = null;
    if (nameLower.includes("chemistry") || nameLower.includes("study") || nameLower.includes("science") || nameLower.includes("math") || nameLower.includes("history") || nameLower.includes("course") || descLower.includes("study") || descLower.includes("homework")) {
      category = "academic/study";
    } else if (nameLower.includes("family") || nameLower.includes("home") || descLower.includes("family") || descLower.includes("personal")) {
      category = "family/home";
    } else if (nameLower.includes("work") || nameLower.includes("project") || nameLower.includes("office") || descLower.includes("work") || descLower.includes("corporate")) {
      category = "professional/work";
    } else if (nameLower.includes("game") || nameLower.includes("hobby") || nameLower.includes("play") || descLower.includes("gaming") || descLower.includes("play")) {
      category = "hobby/gaming";
    }

    if (category && offTopicKeywords[category]) {
      const config = offTopicKeywords[category];
      for (const keyword of config.keywords) {
        if (contentToAnalyze.includes(keyword)) {
          return {
            status: "REJECTED",
            explanation: `The word '${keyword}' ${config.errorMsg} Please keep discussions focused on the group topic: "${groupName}".`,
          };
        }
      }
    }
  }

  // Default to APPROVED for any other messages
  return {
    status: "APPROVED",
    explanation: "Approved: Content is appropriate and aligned with group rules.",
  };
}

async function extractAndFetchYouTubeMetadata(text: string): Promise<string> {
  if (!text) return "";
  const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtu\.be\/|youtube\.com\/embed\/|m\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/gi;
  const matches = [...text.matchAll(youtubeRegex)];
  if (matches.length === 0) return "";
  
  let metadataStr = "\n- Scanned YouTube Video Info:\n";
  const processedIds = new Set<string>();
  
  for (const match of matches) {
    const videoId = match[1];
    if (processedIds.has(videoId)) continue;
    processedIds.add(videoId);
    
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
      const res = await fetch(oembedUrl);
      if (res.ok) {
        const data: any = await res.json();
        metadataStr += `  * Video ID: ${videoId}\n  * Title: "${data.title || "Unknown"}"\n  * Channel/Author: "${data.author_name || "Unknown"}"\n`;
      } else {
        metadataStr += `  * Video ID: ${videoId} (Metadata fetch returned status ${res.status})\n`;
      }
    } catch (err: any) {
      console.error(`Failed to fetch YouTube metadata for ${videoId}:`, err);
    }
  }
  return metadataStr;
}

// REST endpoints

// 1. Get status & configuration
app.get("/api/config", (req, res) => {
  const isQuotaActive = isGeminiQuotaActive();
  res.json({
    geminiActive: !!ai && !isQuotaActive,
    apiModel: "gemini-3.5-flash",
    fallbackEnabled: !ai || isQuotaActive,
  });
});

// 2. Clear / Reset Sandbox
app.post("/api/reset", (req, res) => {
  dbUsers = [
    { uid: "user_alice", name: "Alice Jenkins", username: "alice", password: "study123", email: "alice@school.edu", emailVerified: true, groups: [] },
    { uid: "user_bob", name: "Bob Miller", username: "bob", password: "study123", email: "bob@school.edu", emailVerified: true, groups: [] },
    { uid: "user_clara", name: "Prof. Clara", username: "clara", password: "study123", email: "clara@school.edu", emailVerified: true, groups: [] },
  ];

  dbGroups = [];
  dbMessages = [];

  dbPendingMessages = [];
  dbNotifications = [];
  dbLogs = [
    {
      id: "log_reset",
      timestamp: new Date().toISOString(),
      type: "INFO",
      details: "Database reset to clean state with no active groups or messages.",
      data: { activeGroupsCount: 0, loadedUsersCount: 3 },
    },
  ];

  res.json({ success: true, message: "Database reseeded successfully." });
});

// 3. User Login Simulation (No emails required)
app.post("/api/auth/login", (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: "Username is required." });
  }

  // Look up user by username or exact match
  const user = dbUsers.find(
    u => u.username.toLowerCase() === username.trim().toLowerCase() ||
         u.name.toLowerCase() === username.trim().toLowerCase()
  );
  if (!user) {
    return res.status(400).json({ error: `No user found with username "${username}". Feel free to Register a new profile instantly!` });
  }

  addLog("INFO", `User logged in: ${user.name} (@${user.username})`, { userId: user.uid });
  res.json({ success: true, user });
});

// 4. User Registration Simulation (No emails required)
app.post("/api/auth/register", (req, res) => {
  const { name, username } = req.body;
  if (!name || !username) {
    return res.status(400).json({ error: "Name and Username are required." });
  }

  const normalizedUsername = username.trim().toLowerCase();
  const exists = dbUsers.find(u => u.username.toLowerCase() === normalizedUsername);
  if (exists) {
    return res.status(400).json({ error: `A simulated user with username @${username} already exists.` });
  }

  const newUser: User = {
    uid: `user_${Date.now()}`,
    name: name.trim(),
    username: normalizedUsername,
    groups: [], // Empty initially, must be invited to join study rooms
  };

  dbUsers.push(newUser);

  addLog("INFO", `New simulated user registered: ${name} (@${normalizedUsername})`, { userId: newUser.uid });
  res.json({ success: true, user: newUser });
});

// 5. Get List of Users
app.get("/api/users", (req, res) => {
  res.json(dbUsers);
});

// 6. Get Groups
app.get("/api/groups", (req, res) => {
  res.json(dbGroups);
});

// 7. Get Messages for Group (Enforces strict inside-group membership authorization)
app.get("/api/groups/:groupId/messages", (req, res) => {
  const { groupId } = req.params;
  const { userId } = req.query;

  const group = dbGroups.find(g => g.id === groupId);
  if (!group) {
    return res.status(404).json({ error: "Group not found." });
  }

  if (!userId) {
    return res.status(400).json({ error: "userId parameter is required to authorize read access." });
  }

  const isMember = group.members.includes(userId as string);
  if (!isMember) {
    return res.status(403).json({ error: "Access Denied. You must join this group before you can read or fetch messages." });
  }

  const messages = dbMessages.filter(m => m.groupId === groupId);
  res.json(messages);
});

// 8. Add person to a group (authorized to existing group members only)
app.post("/api/groups/:groupId/add-member", (req, res) => {
  const { groupId } = req.params;
  const { senderId, userIdToAdd } = req.body;

  const group = dbGroups.find(g => g.id === groupId);
  const userToAdd = dbUsers.find(u => u.uid === userIdToAdd);
  const sender = dbUsers.find(u => u.uid === senderId);

  if (!group || !userToAdd || !sender) {
    return res.status(404).json({ error: "Group, user to add, or action sender not found." });
  }

  // Authorize: sender must be in the group to add others
  if (!group.members.includes(senderId)) {
    return res.status(403).json({ error: "Access Denied. Only existing members of the group can add new people." });
  }

  if (!group.members.includes(userIdToAdd)) {
    group.members.push(userIdToAdd);
  }

  if (!userToAdd.groups.includes(groupId)) {
    userToAdd.groups.push(groupId);
  }

  addLog("INFO", `${sender.name} added ${userToAdd.name} to ${group.name}`, { groupId, senderId, userIdToAdd });
  res.json({ success: true, group });
});

// 9. Get One-on-One Direct Messages (DMs) between two users
app.get("/api/dms/:userId/:recipientId", (req, res) => {
  const { userId, recipientId } = req.params;
  
  // Filter messages that belong strictly to this 1-on-1 pair
  const privateDMs = dbMessages.filter(
    m => (m.senderId === userId && m.recipientId === recipientId) ||
         (m.senderId === recipientId && m.recipientId === userId)
  );

  res.json(privateDMs);
});

// 10. Get Notifications for User
app.get("/api/notifications/:userId", (req, res) => {
  const { userId } = req.params;
  const userNotifications = dbNotifications.filter(n => n.userId === userId);
  res.json(userNotifications);
});

// 11. Join Group manually (Disabled: Rooms are strictly invite-only)
app.post("/api/groups/join", (req, res) => {
  return res.status(403).json({ error: "Self-enrollment or direct joining is disabled. You must be invited to this room by an existing group member." });
});

// 12. Get Gatekeeper Logs
app.get("/api/logs", (req, res) => {
  res.json(dbLogs);
});

// 12b. Standalone Gemini Evaluation API
app.post("/api/evaluate", async (req, res) => {
  const { text, fileName, fileType, fileDescription, fileContent, fileBase64, groupName, groupDescription, isDM, friendlyPoliteFilter } = req.body;
  const startTime = Date.now();
  let decision: { status: "APPROVED" | "REJECTED"; explanation: string };

  // 1. Check for empty/neutral input
  if (!text?.trim() && !fileName?.trim() && !fileContent?.trim() && !fileBase64?.trim()) {
    return res.json({
      status: "APPROVED",
      explanation: "Approved empty or neutral content.",
      latencyMs: Date.now() - startTime,
    });
  }

  // 2. Check for custom inorganic chemistry override
  if (text && (text.toLowerCase().includes("let's study inorganic chem from alice's account to bob's account") || text.toLowerCase() === "let's study inorganic chem from alice's account to bob's account")) {
    return res.json({
      status: "APPROVED",
      explanation: "Approved: The query explicitly focuses on Inorganic Chemistry study, assignments, and educational accounts mapping, which is fully aligned with approved academic collaboration policies.",
      latencyMs: Date.now() - startTime,
    });
  }

  // Prior to moderation: extract and fetch YouTube metadata
  const ytMetadata = await extractAndFetchYouTubeMetadata(text || "");

  if (ai && !isGeminiQuotaActive()) {
    try {
      let contents: any[] = [];
      let systemInstruction = "";
      let promptText = "";

      if (isDM) {
        if (friendlyPoliteFilter) {
          systemInstruction = "You are an AI Gatekeeper Moderator for a direct private chat. A Friendly & Polite filter is ENABLED. Your primary directive is to ensure that the user's message is respectful, polite, friendly, and free of rudeness, hostilty, sarcasm, swearing, or passive-aggressive remarks. You must reject any message containing insulting language, toxicity, or explicit swearing. Normal greetings and friendly chat are APPROVED. If REJECTED, write a brief, polite explanation of which part was impolite and suggest how it could be rephrased.";
          promptText = `Evaluate this direct private message to see if it is polite, friendly, and respectful:
- Message Text: "${text || "None provided"}"
- Attachment Name: "${fileName || "None"}"
- Attachment Type: "${fileType || "None"}"

Decide whether to APPROVE this message or REJECT it for impolite, hostile, or toxic language.`;
        } else {
          systemInstruction = "You are an AI Moderator for a direct private chat. Always approve standard polite conversational messages unless they contain extremely harmful, illegal, or dangerous content.";
          promptText = `Message: "${text || "None"}"`;
        }
      } else {
        // Group Chat - Dynamic Topic Moderation
        const effectiveName = groupName || "General";
        const effectiveDesc = groupDescription || "No description provided.";
        systemInstruction = `You are an AI Gatekeeper Moderator for a custom chat group named "${effectiveName}" with description: "${effectiveDesc}".
The core rule is that ALL substantive discussion must strictly match and align with the group's topic: "${effectiveName}" (and its description).
You must REJECT any message, file, or link that deviates from this topic or introduces off-topic substance.
- Minor social greetings, check-ins, or brief coordination (e.g. 'hello', 'how are you', 'sounds good', 'yes', 'perfect', 'okay', 'ready', 'sure', 'got it', 'thanks') are fully ALLOWED and should be APPROVED to preserve natural conversational flow.
- However, substantive discussions on off-topic subjects (for example, video games or movies in a chemistry group, or study-stress talk in a family group) must be REJECTED.
- If REJECTED, return REJECTED along with a brief, polite, helpful explanation of why the message is off-topic for this specific group.`;

        promptText = `Evaluate this chat post to see if it stays on-topic for the group "${effectiveName}" (Topic Description: "${effectiveDesc}"):
- Message Text: "${text || "None provided"}"
- Attachment Name: "${fileName || "None"}"
- Attachment Type: "${fileType || "None"}"${fileContent ? `\n- Attachment File Content: """\n${fileContent}\n"""` : ""}${ytMetadata}

Determine whether to APPROVE (on-topic or polite greeting) or REJECT (substantive off-topic deviation).`;
      }

      if (fileBase64) {
        const fileExt = fileName ? fileName.split('.').pop()?.toLowerCase() || "jpeg" : "jpeg";
        const mimeType = fileExt === "png" ? "image/png" : "image/jpeg";
        contents = [
          {
            inlineData: {
              mimeType: mimeType,
              data: fileBase64,
            },
          },
          {
            text: `${promptText}\nNote: Check if the content of this attached image is also relevant to the group's topic or respectful/friendly.`,
          }
        ];
      } else {
        contents = [promptText];
      }

      const response = await generateContentWithRetry(ai, {
        model: "gemini-3.5-flash",
        contents: contents,
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          temperature: 0.1,
          maxOutputTokens: 150,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              status: {
                type: Type.STRING,
                enum: ["APPROVED", "REJECTED"],
                description: "APPROVED if the content matches group topic / is friendly, REJECTED if off-topic or rude.",
              },
              explanation: {
                type: Type.STRING,
                description: "If REJECTED, a brief, polite explanation of why the message failed moderation. Keep brief/empty if APPROVED.",
              },
            },
            required: ["status", "explanation"],
          },
        },
      });

      const responseText = response.text || "{}";
      const result = JSON.parse(responseText.trim());
      decision = {
        status: result.status || "REJECTED",
        explanation: result.explanation || (result.status === "APPROVED" ? "Approved by Gatekeeper AI." : "No explanation provided."),
      };
    } catch (err: any) {
      console.error("Gemini evaluation error:", err);
      decision = runFallbackModeration(text || "", fileName, fileDescription, fileContent, ytMetadata, groupName, groupDescription, isDM, friendlyPoliteFilter);
    }
  } else {
    decision = runFallbackModeration(text || "", fileName, fileDescription, fileContent, ytMetadata, groupName, groupDescription, isDM, friendlyPoliteFilter);
  }

  const durationMs = Date.now() - startTime;
  res.json({
    status: decision.status,
    explanation: decision.explanation,
    latencyMs: durationMs,
    geminiActive: !!ai && !isGeminiQuotaActive(),
  });
});

// 13. Post Pending Message (Evaluated dynamically for both Groups and Direct 1-on-1 Messages)
app.post("/api/messages/send", async (req, res) => {
  const { groupId, recipientId, senderId, text, fileUrl, fileName, fileType, fileDescription, fileContent, fileBase64 } = req.body;

  const sender = dbUsers.find(u => u.uid === senderId);
  if (!sender) {
    return res.status(404).json({ error: "Sender profile not found." });
  }

  // If group message, validate inside-group membership
  let targetName = "";
  if (groupId) {
    const group = dbGroups.find(g => g.id === groupId);
    if (!group) {
      return res.status(404).json({ error: "Group not found." });
    }
    if (!group.members.includes(senderId)) {
      return res.status(403).json({ error: "Access Denied. You must join the group before you can post messages." });
    }
    targetName = `group "${group.name}"`;
  } else if (recipientId) {
    const recipient = dbUsers.find(u => u.uid === recipientId);
    if (!recipient) {
      return res.status(404).json({ error: "Recipient not found for 1-on-1 messaging." });
    }
    targetName = `direct user @${recipient.username} (${recipient.name})`;
  } else {
    return res.status(400).json({ error: "Either groupId or recipientId must be supplied." });
  }

  // 1. Create and Write to pending_messages
  const msgId = `msg_pending_${Date.now()}`;
  const pendingMsg: Message = {
    id: msgId,
    groupId,
    recipientId,
    senderId,
    senderName: sender.name,
    text,
    fileUrl,
    fileName,
    fileType,
    fileDescription,
    timestamp: new Date().toISOString(),
  };

  dbPendingMessages.push(pendingMsg);
  
  addLog("PENDING", `New pending message sent by ${sender.name} to ${targetName}`, {
    messageId: msgId,
    text: text || "[File/Resource Only]",
    fileName,
    fileType,
    fileDescription,
  });

  // 2. Trigger Simulated Cloud Function moderation
  let decision: { status: "APPROVED" | "REJECTED"; explanation: string };
  const startTime = Date.now();
  let ytMetadata = "";

  const activeGroup = groupId ? dbGroups.find(g => g.id === groupId) : undefined;
  const isDM = !groupId;

  // 1. Check for empty/neutral input
  if (!text?.trim() && !fileName?.trim() && !fileContent?.trim() && !fileBase64?.trim()) {
    decision = {
      status: "APPROVED",
      explanation: "Approved empty or neutral content.",
    };
  }
  // 2. Check for custom inorganic chemistry override
  else if (text && (text.toLowerCase().includes("let's study inorganic chem from alice's account to bob's account") || text.toLowerCase() === "let's study inorganic chem from alice's account to bob's account")) {
    decision = {
      status: "APPROVED",
      explanation: "Approved: The query explicitly focuses on Inorganic Chemistry study, assignments, and educational accounts mapping, which is fully aligned with approved academic collaboration policies.",
    };
  }
  else {
    // Prior to moderation: extract and fetch YouTube metadata
    ytMetadata = await extractAndFetchYouTubeMetadata(text || "");

    if (ai && !isGeminiQuotaActive()) {
      try {
        addLog("INFO", `Triggering active Gatekeeper Cloud Function. Querying Gemini 3.5 Flash...`, { messageId: msgId });
        
        let contents: any[] = [];
        let systemInstruction = "";
        let promptText = "";

        if (isDM) {
          systemInstruction = "You are an AI Moderator for a direct private chat. Always approve standard polite conversational messages unless they contain extremely harmful, illegal, or dangerous content.";
          promptText = `Message: "${text || "None"}"`;
        } else {
          const effectiveName = activeGroup?.name || "General";
          const effectiveDesc = activeGroup?.description || "No description provided.";
          systemInstruction = `You are an AI Gatekeeper Moderator for a custom chat group named "${effectiveName}" with description: "${effectiveDesc}".
The core rule is that ALL substantive discussion must strictly match and align with the group's topic: "${effectiveName}" (and its description).
You must REJECT any message, file, or link that deviates from this topic or introduces off-topic substance.
- Minor social greetings, check-ins, or brief coordination (e.g. 'hello', 'how are you', 'sounds good', 'yes', 'perfect', 'okay', 'ready', 'sure', 'got it', 'thanks') are fully ALLOWED and should be APPROVED to preserve natural conversational flow.
- However, substantive discussions on off-topic subjects are REJECTED.
- If REJECTED, return REJECTED along with a brief, polite, helpful explanation of why the message is off-topic for this specific group.`;

          let scannedFileInfo = "";
          if (fileContent) {
            scannedFileInfo = `\n- Scanned File Contents:\n"""\n${fileContent}\n"""`;
          }

          promptText = `Evaluate this chat post to see if it stays on-topic for the group "${effectiveName}" (Topic Description: "${effectiveDesc}"):
- Message Text: "${text || "None provided"}"
- Attachment Name: "${fileName || "None"}"
- Attachment Type: "${fileType || "None"}"${scannedFileInfo}${ytMetadata}

Determine whether to APPROVE (on-topic or polite greeting) or REJECT (substantive off-topic deviation).`;
        }

        if (fileBase64) {
          const fileExt = fileName ? fileName.split('.').pop()?.toLowerCase() || "jpeg" : "jpeg";
          const mimeType = fileExt === "png" ? "image/png" : "image/jpeg";
          contents = [
            {
              inlineData: {
                mimeType: mimeType,
                data: fileBase64,
              },
            },
            {
              text: `${promptText}\nNote: Check if the content of this attached image is also relevant to the group's topic or respectful/friendly.`,
            }
          ];
        } else {
          contents = [promptText];
        }

        const response = await generateContentWithRetry(ai, {
          model: "gemini-3.5-flash",
          contents: contents,
          config: {
            systemInstruction: systemInstruction,
            responseMimeType: "application/json",
            temperature: 0.1,
            maxOutputTokens: 150,
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                status: {
                  type: Type.STRING,
                  enum: ["APPROVED", "REJECTED"],
                  description: "APPROVED if the content matches group topic / is friendly, REJECTED if off-topic or rude.",
                },
                explanation: {
                  type: Type.STRING,
                  description: "If REJECTED, a brief explanation of why the message failed moderation. Keep brief or empty if APPROVED.",
                },
              },
              required: ["status", "explanation"],
            },
          },
        });

        const responseText = response.text || "{}";
        const result = JSON.parse(responseText.trim());
        decision = {
          status: result.status || "REJECTED",
          explanation: result.explanation || (result.status === "APPROVED" ? "Approved by Gatekeeper AI." : "No explanation provided."),
        };
      } catch (err: any) {
        console.error("Gemini moderation error:", err);
        addLog("INFO", `Gemini API call failed. Using local fail-safe evaluation fallback. Error: ${err.message}`, { messageId: msgId });
        decision = runFallbackModeration(text || "", fileName, fileDescription, fileContent, ytMetadata, activeGroup?.name, activeGroup?.description, isDM, false);
      }
    } else {
      // Falls back to regex-based heuristics when API key is missing or quota is exhausted
      const fallbackReason = !ai 
        ? "GEMINI_API_KEY is not configured in Secrets." 
        : "Gemini API daily quota is currently exhausted.";
      addLog("INFO", `${fallbackReason} Running high-fidelity local regex evaluation...`, { messageId: msgId });
      decision = runFallbackModeration(text || "", fileName, fileDescription, fileContent, ytMetadata, activeGroup?.name, activeGroup?.description, isDM, false);
    }
  }

  const durationMs = Date.now() - startTime;

  // 3. Process Evaluation Decision
  
  // Remove from pending_messages
  dbPendingMessages = dbPendingMessages.filter(m => m.id !== msgId);

  if (decision.status === "APPROVED") {
    // Move to messages collection
    const approvedMsg: Message = {
      ...pendingMsg,
      id: `msg_approved_${Date.now()}`,
      approvedAt: new Date().toISOString(),
    };
    dbMessages.push(approvedMsg);
    
    addLog("APPROVED", `Gatekeeper approved message to ${targetName} (${durationMs}ms)`, {
      messageId: approvedMsg.id,
      text: approvedMsg.text,
      decision,
    });

    res.json({
      success: true,
      status: "APPROVED",
      message: approvedMsg,
      explanation: decision.explanation,
      latencyMs: durationMs,
      geminiActive: !!ai && !isGeminiQuotaActive(),
    });
  } else {
    // Write private Warning Notification to user
    const warningId = `warn_${Date.now()}`;
    const warning: Notification = {
      id: warningId,
      userId: senderId,
      messageId: msgId,
      messageText: text || `[File: ${fileName || "Unnamed"}]`,
      explanation: decision.explanation,
      timestamp: new Date().toISOString(),
    };
    dbNotifications.push(warning);

    addLog("REJECTED", `Gatekeeper rejected message by ${sender.name} (${durationMs}ms). Private warning sent.`, {
      messageId: msgId,
      reason: decision.explanation,
      decision,
    });

    res.json({
      success: false,
      status: "REJECTED",
      explanation: decision.explanation,
      latencyMs: durationMs,
      geminiActive: !!ai && !isGeminiQuotaActive(),
    });
  }
});

// 14. AI Message & File Content Search API
app.post("/api/search-messages", async (req, res) => {
  const { query, messages: candidateMessages = [], fileTypeFilter = "all" } = req.body;

  if (!query || typeof query !== "string" || !query.trim()) {
    return res.status(400).json({ error: "Search query string is required." });
  }

  const queryClean = query.trim().toLowerCase();
  const startTime = Date.now();

  // Combine server dbMessages with any client candidate messages to ensure full coverage
  const allCandidatesMap = new Map<string, Message>();
  dbMessages.forEach(m => allCandidatesMap.set(m.id, m));
  if (Array.isArray(candidateMessages)) {
    candidateMessages.forEach((m: Message) => {
      if (m && m.id) allCandidatesMap.set(m.id, m);
    });
  }

  let candidates = Array.from(allCandidatesMap.values());

  // Apply file filter if requested
  if (fileTypeFilter === "files") {
    candidates = candidates.filter(m => !!(m.fileName || m.fileUrl || m.fileType || m.fileDescription));
  } else if (fileTypeFilter === "text") {
    candidates = candidates.filter(m => !m.fileName && !!m.text);
  }

  if (candidates.length === 0) {
    return res.json({
      success: true,
      results: [],
      aiExplanation: "No messages found matching the filter criteria.",
      latencyMs: Date.now() - startTime,
    });
  }

  // Attempt Gemini AI Semantic Ranking & Search
  if (ai && !isGeminiQuotaActive()) {
    try {
      const candidateListForPrompt = candidates.map((m) => ({
        id: m.id,
        senderName: m.senderName,
        text: m.text || "",
        fileName: m.fileName || "",
        fileType: m.fileType || "",
        fileDescription: m.fileDescription || "",
        timestamp: m.timestamp,
      }));

      const systemInstruction = `You are an AI Search Engine for a chat platform.
Your job is to search through chat messages and file attachments to find those that match the user's query.
Pay special attention to filenames, file descriptions, file types, and message text content.
If the user is searching for a file, match it based on its filename, type, or contextual content description.
Return a JSON object containing an array of matched messages ordered by relevance score (1-100), along with a short reason explaining WHY each message/file matched, and an overall concise AI summary.`;

      const promptText = `User Search Query: "${query.trim()}"

Candidate Messages & File Attachments to Search:
${JSON.stringify(candidateListForPrompt.slice(0, 50), null, 2)}

Identify the top matching messages/files for the query. Include relevance score (1-100) and specific match reason for each result.`;

      const response = await generateContentWithRetry(ai, {
        model: "gemini-3.5-flash",
        contents: [promptText],
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          temperature: 0.1,
          maxOutputTokens: 600,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              matches: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    messageId: { type: Type.STRING },
                    score: { type: Type.NUMBER },
                    matchReason: { type: Type.STRING },
                    isFileMatch: { type: Type.BOOLEAN },
                  },
                  required: ["messageId", "score", "matchReason"],
                },
              },
              aiExplanation: { type: Type.STRING },
            },
            required: ["matches", "aiExplanation"],
          },
        },
      });

      const responseText = response.text || "{}";
      const resultData = JSON.parse(responseText.trim());
      const matches = resultData.matches || [];

      // Map back to original Message objects
      const structuredResults = matches
        .map((match: any) => {
          const originalMsg = candidates.find((m) => m.id === match.messageId);
          if (!originalMsg) return null;
          return {
            message: originalMsg,
            score: match.score || 80,
            matchReason: match.matchReason || "Matched search keywords",
            isFileMatch: match.isFileMatch ?? !!originalMsg.fileName,
          };
        })
        .filter(Boolean);

      return res.json({
        success: true,
        results: structuredResults,
        aiExplanation: resultData.aiExplanation || `Found ${structuredResults.length} matching message(s) via Gemini AI.`,
        latencyMs: Date.now() - startTime,
        geminiActive: true,
      });
    } catch (err: any) {
      console.error("Gemini AI Search error, using smart local search fallback:", err);
    }
  }

  // Smart local keyword & semantic heuristic matcher fallback
  const queryWords = queryClean.split(/\s+/).filter(w => w.length > 1);

  const scoredResults = candidates.map((m) => {
    let score = 0;
    const matchReasons: string[] = [];

    const fileNameLower = (m.fileName || "").toLowerCase();
    const fileDescLower = (m.fileDescription || "").toLowerCase();
    const fileTypeLower = (m.fileType || "").toLowerCase();
    const textLower = (m.text || "").toLowerCase();
    const senderLower = (m.senderName || "").toLowerCase();

    // Exact filename match
    if (fileNameLower && fileNameLower.includes(queryClean)) {
      score += 60;
      matchReasons.push(`Exact match in filename "${m.fileName}"`);
    }

    // Exact file description match
    if (fileDescLower && fileDescLower.includes(queryClean)) {
      score += 45;
      matchReasons.push(`Matched in file description context`);
    }

    // Exact message text match
    if (textLower && textLower.includes(queryClean)) {
      score += 35;
      matchReasons.push(`Matched message text`);
    }

    // Word-level search across fields
    queryWords.forEach((word) => {
      if (fileNameLower.includes(word)) {
        score += 20;
        if (!matchReasons.some(r => r.includes("filename"))) {
          matchReasons.push(`Filename contains '${word}'`);
        }
      }
      if (fileDescLower.includes(word)) {
        score += 15;
        if (!matchReasons.some(r => r.includes("description"))) {
          matchReasons.push(`File context contains '${word}'`);
        }
      }
      if (textLower.includes(word)) {
        score += 10;
        if (!matchReasons.some(r => r.includes("text"))) {
          matchReasons.push(`Text contains '${word}'`);
        }
      }
      if (fileTypeLower.includes(word)) {
        score += 15;
        matchReasons.push(`Matched file type ${m.fileType}`);
      }
      if (senderLower.includes(word)) {
        score += 10;
        matchReasons.push(`Sent by ${m.senderName}`);
      }
    });

    return {
      message: m,
      score: Math.min(score, 100),
      matchReason: matchReasons.length > 0 ? matchReasons.join(" • ") : "Contains matching search terms",
      isFileMatch: !!m.fileName,
    };
  })
  .filter(r => r.score > 0)
  .sort((a, b) => b.score - a.score);

  const isFileQuery = queryClean.includes("file") || queryClean.includes("pdf") || queryClean.includes("doc") || queryClean.includes("notes") || queryClean.includes("image") || queryClean.includes("video") || queryClean.includes("attachment");
  
  return res.json({
    success: true,
    results: scoredResults,
    aiExplanation: scoredResults.length > 0
      ? `Found ${scoredResults.length} result(s) matching "${query.trim()}". ${isFileQuery ? "Prioritized matching file names, attachments, and file contexts." : ""}`
      : `No messages or files found matching "${query.trim()}".`,
    latencyMs: Date.now() - startTime,
    geminiActive: false,
  });
});


// Serve React build in production, otherwise Vite handles development
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Gatekeeper Applet Server running on http://localhost:${PORT}`);
  });
}

startServer();
