# Gatekeeper Universal Chat 🛡️💬

A feature-rich, topic-enforced universal chat platform built with React, TypeScript, Express, Tailwind CSS, Firebase Firestore & Authentication, and Google Gemini AI.

---

## 🌟 Key Features

- **✨ AI Message & File Content Search**: Powered by Google Gemini AI (`gemini-3.5-flash`), search through chat messages and attached files (PDFs, Word docs, PowerPoint slides, YouTube links, images, and videos) using natural language, content keywords, file descriptions, or file names.
- **🛡️ Topic-Enforced Platform**: Intelligent AI topic checking and content validation ensuring discussions remain relevant and constructive.
- **💬 Direct Messages & Group Channels**: Real-time group messaging and 1-on-1 direct conversations with presence and activity indicators.
- **📁 File & Media Sharing**: Upload, attach, preview, and search across various document formats, images, videos, and links.
- **🔐 Real accounts**: Firebase Authentication with email + password and email verification. Disposable email domains are refused.
- **🧱 Server-enforced moderation**: the server checks every request's Firebase ID token, moderates the message, and is the only thing that writes messages, groups and warnings. Firestore rules only let people read the groups and DMs they are part of.
- **🔥 Firebase Firestore & Storage**: messages in Firestore, attachments in Cloud Storage, downloaded through the server after an access check.

---

## 🛠️ Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Lucide Icons, Motion / Framer Motion
- **Backend / API**: Node.js, Express, Google Gen AI SDK (`@google/genai`), Esbuild
- **Database, Auth & Files**: Firebase Firestore, Firebase Auth, Cloud Storage (`firebase` on the client, `firebase-admin` on the server)
- **Build Tooling**: Vite, `tsx`

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v18+)
- npm or bun

### Environment Variables

Copy `.env.example` and set up your environment variables if needed:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### Installation

```bash
# Install dependencies
npm install
```

---

## 📜 Available Scripts

- `npm run dev`: Starts the Express server with Vite middleware in development mode on port 3000.
- `npm run build`: Builds the Vite production bundle and packages `server.ts` into `dist/server.cjs` via `esbuild`.
- `npm start`: Runs the production bundled server using Node.
- `npm run lint`: Runs TypeScript type checking (`tsc --noEmit`).

---

## 🔥 Firebase setup

Setting the app up on a new Firebase project, step by step:
see **[FIREBASE-SETUP.md](FIREBASE-SETUP.md)**. The short version:

1. In the Firebase console for the project in `firebase-applet-config.json`, turn on **Authentication → Sign-in method → Email/Password**.
2. Deploy the rules and indexes (the Firestore database id is set in `firebase.json`):
   ```bash
   npx firebase-tools deploy --only firestore,storage --project <projectId>
   ```
3. Give the server credentials for Firebase Admin. On Cloud Run / AI Studio the service account is used automatically.
   Locally, set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account key file for the project.

### Run against the Firebase emulators (no cloud project needed)

```bash
npx firebase-tools emulators:start --only auth,firestore,storage --project gen-lang-client-0973407933
# in another terminal
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 VITE_USE_FIREBASE_EMULATORS=true npm run dev
```
Verification emails are not sent by the emulator; the links appear in its log.

---

## ☁️ Hosting, and the Android and Windows apps

Gatekeeper needs its server (it holds the Gemini key and checks every message), so it cannot run on GitHub Pages.
Host the container, then build the apps to point at it:

1. **Host it.** The `Dockerfile` runs anywhere containers do. On Google Cloud Run:
   ```bash
   gcloud run deploy gatekeeper --source . --region <region> --allow-unauthenticated \
     --set-env-vars GEMINI_API_KEY=<your key>
   ```
   Then add the service's address in the Firebase console under Authentication → Settings → Authorized domains.
2. **Build the apps.** In GitHub: Actions → **Gatekeeper Chat apps** → Run workflow, and enter the hosted address.
   The APK and the Windows .exe are published to the `downloads` branch:
   - `https://github.com/Anandhavaradhan/Gatekeeper-Universal-Chat/raw/downloads/GatekeeperChat.apk`
   - `https://github.com/Anandhavaradhan/Gatekeeper-Universal-Chat/raw/downloads/GatekeeperChat.exe`

The apps (`android/`, `desktop/`) are thin shells that open the hosted site.

---

## 📄 License

MIT License. Built for Gatekeeper Universal Chat.
