# Gatekeeper Universal Chat 🛡️💬

A feature-rich, topic-enforced universal chat platform built with React, TypeScript, Express, Tailwind CSS, Firebase Firestore & Authentication, and Google Gemini AI.

---

## 🌟 Key Features

- **✨ AI Message & File Content Search**: Powered by Google Gemini AI (`gemini-3.5-flash`), search through chat messages and attached files (PDFs, Word docs, PowerPoint slides, YouTube links, images, and videos) using natural language, content keywords, file descriptions, or file names.
- **🛡️ Topic-Enforced Platform**: Intelligent AI topic checking and content validation ensuring discussions remain relevant and constructive.
- **💬 Direct Messages & Group Channels**: Real-time group messaging and 1-on-1 direct conversations with presence and activity indicators.
- **📁 File & Media Sharing**: Upload, attach, preview, and search across various document formats, images, videos, and links.
- **📱 Mobile-Ready (Capacitor & Android)**: Configured with Capacitor for cross-platform Android native app builds and synchronization.
- **🔥 Firebase Firestore Persistence**: Persistent multi-user chat storage and authentication.

---

## 🛠️ Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Lucide Icons, Motion / Framer Motion
- **Backend / API**: Node.js, Express, Google Gen AI SDK (`@google/genai`), Esbuild
- **Database & Auth**: Firebase Firestore & Firebase Auth
- **Cross-Platform**: Capacitor (`@capacitor/core`, `@capacitor/android`)
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

## 📱 Building for Mobile (Capacitor Android)

To build and sync with Capacitor for Android:

```bash
# 1. Build web production assets
npm run build

# 2. Sync web assets with native Android project
npx cap sync

# 3. Open in Android Studio (or run gradle build)
npx cap open android
```

---

## 📄 License

MIT License. Built for Gatekeeper Universal Chat.
