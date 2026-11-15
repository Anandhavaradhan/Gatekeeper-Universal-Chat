import { initializeApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import firebaseConfig from "../firebase-applet-config.json";

// Initialize Firebase App
const app = initializeApp({
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  storageBucket: firebaseConfig.storageBucket,
  messagingSenderId: firebaseConfig.messagingSenderId,
  appId: firebaseConfig.appId,
});

// Initialize Firestore with custom databaseId if provided
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || "(default)");
const auth = getAuth(app);

// Local testing against the Firebase emulators: run with VITE_USE_FIREBASE_EMULATORS=true
if (import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true") {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
}

/** Calls the server with the signed-in user's ID token. Throws with the server's message on failure. */
export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const { json, headers, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    method: init.method || (json !== undefined ? "POST" : "GET"),
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `Request failed (${res.status})`);
  return data as T;
}

export { app, db, auth };
