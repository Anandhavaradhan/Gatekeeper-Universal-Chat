import React, { useState } from "react";
import { Copy, Check, FileCode, Cpu, Shield, Settings, Server, Terminal, Layers } from "lucide-react";

export default function CodeGuides() {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(id);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const [activeTab, setActiveTab] = useState<"flutter" | "function" | "rules" | "build">("flutter");
  const [activeFlutterFile, setActiveFlutterFile] = useState<"auth" | "db" | "storage">("auth");

  const flutterFiles = {
    auth: {
      name: "auth_service.dart",
      code: `import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

class AuthService extends ChangeNotifier {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  User? _user;

  AuthService() {
    // Listen for auth state changes to keep user logged in persistently
    _auth.authStateChanges().listen((User? user) {
      _user = user;
      notifyListeners();
    });
  }

  User? get currentUser => _user;
  bool get isAuthenticated => _user != null;

  // Register with email/password
  Future<UserCredential?> signUp(String email, String password, String name) async {
    try {
      UserCredential userCredential = await _auth.createUserWithEmailAndPassword(
        email: email,
        password: password,
      );
      
      // Update display name
      await userCredential.user?.updateDisplayName(name);
      await userCredential.user?.reload();
      _user = _auth.currentUser;
      notifyListeners();
      return userCredential;
    } on FirebaseAuthException catch (e) {
      throw Exception(e.message ?? 'Sign up failed');
    }
  }

  // Login with email/password
  Future<UserCredential?> signIn(String email, String password) async {
    try {
      UserCredential userCredential = await _auth.signInWithEmailAndPassword(
        email: email,
        password: password,
      );
      notifyListeners();
      return userCredential;
    } on FirebaseAuthException catch (e) {
      throw Exception(e.message ?? 'Sign in failed');
    }
  }

  // Logout
  Future<void> signOut() async {
    await _auth.signOut();
    notifyListeners();
  }
}`,
    },
    db: {
      name: "database_service.dart",
      code: `import 'package:cloud_firestore/cloud_firestore.dart';

class DatabaseService {
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  // Get stream of approved messages in a group
  Stream<QuerySnapshot> streamGroupMessages(String groupId) {
    return _firestore
        .collection('groups')
        .doc(groupId)
        .collection('messages')
        .orderBy('timestamp', descending: true)
        .snapshots();
  }

  // Send a pending message (Gatekeeper Architecture)
  // All messages must go here first, instead of writing directly to the group messages.
  Future<void> sendPendingMessage({
    required String groupId,
    required String senderId,
    required String senderName,
    required String senderEmail,
    String? text,
    String? fileUrl,
    String? fileName,
    String? fileType,
    String? fileDescription,
  }) async {
    await _firestore.collection('pending_messages').add({
      'groupId': groupId,
      'senderId': senderId,
      'senderName': senderName,
      'senderEmail': senderEmail,
      'text': text,
      'fileUrl': fileUrl,
      'fileName': fileName,
      'fileType': fileType,
      'fileDescription': fileDescription,
      'timestamp': FieldValue.serverTimestamp(),
    });
  }

  // Create a new study group
  Future<void> createGroup(String name, String description, String creatorId) async {
    DocumentReference groupRef = await _firestore.collection('groups').add({
      'name': name,
      'description': description,
      'creatorId': creatorId,
      'members': [creatorId],
    });
    
    // Also update the user's groups sub-collection or array
    await _firestore.collection('users').doc(creatorId).update({
      'groups': FieldValue.arrayUnion([groupRef.id]),
    });
  }
}`,
    },
    storage: {
      name: "storage_service.dart",
      code: `import 'dart:io';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:path/path.dart' as path;

class StorageService {
  final FirebaseStorage _storage = FirebaseStorage.instance;

  // Upload an academic file (PDF/Video/Image) to Firebase Storage
  Future<Map<String, String>> uploadStudyFile({
    required File file,
    required String userId,
    required String groupId,
  }) async {
    String fileExt = path.extension(file.path);
    String fileName = '\${DateTime.now().millisecondsSinceEpoch}\$fileExt';
    
    // Create unique path in storage
    Reference ref = _storage
        .ref()
        .child('groups')
        .child(groupId)
        .child(userId)
        .child(fileName);

    // Start upload
    UploadTask uploadTask = ref.putFile(file);
    TaskSnapshot snapshot = await uploadTask;
    
    // Fetch download URL
    String downloadUrl = await snapshot.ref.getDownloadURL();
    
    // Return download url and original file details
    return {
      'url': downloadUrl,
      'name': path.basename(file.path),
      'type': _detectFileType(fileExt),
    };
  }

  String _detectFileType(String ext) {
    switch (ext.toLowerCase()) {
      case '.pdf':
        return 'PDF';
      case '.mp4':
      case '.mov':
      case '.avi':
        return 'Video';
      case '.png':
      case '.jpg':
      case '.jpeg':
        return 'Image';
      default:
        return 'Other';
    }
  }
}`,
    },
  };

  const cloudFunctionCode = `/**
 * Firebase Cloud Function for AI-Moderated "Gatekeeper" Chat
 * Triggered on every write to 'pending_messages' collection.
 * Powered by Gemini 2.0 Flash / 3.5 Flash for high-speed, cost-effective evaluation.
 */

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { initializeApp } = require("firebase-admin/app");
const { GoogleGenAI, Type } = require("@google/genai");

initializeApp();
const db = getFirestore();

// Initialize the GoogleGenAI Client with API Key stored in GCP Secret Manager
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY, // Set via cloud functions secret manager config
  httpOptions: {
    headers: { 'User-Agent': 'aistudio-build' }
  }
});

exports.gatekeeperModerator = onDocumentCreated({
  document: "pending_messages/{messageId}",
  secrets: ["GEMINI_API_KEY"], // Safe injection of secret keys
}, async (event) => {
  const snapshot = event.data;
  if (!snapshot) return null;

  const data = snapshot.data();
  const messageId = event.params.messageId;

  const text = data.text || "";
  const groupId = data.groupId;
  const senderId = data.senderId;
  const senderName = data.senderName;
  const fileName = data.fileName || "None";
  const fileType = data.fileType || "None";
  const fileDescription = data.fileDescription || "None";

  // Formulate Academic Context evaluation prompt
  const evaluationPrompt = \`
  Analyze the following chat post submitted to academic study group:
  - Message Text: "\${text}"
  - Attachment Name: "\${fileName}"
  - Attachment Type: "\${fileType}"
  - Attachment Description/Metadata: "\${fileDescription}"
  \`;

  try {
    // Query Gemini 3.5 Flash model with high-speed, low-latency config
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: evaluationPrompt,
      config: {
        systemInstruction: "You are an academic study assistant. Evaluate the provided message/file metadata. If it is relevant to educational studies, return 'APPROVED'. If it is social chatter, off-topic, or inappropriate, return 'REJECTED' along with a brief, polite explanation.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            status: {
              type: Type.STRING,
              enum: ["APPROVED", "REJECTED"],
            },
            explanation: {
              type: Type.STRING,
              description: "Short polite explanation of why it is off-topic if REJECTED. Keep empty if APPROVED.",
            }
          },
          required: ["status", "explanation"]
        }
      }
    });

    const result = JSON.parse(response.text.trim());
    
    if (result.status === "APPROVED") {
      // 1. Move message to permanent group messages
      await db.collection("groups").doc(groupId).collection("messages").add({
        senderId: senderId,
        senderName: senderName,
        senderEmail: data.senderEmail,
        text: text,
        fileUrl: data.fileUrl || null,
        fileName: data.fileName || null,
        fileType: data.fileType || null,
        fileDescription: data.fileDescription || null,
        timestamp: FieldValue.serverTimestamp(),
      });
      
      // 2. Delete original document from pending_messages
      await snapshot.ref.delete();
      console.log(\`Message \${messageId} APPROVED and moved.\`);
    } else {
      // 1. Write private warning notification in user sub-collection
      await db.collection("users").doc(senderId).collection("notifications").add({
        messageId: messageId,
        messageText: text || \`[File: \${fileName}]\`,
        explanation: result.explanation,
        timestamp: FieldValue.serverTimestamp(),
      });

      // 2. Delete from pending_messages
      await snapshot.ref.delete();
      console.log(\`Message \${messageId} REJECTED. Private warning sent to \${senderId}.\`);
    }
  } catch (error) {
    console.error("Gatekeeper Cloud Function Error:", error);
    // In case of error, default to safety (leave message in pending, or fail open for resilience)
  }
  return null;
});`;

  const firestoreRulesCode = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper function: Check if the user is a logged-in authenticated user
    function isAuthenticated() {
      return request.auth != null;
    }
    
    // Helper function: Check if user is a member of the requested study group
    function isGroupMember(groupId) {
      return isAuthenticated() && 
        resource.data.members.hasAny([request.auth.uid]) ||
        get(/databases/$(database)/documents/groups/$(groupId)).data.members.hasAny([request.auth.uid]);
    }

    // Rules for User Profiles
    match /users/{userId} {
      allow read: if isAuthenticated();
      // Users can only write their own profile
      allow write: if isAuthenticated() && request.auth.uid == userId;
      
      // Users can only read their private notification warnings
      match /notifications/{notiId} {
        allow read, write: if isAuthenticated() && request.auth.uid == userId;
      }
    }

    // Rules for Study Groups
    match /groups/{groupId} {
      // Any authenticated user can view group metadata to find a group to join
      allow read: if isAuthenticated();
      allow create: if isAuthenticated();
      allow update: if isAuthenticated() && request.resource.data.members.hasAny([request.auth.uid]);

      // Nested collection for approved messages
      // Security Enforcement: ONLY approved members of the group can read group messages
      match /messages/{messageId} {
        allow read: if isGroupMember(groupId);
        // Writing approved messages directly is strictly forbidden for clients!
        // Writing is only done server-side by our AI Gatekeeper Cloud Function
        allow write: if false; 
      }
    }

    // Rules for Pending Messages Queue
    match /pending_messages/{msgId} {
      // Users can write to the pending queue to submit messages for moderation
      allow create: if isAuthenticated() && request.resource.data.senderId == request.auth.uid;
      // No one can read directly from the pending queue (keeps moderation secret)
      allow read, update: if false;
      // Cloud Function handles deletions
      allow delete: if false; 
    }
  }
}`;

  return (
    <div id="code-guides-container" className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl text-slate-100">
      {/* Top Selector Panel */}
      <div className="flex flex-wrap items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/80">
        <div className="flex items-center gap-2">
          <FileCode className="w-5 h-5 text-sky-400" />
          <h2 className="text-md font-semibold tracking-tight">Technical Implementation Hub</h2>
        </div>
        <div className="flex items-center gap-1.5 p-1 bg-slate-900 rounded-lg border border-slate-800 text-xs mt-2 sm:mt-0">
          <button
            onClick={() => setActiveTab("flutter")}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              activeTab === "flutter" ? "bg-sky-500 text-slate-950" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Flutter Code
          </button>
          <button
            onClick={() => setActiveTab("function")}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              activeTab === "function" ? "bg-sky-500 text-slate-950" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Cloud Function
          </button>
          <button
            onClick={() => setActiveTab("rules")}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              activeTab === "rules" ? "bg-sky-500 text-slate-950" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Security Rules
          </button>
          <button
            onClick={() => setActiveTab("build")}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              activeTab === "build" ? "bg-sky-500 text-slate-950" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Build & Publish
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Tab 1: Flutter Client Code */}
        {activeTab === "flutter" && (
          <div className="space-y-4">
            <div className="flex items-start justify-between bg-slate-950 p-4 rounded-xl border border-slate-800">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-sky-400 flex items-center gap-2">
                  <Cpu className="w-4 h-4" /> Flutter integration with Firebase
                </h3>
                <p className="text-xs text-slate-400">
                  Dart implementations of persistent login, Gatekeeper pending uploads, and real-time Firestore listeners.
                </p>
              </div>
              <div className="flex gap-1.5 p-1 bg-slate-900 border border-slate-800 rounded-lg text-xs">
                {(["auth", "db", "storage"] as const).map((file) => (
                  <button
                    key={file}
                    onClick={() => setActiveFlutterFile(file)}
                    className={`px-2.5 py-1 rounded ${
                      activeFlutterFile === file ? "bg-slate-800 text-sky-400 font-medium" : "text-slate-400"
                    }`}
                  >
                    {flutterFiles[file].name}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative group">
              <div className="absolute top-3 right-3 z-10">
                <button
                  onClick={() =>
                    copyToClipboard(flutterFiles[activeFlutterFile].code, `flutter_${activeFlutterFile}`)
                  }
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors text-slate-300 hover:text-white"
                  title="Copy code"
                >
                  {copiedSection === `flutter_${activeFlutterFile}` ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
              <pre className="p-5 bg-slate-950 rounded-xl border border-slate-800 overflow-x-auto text-[13px] leading-relaxed text-slate-300 font-mono select-text h-[400px]">
                <code>{flutterFiles[activeFlutterFile].code}</code>
              </pre>
            </div>
          </div>
        )}

        {/* Tab 2: Firebase Cloud Function */}
        {activeTab === "function" && (
          <div className="space-y-4">
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
              <h3 className="text-sm font-semibold text-sky-400 flex items-center gap-2">
                <Server className="w-4 h-4" /> Gatekeeper Moderation Cloud Function
              </h3>
              <p className="text-xs text-slate-400">
                Node.js triggers on <strong>pending_messages</strong> created, sends context payload to Gemini 3.5 Flash, parses judgment, then handles document migration or alerts.
              </p>
            </div>

            <div className="relative group">
              <div className="absolute top-3 right-3 z-10">
                <button
                  onClick={() => copyToClipboard(cloudFunctionCode, "cloud_fn")}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors text-slate-300 hover:text-white"
                >
                  {copiedSection === "cloud_fn" ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
              <pre className="p-5 bg-slate-950 rounded-xl border border-slate-800 overflow-x-auto text-[13px] leading-relaxed text-slate-300 font-mono select-text h-[400px]">
                <code>{cloudFunctionCode}</code>
              </pre>
            </div>
          </div>
        )}

        {/* Tab 3: Firestore Security Rules */}
        {activeTab === "rules" && (
          <div className="space-y-4">
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
              <h3 className="text-sm font-semibold text-sky-400 flex items-center gap-2">
                <Shield className="w-4 h-4" /> Firestore Security Rules
              </h3>
              <p className="text-xs text-slate-400">
                Enforces member-only reading for groups while strictly forbidding users from writing directly to the approved messages collection. Only approved writers (our Server/Function) bypasses client checks.
              </p>
            </div>

            <div className="relative group">
              <div className="absolute top-3 right-3 z-10">
                <button
                  onClick={() => copyToClipboard(firestoreRulesCode, "rules")}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors text-slate-300 hover:text-white"
                >
                  {copiedSection === "rules" ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
              <pre className="p-5 bg-slate-950 rounded-xl border border-slate-800 overflow-x-auto text-[13px] leading-relaxed text-slate-300 font-mono select-text h-[400px]">
                <code>{firestoreRulesCode}</code>
              </pre>
            </div>
          </div>
        )}

        {/* Tab 4: Compilation and Distribution Guides */}
        {activeTab === "build" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 select-text">
            {/* Compile Section */}
            <div className="space-y-4 bg-slate-950/40 p-5 rounded-xl border border-slate-800/80">
              <h3 className="text-sm font-semibold text-sky-400 flex items-center gap-2 pb-2 border-b border-slate-800">
                <Layers className="w-4 h-4" /> Flutter Multi-Platform Compilation
              </h3>
              
              <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
                <div>
                  <h4 className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400"></span> Windows Desktop Build (.exe)
                  </h4>
                  <p className="text-slate-400 mb-2">Enable Windows desktop support in Flutter, then generate native C++ x64 binaries:</p>
                  <pre className="bg-slate-950 p-2.5 rounded border border-slate-850 font-mono text-[11px] text-sky-400">
                    flutter config --enable-windows-desktop{"\n"}
                    flutter build windows --release
                  </pre>
                  <p className="text-slate-500 mt-1">Output bundle location: <code className="font-mono text-slate-400">build/windows/x64/runner/Release/</code></p>
                </div>

                <div>
                  <h4 className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span> Android Release APK Build (.apk)
                  </h4>
                  <p className="text-slate-400 mb-2">Compile an optimized, self-contained single-architecture APK or App Bundle for Google Play:</p>
                  <pre className="bg-slate-950 p-2.5 rounded border border-slate-850 font-mono text-[11px] text-green-400">
                    # Builds a combined universal fat APK{"\n"}
                    flutter build apk --release{"\n"}
                    # Builds split APKs per CPU architecture to shrink size{"\n"}
                    flutter build apk --split-per-abi
                  </pre>
                  <p className="text-slate-500 mt-1">Output location: <code className="font-mono text-slate-400">build/app/outputs/flutter-apk/app-release.apk</code></p>
                </div>

                <div>
                  <h4 className="font-semibold text-slate-200 mb-1 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span> iOS App Archive (.ipa)
                  </h4>
                  <p className="text-slate-400 mb-2">Prepare an iOS release archive. Requires Xcode on a macOS host and an Apple Developer Account:</p>
                  <pre className="bg-slate-950 p-2.5 rounded border border-slate-850 font-mono text-[11px] text-indigo-400">
                    flutter build ipa --release --export-options-plist=ExportOptions.plist
                  </pre>
                  <p className="text-slate-500 mt-1">Output location: <code className="font-mono text-slate-400">build/ios/archive/Gatekeeper.xcarchive</code></p>
                </div>
              </div>
            </div>

            {/* Distribution Section */}
            <div className="space-y-4 bg-slate-950/40 p-5 rounded-xl border border-slate-800/80">
              <h3 className="text-sm font-semibold text-emerald-400 flex items-center gap-2 pb-2 border-b border-slate-800">
                <Settings className="w-4 h-4" /> Firebase App Distribution Flow
              </h3>
              
              <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
                <div>
                  <p className="text-slate-400">
                    Firebase App Distribution allows secure, instant private sharing to friends and reviewers on iOS, Android, and Windows without public app stores.
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold text-slate-200 mb-1">1. Setup Testers and Groups</h4>
                  <p className="text-slate-400">
                    Open Firebase Console &rarr; App Distribution. Click "Testers & Groups" and add your friends' emails. Define groups like <code className="font-mono text-emerald-400">"study-buddies"</code>.
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold text-slate-200 mb-1">2. Integrate CLI / Fastlane (Optional but Recommended)</h4>
                  <p className="text-slate-400">Distribute straight from your terminal or CI environment using npm firebase-tools:</p>
                  <pre className="bg-slate-950 p-2.5 rounded border border-slate-850 font-mono text-[11px] text-emerald-400">
                    # Install Firebase CLI{"\n"}
                    npm install -g firebase-tools{"\n"}
                    # Log in to your Firebase account{"\n"}
                    firebase login{"\n"}
                    # Distribute APK build to study-buddies{"\n"}
                    firebase appdistribution:distribute build/app/outputs/flutter-apk/app-release.apk \{"\n"}
                    &nbsp;&nbsp;--app YOUR_FIREBASE_APP_ID \{"\n"}
                    &nbsp;&nbsp;--groups "study-buddies" \{"\n"}
                    &nbsp;&nbsp;--release-notes "Gatekeeper Academic Chat with AI Moderation"
                  </pre>
                </div>

                <div>
                  <h4 className="font-semibold text-slate-200 mb-1">3. Tester Installation Experience</h4>
                  <ul className="list-disc pl-4 space-y-1.5 text-slate-400">
                    <li>
                      <strong>Android:</strong> Testers receive an email invitation. They download the App Distribution app and install the APK with one click.
                    </li>
                    <li>
                      <strong>iOS:</strong> Xcode builds must register tester device UDIDs in the Provisioning Profile. Testers accept the email invite and download via Safari.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
