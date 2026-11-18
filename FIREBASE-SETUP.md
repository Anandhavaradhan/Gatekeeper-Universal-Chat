# Connecting Gatekeeper to a Firebase project

Gatekeeper signs people in with email and password, keeps groups and messages in Firestore, and stores
attachments in Cloud Storage. The server writes all of it with the Firebase Admin SDK after moderating the
message, so it needs credentials of its own.

Gatekeeper has its own Firebase project (free Spark plan), separate from
[TopicPulse](https://github.com/Anandhavaradhan/focuschat)'s. Both apps write a `users` collection, so
keeping them in separate projects avoids any chance of collision.

## 1. In the Firebase console

**Create the project**, then:

### Firestore
Create the database (the console calls it `(default)`) in a region close to you, in **production mode**.
That is the one Gatekeeper uses.

### Storage
**Build → Storage → Get started.** Accept the default bucket. Gatekeeper keeps message attachments there,
and only the server reads or writes them.

### Authentication
**Sign-in method → Email/Password → Enable.** Leave "Email link" off; the app does not use it.

Under **Settings → Authorized domains**, add wherever you host the app (for example a Cloud Run address).
`localhost` is already there.

### The web app
**Project settings → Your apps → Add app → Web.** Copy the config object it shows you; you need:

`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`

## 2. In this repository

| File | What changes |
|---|---|
| `firebase-applet-config.json` | the six values above, plus `firestoreDatabaseId` → `(default)` |
| `firebase.json` | the `database` name, so rules and indexes deploy to the right place |

Both the browser (`src/firebase.ts`) and the server (`server.ts`) read that one config file, so nothing else
is hard-coded.

## 3. Give the server its credentials

The server writes as an administrator, which is what keeps moderation from being skipped.

- **On Cloud Run / Cloud Functions**: nothing to do. The service account is picked up automatically.
- **Anywhere else, including your own machine**: create a service account key in
  **Project settings → Service accounts → Generate new private key**, save the JSON file outside the repo,
  and point `GOOGLE_APPLICATION_CREDENTIALS` at it.

The Gemini key is separate and stays in `GEMINI_API_KEY`. Without it the server falls back to local
moderation rather than failing.

## 4. Deploy the rules and indexes

Without these, every read is refused and the DM and alert queries fail:

```bash
npx firebase-tools login
npx firebase-tools deploy --only firestore,storage --project focus-apps-8967
```

`firestore.rules` lets people read only the groups and DMs they belong to, and blocks direct writes.
`storage.rules` blocks the browser from the bucket entirely. `firestore.indexes.json` holds the four
composite indexes the app queries need.

## 5. Check it works

```bash
npm install && npm run dev
```

Register an account, confirm the verification email arrives, create a group and send a message.
`/api/config` shows whether Gemini is active or local moderation is in use.

Nothing carries over from another Firebase project: accounts, groups, messages and attachments all start empty.
