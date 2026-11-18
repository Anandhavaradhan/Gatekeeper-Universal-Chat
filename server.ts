import express, { type NextFunction, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { getFirestore, FieldValue, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

dotenv.config();

/* ------------------------------------------------------------------ *
 * Firebase Admin
 *
 * The server is the only thing that writes users, groups, messages,
 * warnings and logs (see firestore.rules). It verifies the caller's
 * Firebase ID token on every request, so moderation can't be skipped.
 *
 * Credentials: Application Default Credentials (Cloud Run / AI Studio
 * provide them; locally set GOOGLE_APPLICATION_CREDENTIALS to a service
 * account key). With FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST
 * and FIREBASE_STORAGE_EMULATOR_HOST set, it talks to the emulators.
 * ------------------------------------------------------------------ */
const firebaseConfig = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "firebase-applet-config.json"), "utf8")
);
const adminApp = initializeApp({
  projectId: firebaseConfig.projectId,
  storageBucket: firebaseConfig.storageBucket,
});
const adminAuth = getAuth(adminApp);
const db: Firestore =
  firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== "(default)"
    ? getFirestore(adminApp, firebaseConfig.firestoreDatabaseId)
    : getFirestore(adminApp);
const bucket = getStorage(adminApp).bucket();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

app.use(express.json({ limit: "10mb" }));

const TEMP_EMAIL_DOMAINS = [
  "mailinator.com", "tempmail.com", "temp-mail.org", "10minutemail.com",
  "yopmail.com", "trashmail.com", "disposable.com", "generator.com", "fake.com",
  "guerrillamail.com", "sharklasers.com", "getairmail.com", "dispostable.com", "maildrop.cc",
  "tempmail.net", "tempmail.co", "crazymailing.com", "throwawaymail.com", "mailnesia.com",
  "disposablemail.com", "tempmailaddress.com", "safe-mail.net", "yopmail.fr", "yopmail.net",
];
function isTemporaryEmail(email: string): boolean {
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length < 2) return true;
  return TEMP_EMAIL_DOMAINS.includes(parts[1]);
}

// Initialize Gemini Client Lazily/Safely
let ai: GoogleGenAI | null = null;
const API_KEY = process.env.GEMINI_API_KEY;

// The last refusal from Gemini, so a wrong key or a retired model shows up in /api/config
// instead of quietly turning into local moderation. Checked by: npm run check:gemini
let lastGeminiError: { message: string; at: string } | null = null;
// null until the startup check has answered; then whether Gemini really replies.
let geminiVerified: boolean | null = null;
function noteGeminiError(err: unknown) {
  let raw = err instanceof Error ? err.message : String(err);
  // The SDK often hands back the API's whole JSON body; keep just the sentence that explains it.
  const brace = raw.indexOf("{");
  if (brace >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(brace));
      if (parsed?.error?.message) raw = `${parsed.error.message} (${parsed.error.status || parsed.error.code})`;
    } catch {
      /* not JSON after all, keep the original text */
    }
  }
  lastGeminiError = {
    // An API error can echo the request URL back, key and all.
    message: raw.replace(/key=[\w-]+/g, "key=REDACTED").replace(/AIza[\w-]{10,}/g, "AIza…REDACTED").slice(0, 300),
    at: new Date().toISOString(),
  };
}

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
    // Ask Gemini one tiny question at startup, so a wrong key or a retired model is known
    // before the first message rather than silently becoming local moderation.
    void (async () => {
      try {
        await ai!.models.generateContent({
          model: "gemini-3.5-flash",
          contents: ["Reply with the single word: ok"],
          config: { maxOutputTokens: 5, temperature: 0 },
        });
        geminiVerified = true;
        lastGeminiError = null;
        console.log("Gemini key and model verified.");
      } catch (err) {
        geminiVerified = false;
        noteGeminiError(err);
        console.warn("Gemini refused the startup check, so moderation will use the local fallback.");
        console.warn("Run `npm run check:gemini` to see why. Reason:", lastGeminiError?.message);
      }
    })();
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
        lastGeminiError = null;
        geminiVerified = true;
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


// Data shapes stored in Firestore (match src/types.ts)
type FileKind = "PDF" | "Video" | "Image" | "Word" | "PPT" | "YouTube" | "Other";

interface UserProfile {
  uid: string;
  name: string;
  username: string;
  email: string;
  groups: string[];
  createdAt: string;
}

interface Group {
  id: string;
  name: string;
  description: string;
  members: string[];
  createdBy: string;
  createdAt: string;
}

interface Message {
  id: string;
  kind: "group" | "dm";
  groupId?: string;
  recipientId?: string;
  participants?: string[]; // DMs: the two people
  dmKey?: string;          // DMs: the two uids, sorted, joined with "__"
  audience: string[];      // who could read it when it was sent (used for alerts)
  senderId: string;
  senderName: string;
  text?: string;
  fileName?: string;
  fileType?: FileKind;
  fileDescription?: string;
  fileMime?: string;
  fileSize?: number;
  filePath?: string;       // object path in Cloud Storage; served by GET /api/messages/:id/file
  timestamp: string;
  approvedAt?: string;
  friendlyPoliteFilter?: boolean;
  replyToId?: string;
  replyToSenderName?: string;
  replyToText?: string;
  isForwarded?: boolean;
  originalSenderName?: string;
}

type Decision = { status: "APPROVED" | "REJECTED"; explanation: string };

function clean<T extends object>(obj: T): T {
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

function dmKeyOf(a: string, b: string) {
  return [a, b].sort().join("__");
}

function fileKindOf(name: string): FileKind {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf") return "PDF";
  if (["doc", "docx"].includes(ext)) return "Word";
  if (["ppt", "pptx"].includes(ext)) return "PPT";
  if (["mp4", "mov", "avi", "webm", "mkv"].includes(ext)) return "Video";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "Image";
  return "Other";
}

const TEXT_EXTENSIONS = ["txt", "py", "js", "ts", "json", "md", "csv", "html", "css", "xml", "yaml", "yml", "sql", "sh"];

function mimeOf(name: string, given?: string): string {
  if (given && /^[\w.+-]+\/[\w.+-]+$/.test(given)) return given;
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", txt: "text/plain", md: "text/markdown", csv: "text/csv",
    json: "application/json", doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return map[ext] || "application/octet-stream";
}

function safeFileName(name: string) {
  const base = path.basename(String(name || "file")).replace(/[^\w.\- ()]+/g, "_").slice(0, 120);
  return base || "file";
}

/* ---------------------------- auth ---------------------------- */
interface AuthedRequest extends Request {
  user: DecodedIdToken;
}

function authed(requireVerified: boolean) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const m = (req.headers.authorization || "").match(/^Bearer (.+)$/);
    if (!m) return res.status(401).json({ error: "Please sign in." });
    try {
      const token = await adminAuth.verifyIdToken(m[1]);
      if (requireVerified && !token.email_verified) {
        return res.status(403).json({ error: "Please verify your email address first." });
      }
      (req as AuthedRequest).user = token;
      next();
    } catch {
      res.status(401).json({ error: "Your session has expired. Please sign in again." });
    }
  };
}
const signedIn = authed(false);
const verified = authed(true);

function route(fn: (req: AuthedRequest, res: Response) => Promise<any>) {
  return (req: Request, res: Response) => {
    fn(req as AuthedRequest, res).catch((err) => {
      console.error(`${req.method} ${req.path} failed:`, err);
      if (!res.headersSent) res.status(500).json({ error: "Something went wrong. Please try again." });
    });
  };
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
function routeE(fn: (req: AuthedRequest, res: Response) => Promise<any>) {
  return route(async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
      throw e;
    }
  });
}

async function getProfile(uid: string): Promise<UserProfile> {
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) throw new HttpError(403, "Finish setting up your profile first.");
  return snap.data() as UserProfile;
}

async function getGroupForMember(groupId: string, uid: string): Promise<Group> {
  const snap = await db.collection("groups").doc(String(groupId)).get();
  if (!snap.exists) throw new HttpError(404, "Group not found.");
  const g = snap.data() as Group;
  if (!g.members.includes(uid)) throw new HttpError(403, "You are not a member of this group.");
  return g;
}

async function canRead(uid: string, msg: Message): Promise<boolean> {
  if (msg.kind === "dm") return (msg.participants || []).includes(uid);
  if (!msg.groupId) return false;
  const g = await db.collection("groups").doc(msg.groupId).get();
  return g.exists && (g.data() as Group).members.includes(uid);
}

async function writeLog(userId: string, type: "APPROVED" | "REJECTED" | "INFO", details: string, data: any = {}) {
  const ref = db.collection("logs").doc();
  await ref.set({ id: ref.id, userId, timestamp: new Date().toISOString(), type, details, data: clean(data) });
}

/* -------------------------- moderation -------------------------- */
interface ModerationInput {
  text?: string;
  fileName?: string;
  fileType?: string;
  fileDescription?: string;
  fileContent?: string;
  fileBase64?: string;
  fileMime?: string;
  isDM: boolean;
  friendlyPoliteFilter?: boolean;
  groupName?: string;
  groupDescription?: string;
}

async function moderate(input: ModerationInput): Promise<Decision & { latencyMs: number; geminiActive: boolean }> {
  const { text, fileName, fileType, fileDescription, fileContent, fileBase64, fileMime, isDM, friendlyPoliteFilter, groupName, groupDescription } = input;
  const startTime = Date.now();
  const done = (d: Decision) => ({ ...d, latencyMs: Date.now() - startTime, geminiActive: !!ai && !isGeminiQuotaActive() });

  if (!text?.trim() && !fileName?.trim() && !fileContent?.trim() && !fileBase64?.trim()) {
    return done({ status: "APPROVED", explanation: "Approved empty or neutral content." });
  }

  const ytMetadata = await extractAndFetchYouTubeMetadata(text || "");
  const fallback = () =>
    runFallbackModeration(text || "", fileName, fileDescription, fileContent, ytMetadata, groupName, groupDescription, isDM, friendlyPoliteFilter);

  if (!ai || isGeminiQuotaActive()) return done(fallback());

  try {
    let systemInstruction = "";
    let promptText = "";
    if (isDM) {
      if (friendlyPoliteFilter) {
        systemInstruction = "You are an AI Gatekeeper Moderator for a direct private chat. A Friendly & Polite filter is ENABLED. Your primary directive is to ensure that the user's message is respectful, polite, friendly, and free of rudeness, hostility, sarcasm, swearing, or passive-aggressive remarks. You must reject any message containing insulting language, toxicity, or explicit swearing. Normal greetings and friendly chat are APPROVED. If REJECTED, write a brief, polite explanation of which part was impolite and suggest how it could be rephrased.";
        promptText = `Evaluate this direct private message to see if it is polite, friendly, and respectful:
- Message Text: "${text || "None provided"}"
- Attachment Name: "${fileName || "None"}"
- Attachment Type: "${fileType || "None"}"${fileContent ? `\n- Attachment File Content: """\n${fileContent}\n"""` : ""}

Decide whether to APPROVE this message or REJECT it for impolite, hostile, or toxic language.`;
      } else {
        systemInstruction = "You are an AI Moderator for a direct private chat. Always approve standard polite conversational messages unless they contain extremely harmful, illegal, or dangerous content.";
        promptText = `Message: "${text || "None"}"
- Attachment Name: "${fileName || "None"}"`;
      }
    } else {
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

    const contents: any[] = fileBase64
      ? [
          { inlineData: { mimeType: fileMime || "image/jpeg", data: fileBase64 } },
          { text: `${promptText}\nNote: Check if the content of this attached image is also relevant to the group's topic or respectful/friendly.` },
        ]
      : [promptText];

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens: 150,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            status: { type: Type.STRING, enum: ["APPROVED", "REJECTED"] },
            explanation: { type: Type.STRING },
          },
          required: ["status", "explanation"],
        },
      },
    });
    const result = JSON.parse((response.text || "{}").trim());
    return done({
      status: result.status === "APPROVED" ? "APPROVED" : "REJECTED",
      explanation: result.explanation || (result.status === "APPROVED" ? "Approved by Gatekeeper AI." : "No explanation provided."),
    });
  } catch (err) {
    console.error("Gemini evaluation error, using fallback moderation:", err);
    noteGeminiError(err);
    return done(fallback());
  }
}

/* --------------------------- endpoints --------------------------- */

app.get("/api/config", (_req, res) => {
  const quota = isGeminiQuotaActive();
  // A key that has already been refused is not active, so the app shows local moderation honestly.
  const active = !!ai && !quota && geminiVerified !== false;
  res.json({
    geminiActive: active,
    apiModel: "gemini-3.5-flash",
    fallbackEnabled: !active,
    keyConfigured: !!ai,
    // null while the startup check is still running.
    keyVerified: geminiVerified,
    // Why Gemini was last refused, if it was. null once a call succeeds.
    lastError: lastGeminiError,
  });
});

// Create the signed-in user's profile (allowed before email verification, so sign-up can do it).
app.post("/api/profile", signedIn, routeE(async (req, res) => {
  const uid = req.user.uid;
  const email = (req.user.email || "").toLowerCase();
  const name = String(req.body.name || "").trim();
  const username = String(req.body.username || "").trim().toLowerCase();
  if (!email) throw new HttpError(400, "Your account has no email address.");
  if (isTemporaryEmail(email)) throw new HttpError(400, "Temporary/disposable email addresses are not allowed. Please use a school or personal email.");
  if (name.length < 1 || name.length > 60) throw new HttpError(400, "Please enter your name (up to 60 characters).");
  if (!/^[a-z0-9_.]{3,24}$/.test(username)) throw new HttpError(400, "Usernames are 3–24 characters: letters, numbers, dots and underscores.");

  const userRef = db.collection("users").doc(uid);
  const nameRef = db.collection("usernames").doc(username);
  const profile = await db.runTransaction(async (t) => {
    const [u, n] = await Promise.all([t.get(userRef), t.get(nameRef)]);
    if (u.exists) return u.data() as UserProfile;
    if (n.exists && n.data()?.uid !== uid) throw new HttpError(409, `The username @${username} is taken. Please choose another.`);
    const p: UserProfile = { uid, name, username, email, groups: [], createdAt: new Date().toISOString() };
    t.set(nameRef, { uid });
    t.set(userRef, p);
    return p;
  });
  await writeLog(uid, "INFO", `Profile created: ${profile.name} (@${profile.username})`);
  res.json({ success: true, user: profile });
}));

// Create a group. The creator is its first member.
app.post("/api/groups", verified, routeE(async (req, res) => {
  const me = await getProfile(req.user.uid);
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim();
  if (!name || name.length > 80) throw new HttpError(400, "Please give the group a name (up to 80 characters).");
  if (!description || description.length > 1000) throw new HttpError(400, "Please describe the group's topic (up to 1000 characters).");
  const ref = db.collection("groups").doc();
  const group: Group = { id: ref.id, name, description, members: [me.uid], createdBy: me.uid, createdAt: new Date().toISOString() };
  const batch = db.batch();
  batch.set(ref, group);
  batch.update(db.collection("users").doc(me.uid), { groups: FieldValue.arrayUnion(ref.id) });
  await batch.commit();
  await writeLog(me.uid, "INFO", `Created group "${name}". Topic: "${description}"`, { groupId: ref.id });
  res.json({ success: true, group });
}));

// Add someone to a group (only existing members can).
app.post("/api/groups/:groupId/members", verified, routeE(async (req, res) => {
  const me = await getProfile(req.user.uid);
  const group = await getGroupForMember(req.params.groupId, me.uid);
  const userId = String(req.body.userId || "");
  const target = await db.collection("users").doc(userId).get();
  if (!userId || !target.exists) throw new HttpError(404, "That user was not found.");
  const batch = db.batch();
  batch.update(db.collection("groups").doc(group.id), { members: FieldValue.arrayUnion(userId) });
  batch.update(db.collection("users").doc(userId), { groups: FieldValue.arrayUnion(group.id) });
  await batch.commit();
  const t = target.data() as UserProfile;
  await writeLog(me.uid, "INFO", `Added ${t.name} to ${group.name}`, { groupId: group.id, userId });
  res.json({ success: true });
}));

// Leave a group.
app.post("/api/groups/:groupId/leave", verified, routeE(async (req, res) => {
  const me = await getProfile(req.user.uid);
  const group = await getGroupForMember(req.params.groupId, me.uid);
  const batch = db.batch();
  batch.update(db.collection("groups").doc(group.id), { members: FieldValue.arrayRemove(me.uid) });
  batch.update(db.collection("users").doc(me.uid), { groups: FieldValue.arrayRemove(group.id) });
  await batch.commit();
  await writeLog(me.uid, "INFO", `Left ${group.name}`, { groupId: group.id });
  res.json({ success: true });
}));

// Live preview while typing: runs moderation for the open conversation, writes nothing.
app.post("/api/evaluate", verified, routeE(async (req, res) => {
  const uid = req.user.uid;
  const { text, groupId, friendlyPoliteFilter } = req.body;
  let group: Group | undefined;
  if (groupId) group = await getGroupForMember(groupId, uid);
  const d = await moderate({
    text: typeof text === "string" ? text.slice(0, 4000) : undefined,
    isDM: !group,
    friendlyPoliteFilter: !group && !!friendlyPoliteFilter,
    groupName: group?.name,
    groupDescription: group?.description,
  });
  res.json(d);
}));

// Send a message (new, reply or forward). Moderated here; only approved messages are stored.
app.post("/api/messages", verified, routeE(async (req, res) => {
  const me = await getProfile(req.user.uid);
  const { groupId, recipientId, replyToId, forwardOfId } = req.body;
  const friendlyPoliteFilter = !!req.body.friendlyPoliteFilter;

  // Who is it for?
  let group: Group | undefined;
  let recipient: UserProfile | undefined;
  if (groupId) {
    group = await getGroupForMember(groupId, me.uid);
  } else if (recipientId) {
    if (recipientId === me.uid) throw new HttpError(400, "You can't message yourself.");
    const r = await db.collection("users").doc(String(recipientId)).get();
    if (!r.exists) throw new HttpError(404, "Recipient not found.");
    recipient = r.data() as UserProfile;
  } else {
    throw new HttpError(400, "Choose a group or a person to message.");
  }

  // What is being sent?
  let text: string | undefined = typeof req.body.text === "string" && req.body.text.trim() ? req.body.text.slice(0, 4000) : undefined;
  let file: { name: string; mime: string; bytes?: Buffer; copyFrom?: string; size: number; type: FileKind; description?: string } | undefined;
  let forwardedFrom: Message | undefined;

  if (forwardOfId) {
    const o = await db.collection("messages").doc(String(forwardOfId)).get();
    if (!o.exists) throw new HttpError(404, "The message to forward was not found.");
    forwardedFrom = o.data() as Message;
    if (!(await canRead(me.uid, forwardedFrom))) throw new HttpError(403, "You can't forward that message.");
    text = forwardedFrom.text;
    if (forwardedFrom.filePath && forwardedFrom.fileName) {
      file = {
        name: forwardedFrom.fileName,
        mime: forwardedFrom.fileMime || mimeOf(forwardedFrom.fileName),
        copyFrom: forwardedFrom.filePath,
        size: forwardedFrom.fileSize || 0,
        type: forwardedFrom.fileType || fileKindOf(forwardedFrom.fileName),
        description: forwardedFrom.fileDescription,
      };
    }
  } else if (req.body.file && typeof req.body.file.base64 === "string") {
    const name = safeFileName(req.body.file.name);
    const bytes = Buffer.from(req.body.file.base64, "base64");
    if (!bytes.length) throw new HttpError(400, "The attached file is empty.");
    if (bytes.length > MAX_FILE_BYTES) throw new HttpError(400, "Files must be under 5 MB.");
    const type = fileKindOf(name);
    file = { name, mime: mimeOf(name, req.body.file.mimeType), bytes, size: bytes.length, type, description: `${type} study resource` };
  }
  if (!text && !file) throw new HttpError(400, "Write a message or attach a file.");

  // What can the moderator see of the file?
  let fileContent: string | undefined;
  let fileBase64: string | undefined;
  if (file) {
    let bytes = file.bytes;
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    const isText = file.mime.startsWith("text/") || TEXT_EXTENSIONS.includes(ext);
    const isImage = file.mime.startsWith("image/");
    if (!bytes && file.copyFrom && (isText || isImage) && file.size <= MAX_FILE_BYTES) {
      [bytes] = await bucket.file(file.copyFrom).download();
    }
    if (bytes && isText) fileContent = bytes.toString("utf8").slice(0, 15000);
    if (bytes && isImage) fileBase64 = bytes.toString("base64");
  }

  const decision = await moderate({
    text,
    fileName: file?.name,
    fileType: file?.type,
    fileDescription: file?.description,
    fileContent,
    fileBase64,
    fileMime: file?.mime,
    isDM: !group,
    friendlyPoliteFilter: !group && friendlyPoliteFilter,
    groupName: group?.name,
    groupDescription: group?.description,
  });
  const targetName = group ? `group "${group.name}"` : `@${recipient!.username}`;
  const now = new Date().toISOString();

  if (decision.status !== "APPROVED") {
    const ref = db.collection("notifications").doc();
    await ref.set({
      id: ref.id,
      userId: me.uid,
      messageId: "",
      messageText: text || `[File: ${file?.name || "Unnamed"}]`,
      explanation: (forwardedFrom ? "[Forward rejected] " : "") + decision.explanation,
      timestamp: now,
    });
    await writeLog(me.uid, "REJECTED", `Message to ${targetName} was not delivered (${decision.latencyMs}ms).`, { reason: decision.explanation });
    return res.json({ status: "REJECTED", explanation: decision.explanation, latencyMs: decision.latencyMs, geminiActive: decision.geminiActive });
  }

  // Reply context comes from the stored message, not from the client.
  let reply: Partial<Message> = {};
  if (replyToId) {
    const r = await db.collection("messages").doc(String(replyToId)).get();
    if (r.exists) {
      const rm = r.data() as Message;
      if (await canRead(me.uid, rm)) {
        reply = {
          replyToId: rm.id,
          replyToSenderName: rm.senderName,
          replyToText: rm.text || (rm.fileName ? `[Attached ${rm.fileType}]` : "Attachment"),
        };
      }
    }
  }

  const ref = db.collection("messages").doc();
  let filePath: string | undefined;
  if (file) {
    filePath = `attachments/${ref.id}/${file.name}`;
    if (file.bytes) {
      await bucket.file(filePath).save(file.bytes, { contentType: file.mime, resumable: false });
    } else if (file.copyFrom) {
      await bucket.file(file.copyFrom).copy(bucket.file(filePath));
    }
  }

  const msg: Message = clean({
    id: ref.id,
    kind: group ? "group" : "dm",
    groupId: group?.id,
    recipientId: recipient?.uid,
    participants: recipient ? [me.uid, recipient.uid] : undefined,
    dmKey: recipient ? dmKeyOf(me.uid, recipient.uid) : undefined,
    audience: group ? group.members : [me.uid, recipient!.uid],
    senderId: me.uid,
    senderName: me.name,
    text,
    fileName: file?.name,
    fileType: file?.type,
    fileDescription: file?.description,
    fileMime: file?.mime,
    fileSize: file?.size,
    filePath,
    timestamp: now,
    approvedAt: now,
    friendlyPoliteFilter: recipient ? friendlyPoliteFilter : undefined,
    isForwarded: forwardedFrom ? true : undefined,
    originalSenderName: forwardedFrom ? forwardedFrom.originalSenderName || forwardedFrom.senderName : undefined,
    ...reply,
  }) as Message;
  await ref.set(msg);
  await writeLog(me.uid, "APPROVED", `${forwardedFrom ? "Forwarded message" : "Message"} delivered to ${targetName} (${decision.latencyMs}ms).`, { messageId: ref.id });
  res.json({ status: "APPROVED", message: msg, explanation: decision.explanation, latencyMs: decision.latencyMs, geminiActive: decision.geminiActive });
}));

// Delete your own message (and its attachment).
app.delete("/api/messages/:id", verified, routeE(async (req, res) => {
  const ref = db.collection("messages").doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(404, "Message not found.");
  const msg = snap.data() as Message;
  if (msg.senderId !== req.user.uid) throw new HttpError(403, "You can only delete your own messages.");
  await ref.delete();
  if (msg.filePath) await bucket.file(msg.filePath).delete({ ignoreNotFound: true });
  await writeLog(req.user.uid, "INFO", "Deleted a message.", { messageId: msg.id });
  res.json({ success: true });
}));

// Download an attachment (only for people who can read the message).
app.get("/api/messages/:id/file", verified, routeE(async (req, res) => {
  const snap = await db.collection("messages").doc(req.params.id).get();
  if (!snap.exists) throw new HttpError(404, "Message not found.");
  const msg = snap.data() as Message;
  if (!msg.filePath) throw new HttpError(404, "This message has no attachment.");
  if (!(await canRead(req.user.uid, msg))) throw new HttpError(403, "You can't open this file.");
  const f = bucket.file(msg.filePath);
  const [exists] = await f.exists();
  if (!exists) throw new HttpError(404, "The file is no longer available.");
  res.setHeader("Content-Type", msg.fileMime || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${(msg.fileName || "file").replace(/"/g, "")}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  f.createReadStream().on("error", () => res.end()).pipe(res);
}));

// Search messages and files the caller can read.
app.post("/api/search-messages", verified, routeE(async (req, res) => {
  const uid = req.user.uid;
  const { query, fileTypeFilter = "all", scope = "current", groupId, recipientId } = req.body;
  if (!query || typeof query !== "string" || !query.trim()) throw new HttpError(400, "Search query string is required.");
  const startTime = Date.now();
  const me = await getProfile(uid);

  const found = new Map<string, Message>();
  const add = (snap: FirebaseFirestore.QuerySnapshot) => snap.forEach((d) => found.set(d.id, d.data() as Message));
  const groupIds: string[] = scope === "all" ? me.groups : groupId ? [String(groupId)] : [];
  for (const gid of groupIds) {
    await getGroupForMember(gid, uid);
    add(await db.collection("messages").where("groupId", "==", gid).orderBy("timestamp", "asc").limitToLast(300).get());
  }
  if (scope === "all") {
    add(await db.collection("messages").where("participants", "array-contains", uid).limit(500).get());
  } else if (recipientId) {
    add(await db.collection("messages").where("dmKey", "==", dmKeyOf(uid, String(recipientId))).orderBy("timestamp", "asc").limitToLast(300).get());
  }

  let candidates = Array.from(found.values());
  if (fileTypeFilter === "files") candidates = candidates.filter((m) => !!m.fileName);
  else if (fileTypeFilter === "text") candidates = candidates.filter((m) => !m.fileName && !!m.text);
  if (candidates.length === 0) {
    return res.json({ success: true, results: [], aiExplanation: "No messages found matching the filter criteria.", latencyMs: Date.now() - startTime });
  }
  res.json(await rankMessages(query, query.trim().toLowerCase(), candidates, startTime));
}));

async function rankMessages(query: string, queryClean: string, candidates: Message[], startTime: number) {
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

      return ({
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
  
  return ({
    success: true,
    results: scoredResults,
    aiExplanation: scoredResults.length > 0
      ? `Found ${scoredResults.length} result(s) matching "${query.trim()}". ${isFileQuery ? "Prioritized matching file names, attachments, and file contexts." : ""}`
      : `No messages or files found matching "${query.trim()}".`,
    latencyMs: Date.now() - startTime,
    geminiActive: false,
  });}

// Serve React build in production, otherwise Vite handles development
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Gatekeeper server running on http://localhost:${PORT}`);
  });
}

startServer();
