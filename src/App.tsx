import React, { useState, useEffect, useRef } from "react";
import {
  User as UserIcon,
  MessageSquare,
  Send,
  Shield,
  FileText,
  AlertTriangle,
  RefreshCw,
  Plus,
  Compass,
  CheckCircle,
  XCircle,
  FileCode,
  ArrowRight,
  ArrowLeft,
  Database,
  Clock,
  Sparkles,
  Paperclip,
  Check,
  Eye,
  EyeOff,
  Cpu,
  Video,
  Image,
  Layers,
  Search,
  BookOpen,
  Info,
  Terminal,
  Lock,
  Unlock,
  Users,
  LogOut,
  Globe,
  PlusCircle,
  UserPlus,
  Youtube,
  FileSpreadsheet,
  File,
  Reply,
  Forward,
  Trash2,
  Bell,
  BellOff,
  Volume2,
  Smartphone,
  Monitor
} from "lucide-react";
import { User, Group, Message, Notification as GatekeeperNotification, GatekeeperLog, AppConfig } from "./types";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  updateDoc,
  deleteDoc,
  limit
} from "firebase/firestore";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  reload,
  type User as FirebaseUser,
} from "firebase/auth";
import { db, auth, api } from "./firebase";

const TEMP_EMAIL_DOMAINS = [
  "mailinator.com", "tempmail.com", "temp-mail.org", "10minutemail.com",
  "yopmail.com", "trashmail.com", "disposable.com", "generator.com", "fake.com",
  "guerrillamail.com", "sharklasers.com", "getairmail.com", "dispostable.com", "maildrop.cc",
  "tempmail.net", "tempmail.co", "crazymailing.com", "throwawaymail.com", "mailnesia.com",
  "disposablemail.com", "tempmailaddress.com", "safe-mail.net", "yopmail.fr", "yopmail.net",
];

function authErrorMessage(err: any): string {
  const code = String(err?.code || "");
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "Incorrect email or password.";
  if (code.includes("email-already-in-use")) return "An account with this email already exists. Sign in instead.";
  if (code.includes("weak-password")) return "Please choose a stronger password (at least 6 characters).";
  if (code.includes("invalid-email")) return "Please enter a valid email address.";
  if (code.includes("too-many-requests")) return "Too many attempts. Please wait a moment and try again.";
  if (code.includes("network-request-failed")) return "Network error. Check your connection and try again.";
  return err?.message || "Something went wrong. Please try again.";
}

export default function App() {
  // Authentication state: authUser is the Firebase Auth account, currentUser its profile in Firestore.
  // currentUser is only set once the email is verified and the profile exists.
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<User | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileUsername, setProfileUsername] = useState("");
  
  // Login / Signup Form States
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [regEmail, setRegEmail] = useState("");
  const [regName, setRegName] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  

  // Group creation States
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");

  // DM Optional Friendly Filter Toggle State
  const [friendlyFilterActive, setFriendlyFilterActive] = useState(false);

  // DB Data States
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroup, setActiveGroup] = useState<Group | null>(null);
  const [activeRecipient, setActiveRecipient] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [notifications, setNotifications] = useState<GatekeeperNotification[]>([]);
  const [appConfig, setAppConfig] = useState<AppConfig>({
    geminiActive: false,
    apiModel: "gemini-3.5-flash",
    fallbackEnabled: true,
  });

  // Chat UI / Input States
  const [messageText, setMessageText] = useState("");
  const [evaluating, setEvaluating] = useState(false);
  const [evalResult, setEvalResult] = useState<{ status: "APPROVED" | "REJECTED"; explanation: string; latency?: number } | null>(null);
  const [liveEvalField, setLiveEvalField] = useState<{ text: string; status: "APPROVED" | "REJECTED"; explanation: string; latencyMs: number; academicTopics?: string[]; safetyFlags?: string[]; geminiActive?: boolean } | null>(null);
  
  // Real File Upload & Scanning States
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tab states for Side panels
  const [leftTab, setLeftTab] = useState<"groups" | "dms" | "warnings">("groups");

  // Modal / Inline Add Member States
  const [showAddMemberPanel, setShowAddMemberPanel] = useState(false);
  const [searchMemberAccountName, setSearchMemberAccountName] = useState("");
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [groupSidebarTab, setGroupSidebarTab] = useState<"members" | "media">("members");
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  // DM Custom states: Chatted contacts & search
  const [chattedUserIds, setChattedUserIds] = useState<string[]>([]);
  const [dmSearchQuery, setDmSearchQuery] = useState("");
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [contactSearchQuery, setContactSearchQuery] = useState("");

  // AI Message & File Content Search Modal States
  const [showAiSearchModal, setShowAiSearchModal] = useState(false);
  const [aiSearchQuery, setAiSearchQuery] = useState("");
  const [aiSearchFileTypeFilter, setAiSearchFileTypeFilter] = useState<"all" | "files" | "text">("all");
  const [aiSearchScope, setAiSearchScope] = useState<"current" | "all">("current");
  const [aiSearchResults, setAiSearchResults] = useState<Array<{
    message: Message;
    score: number;
    matchReason: string;
    isFileMatch: boolean;
  }> | null>(null);
  const [aiSearchExplanation, setAiSearchExplanation] = useState("");
  const [aiSearchLoading, setAiSearchLoading] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  // Alert/Feedback toast
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // System-level Web & Native Notification configuration
  const [notifPermission, setNotifPermission] = useState<string>(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported"
  );
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Synthesize a pleasant chime using the Web Audio API (offline-friendly, native-compatible)
  const playNotificationSound = () => {
    if (!soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      
      const osc1 = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc1.frequency.setValueAtTime(880.00, ctx.currentTime + 0.12); // A5
      
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      
      osc1.connect(gain);
      gain.connect(ctx.destination);
      
      osc1.start();
      osc1.stop(ctx.currentTime + 0.45);
    } catch (e) {
      console.warn("Audio Context sound failed to play", e);
    }
  };

  // Request native push notification permissions
  const requestNotificationPermission = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      showToast("System notifications are not supported on this platform.", "error");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setNotifPermission(permission);
      if (permission === "granted") {
        showToast("System notifications successfully enabled!", "success");
        const testNotif = new Notification("Gatekeeper Chat", {
          body: "You will now receive desktop and system alerts for incoming messages.",
          icon: "/favicon.ico"
        });
        testNotif.onclick = () => window.focus();
        playNotificationSound();
      } else if (permission === "denied") {
        showToast("System notifications blocked. Enable them in browser settings.", "error");
      }
    } catch (e) {
      console.error("Failed to request notification permission", e);
    }
  };

  // Global message listener to trigger background system notifications for direct & group messages
  useEffect(() => {
    if (!currentUser) return;

    // Use current time to only alert on incoming messages sent *after* page mount
    const mountTimeStr = new Date().toISOString();

    const qGlobalMessages = query(
      collection(db, "messages"),
      where("audience", "array-contains", currentUser.uid),
      where("timestamp", ">=", mountTimeStr)
    );

    const unsubGlobal = onSnapshot(qGlobalMessages, (snapshot) => {
      if (snapshot.metadata.hasPendingWrites) return;

      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const msg = change.doc.data() as Message;
          
          // Only notify if sent by someone else
          if (msg.senderId !== currentUser.uid) {
            const isDMForMe = msg.recipientId === currentUser.uid && !msg.groupId;
            const isGroupForMe = msg.groupId && currentUser.groups.includes(msg.groupId);

            if (isDMForMe || isGroupForMe) {
              // Trigger pleasant web-audio sound
              playNotificationSound();

              // Trigger System Notification if permission is granted
              if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
                const notifTitle = msg.groupId 
                  ? `Study Room: ${groups.find(g => g.id === msg.groupId)?.name || "New Message"}` 
                  : `Direct Message from ${msg.senderName}`;
                
                const notifBody = msg.fileName 
                  ? `📎 [Attachment] ${msg.fileName}` 
                  : msg.text || "Sent a message";

                try {
                  const systemNotif = new Notification(notifTitle, {
                    body: notifBody,
                    icon: "/favicon.ico",
                    tag: msg.id, // prevent duplicate triggers
                  });
                  systemNotif.onclick = () => {
                    window.focus();
                  };
                } catch (err) {
                  console.error("Failed to display native system notification", err);
                }
              }
            }
          }
        }
      });
    });

    return () => {
      unsubGlobal();
    };
  }, [currentUser, groups, soundEnabled]);

  // Automatically request push notification permissions when a student is logged in, making notifications enabled by default
  useEffect(() => {
    if (currentUser && notifPermission === "default") {
      requestNotificationPermission();
    }
  }, [currentUser, notifPermission]);

  // Reply and Forward states
  const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);

  // Auto-scrolling refs
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Server status (Gemini on or fallback moderation)
  useEffect(() => {
    fetch("/api/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((config) => config && setAppConfig(config))
      .catch((err) => console.error("Config fetch error:", err));
  }, []);

  // Firebase Auth session (persisted by Firebase across reloads)
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setAuthUser(u);
      setAuthReady(true);
      if (!u) {
        setProfile(null);
        setProfileLoaded(false);
      }
    });
  }, []);

  // The signed-in user's own profile document (kept live: groups change when someone adds you)
  useEffect(() => {
    if (!authUser) return;
    setProfileLoaded(false);
    return onSnapshot(
      doc(db, "users", authUser.uid),
      (snap) => {
        setProfile(snap.exists() ? (snap.data() as User) : null);
        setProfileLoaded(true);
      },
      (err) => {
        console.error("Profile listener error:", err);
        setProfileLoaded(true);
      }
    );
  }, [authUser?.uid]);

  useEffect(() => {
    setCurrentUser(authUser?.emailVerified && profile ? profile : null);
  }, [authUser, authUser?.emailVerified, profile]);

  // Everyone's public profiles (for contacts) and the groups I belong to
  useEffect(() => {
    if (!currentUser) {
      setUsers([]);
      setGroups([]);
      return;
    }
    const unsubUsers = onSnapshot(collection(db, "users"), (snapshot) => {
      setUsers(snapshot.docs.map((d) => d.data() as User));
    }, (err) => console.error("Users listener error:", err));
    const unsubGroups = onSnapshot(
      query(collection(db, "groups"), where("members", "array-contains", currentUser.uid)),
      (snapshot) => {
        const list = snapshot.docs.map((d) => d.data() as Group);
        setGroups(list);
        // keep the open group's details (members) current
        setActiveGroup((g) => (g ? list.find((x) => x.id === g.id) || null : g));
      },
      (err) => console.error("Groups listener error:", err)
    );
    return () => {
      unsubUsers();
      unsubGroups();
    };
  }, [currentUser?.uid]);

  // Reset group info panel on active group change
  useEffect(() => {
    setShowGroupInfo(false);
  }, [activeGroup?.id]);

  // Listen to messages for the current active group or direct recipient in real-time
  useEffect(() => {
    if (!currentUser) {
      setMessages([]);
      return;
    }

    let unsubMessages: (() => void) | null = null;

    if (activeGroup) {
      const isMember = currentUser.groups.includes(activeGroup.id);
      if (!isMember) {
        setMessages([]);
        return;
      }

      const qMessages = query(
        collection(db, "messages"),
        where("groupId", "==", activeGroup.id),
        orderBy("timestamp", "asc")
      );

      unsubMessages = onSnapshot(qMessages, (snapshot) => {
        setMessages(snapshot.docs.map((d) => d.data() as Message));
      }, (err) => console.error("Group messages listener error:", err));
    } else if (activeRecipient) {
      // Direct 1-on-1 Messages: only this pair's conversation
      const dmKey = [currentUser.uid, activeRecipient.uid].sort().join("__");
      const qDm = query(collection(db, "messages"), where("dmKey", "==", dmKey), orderBy("timestamp", "asc"));
      unsubMessages = onSnapshot(qDm, (snapshot) => {
        setMessages(snapshot.docs.map((d) => d.data() as Message));
      }, (err) => console.error("DM listener error:", err));
    } else {
      setMessages([]);
    }

    return () => {
      if (unsubMessages) unsubMessages();
    };
  }, [activeGroup?.id, activeRecipient?.uid, currentUser?.uid, currentUser?.groups]);

  // Listen to notifications (warnings) for the current user in real-time
  useEffect(() => {
    if (!currentUser) {
      setNotifications([]);
      return;
    }

    const qNotifications = query(
      collection(db, "notifications"),
      where("userId", "==", currentUser.uid),
      orderBy("timestamp", "desc")
    );

    const unsubNotifications = onSnapshot(qNotifications, (snapshot) => {
      const warnsList: GatekeeperNotification[] = [];
      snapshot.forEach((doc) => {
        warnsList.push(doc.data() as GatekeeperNotification);
      });
      setNotifications(warnsList);
    });

    return () => {
      unsubNotifications();
    };
  }, [currentUser?.uid]);

  // Listen to the list of user IDs whom the current user has sent messages to
  useEffect(() => {
    if (!currentUser) {
      setChattedUserIds([]);
      return;
    }

    // Everyone I have a DM conversation with (sent or received)
    const qMyDMs = query(
      collection(db, "messages"),
      where("participants", "array-contains", currentUser.uid)
    );

    const unsub = onSnapshot(qMyDMs, (snapshot) => {
      const ids = new Set<string>();
      snapshot.forEach((doc) => {
        const msg = doc.data() as Message;
        (msg.participants || []).forEach((p) => p !== currentUser.uid && ids.add(p));
      });
      setChattedUserIds(Array.from(ids));
    }, (error) => {
      console.error("Failed to fetch chatted contacts:", error);
    });

    return unsub;
  }, [currentUser?.uid]);

  // Auto-scroll chat and logs
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, evaluating]);

  // Live, debounced evaluation of message text while typing
  useEffect(() => {
    let active = true;

    if (!messageText.trim()) {
      setLiveEvalField(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const trimmed = messageText.trim();
        const data = await api("/api/evaluate", {
          json: {
            text: trimmed,
            groupId: activeGroup?.id,
            friendlyPoliteFilter: !activeGroup ? friendlyFilterActive : undefined,
          },
        });
        if (!active) return;
        setLiveEvalField({
          text: trimmed,
          status: data.status,
          explanation: data.explanation || (data.status === "APPROVED" ? "Looks on-topic." : "Looks off-topic for this chat."),
          latencyMs: data.latencyMs || 0,
          geminiActive: data.geminiActive,
        });
      } catch (err) {
        console.error("Live evaluation preview error:", err);
      }
    }, 400);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [messageText, activeGroup?.id, friendlyFilterActive]);

  // Automatically clear previous message delivery rejection alert and live preview when user switches conversations/rooms
  useEffect(() => {
    setEvalResult(null);
    setLiveEvalField(null);
  }, [activeGroup?.id, activeRecipient?.uid]);

  // Automatically clear previous message delivery rejection alert when user starts typing a new message or changes attachments
  useEffect(() => {
    setEvalResult(null);
  }, [messageText, attachedFile]);

  // AI Message & File Search Execution Handler
  const handlePerformAiSearch = async (overrideQuery?: string) => {
    const queryToUse = overrideQuery !== undefined ? overrideQuery : aiSearchQuery;
    if (!queryToUse.trim()) {
      showToast("Please enter a keyword, filename, or topic to search.", "info");
      return;
    }

    setAiSearchLoading(true);
    try {
      const data = await api("/api/search-messages", {
        json: {
          query: queryToUse.trim(),
          fileTypeFilter: aiSearchFileTypeFilter,
          scope: aiSearchScope,
          groupId: aiSearchScope === "current" ? activeGroup?.id : undefined,
          recipientId: aiSearchScope === "current" && !activeGroup ? activeRecipient?.uid : undefined,
        },
      });
      setAiSearchResults(data.results || []);
      setAiSearchExplanation(data.aiExplanation || "Search complete.");
    } catch (err) {
      console.error("AI Search error:", err);
      showToast("Error executing AI search.", "error");
    } finally {
      setAiSearchLoading(false);
    }
  };

  const jumpToMessage = (msg: Message) => {
    if (msg.groupId) {
      const grp = groups.find(g => g.id === msg.groupId);
      if (grp) {
        setActiveGroup(grp);
        setActiveRecipient(null);
      }
    } else if (msg.recipientId) {
      if (msg.senderId === currentUser?.uid) {
        const rec = users.find(u => u.uid === msg.recipientId);
        if (rec) {
          setActiveRecipient(rec);
          setActiveGroup(null);
        }
      } else {
        const snd = users.find(u => u.uid === msg.senderId);
        if (snd) {
          setActiveRecipient(snd);
          setActiveGroup(null);
        }
      }
    }

    setShowAiSearchModal(false);
    setHighlightedMessageId(msg.id);

    setTimeout(() => {
      const el = document.getElementById(`chat-msg-${msg.id}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 150);

    setTimeout(() => {
      setHighlightedMessageId(null);
    }, 4000);
  };

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const isTempEmailClient = (email: string): boolean => {
    const parts = email.trim().toLowerCase().split("@");
    if (parts.length < 2) return true;
    return TEMP_EMAIL_DOMAINS.includes(parts[1]);
  };

  // Sign in with email + password (Firebase Auth)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail.trim() || !loginPassword) {
      showToast("Email and password are required.", "info");
      return;
    }
    setAuthBusy(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword);
      setLoginPassword("");
      if (cred.user.emailVerified) showToast("Welcome back!", "success");
    } catch (err) {
      showToast(authErrorMessage(err), "error");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!loginEmail.trim()) {
      showToast("Enter your email address above first.", "info");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, loginEmail.trim());
      showToast(`If an account exists for ${loginEmail.trim()}, a password reset email is on its way.`, "success");
    } catch (err) {
      showToast(authErrorMessage(err), "error");
    }
  };

  // Create an account: Firebase Auth user, then the profile (server checks the username is free), then a verification email
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim() || !regUsername.trim() || !regPassword || !regEmail.trim()) {
      showToast("Please fill in all registration fields.", "info");
      return;
    }
    if (regPassword.length < 6) {
      showToast("Password must be at least 6 characters.", "error");
      return;
    }
    if (isTempEmailClient(regEmail)) {
      showToast("Temporary/disposable email domains are not allowed.", "error");
      return;
    }
    const usernameLower = regUsername.trim().toLowerCase();
    if (!/^[a-z0-9_.]{3,24}$/.test(usernameLower)) {
      showToast("Usernames are 3–24 characters: letters, numbers, dots and underscores.", "error");
      return;
    }
    setAuthBusy(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, regEmail.trim(), regPassword);
      try {
        await api("/api/profile", { json: { name: regName.trim(), username: usernameLower } });
      } catch (err: any) {
        // The account exists; the "finish your profile" step lets them pick another username.
        setProfileName(regName.trim());
        showToast(err.message, "error");
      }
      await sendEmailVerification(cred.user);
      setRegPassword("");
      showToast(`Account created. We sent a verification link to ${cred.user.email}.`, "success");
    } catch (err) {
      showToast(authErrorMessage(err), "error");
    } finally {
      setAuthBusy(false);
    }
  };

  // Signed in but no profile yet (e.g. the username was taken at sign-up)
  const handleCompleteProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    try {
      await api("/api/profile", { json: { name: profileName.trim(), username: profileUsername.trim().toLowerCase() } });
      showToast("Profile saved.", "success");
    } catch (err: any) {
      showToast(err.message, "error");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleResendVerification = async () => {
    if (!auth.currentUser) return;
    setAuthBusy(true);
    try {
      await sendEmailVerification(auth.currentUser);
      showToast(`Verification email sent to ${auth.currentUser.email}.`, "success");
    } catch (err) {
      showToast(authErrorMessage(err), "error");
    } finally {
      setAuthBusy(false);
    }
  };

  // After clicking the link in the email: refresh the account and its token
  const handleCheckVerified = async () => {
    if (!auth.currentUser) return;
    setAuthBusy(true);
    try {
      await reload(auth.currentUser);
      if (auth.currentUser.emailVerified) {
        await auth.currentUser.getIdToken(true);
        setAuthUser(Object.assign(Object.create(Object.getPrototypeOf(auth.currentUser)), auth.currentUser));
        showToast("Email verified. Welcome!", "success");
      } else {
        showToast("Not verified yet. Click the link in the email, then try again.", "info");
      }
    } catch (err) {
      showToast(authErrorMessage(err), "error");
    } finally {
      setAuthBusy(false);
    }
  };

  // Logout
  const handleLogout = async () => {
    await signOut(auth);
    setActiveGroup(null);
    setActiveRecipient(null);
    setMessages([]);
    showToast("Signed out.", "info");
  };

  // Group Management: Dynamic Custom Group Creation
  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!newGroupName.trim() || !newGroupDescription.trim()) {
      showToast("Group name and dynamic topic criteria are required.", "info");
      return;
    }
    try {
      const { group } = await api<{ group: Group }>("/api/groups", {
        json: { name: newGroupName.trim(), description: newGroupDescription.trim() },
      });
      setNewGroupName("");
      setNewGroupDescription("");
      setShowCreateGroupModal(false);
      setActiveGroup(group);
      setActiveRecipient(null);
      showToast(`Group "${group.name}" created! Topic guardrails are active.`, "success");
    } catch (err: any) {
      showToast(err.message || "Error creating group. Try again.", "error");
    }
  };

  // Invite/Add someone to the active group
  const handleAddMemberToGroup = async (userIdToAdd: string) => {
    if (!currentUser || !activeGroup) return;
    const userToAdd = users.find((u) => u.uid === userIdToAdd);
    try {
      await api(`/api/groups/${activeGroup.id}/members`, { json: { userId: userIdToAdd } });
      showToast(`Added ${userToAdd?.name || "them"} to this group!`, "success");
      setShowAddMemberPanel(false);
    } catch (err: any) {
      showToast(err.message || "Failed to add member.", "error");
    }
  };

  // Leave the active group
  const handleLeaveGroup = async () => {
    if (!currentUser || !activeGroup) return;
    const name = activeGroup.name;
    try {
      await api(`/api/groups/${activeGroup.id}/leave`, { json: {} });
      setShowLeaveConfirm(false);
      setActiveGroup(null);
      showToast(`You have left "${name}".`, "success");
    } catch (err: any) {
      showToast(err.message || "Failed to leave the group.", "error");
    }
  };

  // Send a message. The server moderates it and stores it only if approved.
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!activeGroup && !activeRecipient) {
      showToast("Please choose a group or DM contact.", "info");
      return;
    }
    const hasText = messageText.trim().length > 0;
    if (!hasText && !attachedFile) {
      showToast("Please write a message or attach a file.", "info");
      return;
    }
    if (attachedFile && !fileBase64) {
      showToast("Still reading the attached file. Try again in a moment.", "info");
      return;
    }

    setEvaluating(true);
    setEvalResult(null);
    try {
      const data = await api("/api/messages", {
        json: {
          groupId: activeGroup?.id,
          recipientId: activeGroup ? undefined : activeRecipient?.uid,
          text: hasText ? messageText : undefined,
          file: attachedFile ? { name: attachedFile.name, mimeType: attachedFile.type, base64: fileBase64 } : undefined,
          friendlyPoliteFilter: !activeGroup ? friendlyFilterActive : undefined,
          replyToId: replyingToMessage?.id,
        },
      });
      if (data.status === "APPROVED") {
        setEvalResult(null);
        setLiveEvalField(null);
        setMessageText("");
        setAttachedFile(null);
        setFileBase64("");
        if (fileInputRef.current) fileInputRef.current.value = "";
        setReplyingToMessage(null);
      } else {
        setLiveEvalField(null);
        setEvalResult({ status: "REJECTED", explanation: data.explanation, latency: data.latencyMs });
        showToast("Message could not be delivered.", "error");
      }
    } catch (err: any) {
      showToast(err.message || "Sending failed.", "error");
    } finally {
      setEvaluating(false);
    }
  };

  // Delete a message you sent
  const handleDeleteMessage = async (messageId: string) => {
    if (!currentUser) return;
    try {
      await api(`/api/messages/${messageId}`, { method: "DELETE" });
      showToast("Message deleted.", "success");
    } catch (err: any) {
      showToast(err.message || "Failed to delete message.", "error");
    }
  };

  // Forward a message to a group or person (moderated for the destination)
  const handleForwardMessage = async (destGroupId?: string, destRecipientId?: string) => {
    if (!currentUser || !forwardingMessage) return;
    const original = forwardingMessage;
    setEvaluating(true);
    setEvalResult(null);
    setForwardingMessage(null);
    try {
      const data = await api("/api/messages", {
        json: { groupId: destGroupId, recipientId: destRecipientId, forwardOfId: original.id },
      });
      if (data.status === "APPROVED") {
        showToast("Message forwarded!", "success");
      } else {
        setEvalResult({ status: "REJECTED", explanation: data.explanation, latency: data.latencyMs });
        showToast("Forwarded message blocked by Gatekeeper.", "error");
      }
    } catch (err: any) {
      showToast(err.message || "Error forwarding the message.", "error");
    } finally {
      setEvaluating(false);
    }
  };

  // Open an attachment: the server checks you can read the message, then sends the file
  const openAttachment = async (m: Message) => {
    const win = window.open("", "_blank");
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`/api/messages/${m.id}/file`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not open the file.");
      }
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url;
      else {
        const a = document.createElement("a");
        a.href = url;
        a.download = m.fileName || "file";
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err: any) {
      win?.close();
      showToast(err.message || "Could not open the file.", "error");
    }
  };

  // Dismiss a moderation warning
  const dismissWarning = async (id: string) => {
    try {
      await deleteDoc(doc(db, "notifications", id));
    } catch (err) {
      console.error("Failed to dismiss warning", err);
    }
  };

  // Read the attached file (sent to the server, which moderates and stores it)
  const processAttachedFile = (file: File) => {
    setFileBase64("");
    if (file.size > 5 * 1024 * 1024) {
      showToast("File size must be under 5MB.", "error");
      setAttachedFile(null);
      return;
    }
    setAttachedFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = String(e.target?.result || "");
      setFileBase64(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => showToast("Could not read that file.", "error");
    reader.readAsDataURL(file);
    showToast(`Attached ${file.name}`, "info");
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processAttachedFile(e.target.files[0]);
    }
  };

  // Drag and drop attachment helper
  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processAttachedFile(e.dataTransfer.files[0]);
    }
  };

  // Determine active conversation header names
  const conversationTitle = activeGroup
    ? activeGroup.name
    : activeRecipient
    ? `Direct Message: @${activeRecipient.username}`
    : "Select a Study Room or Direct Message";

  const conversationSub = activeGroup
    ? activeGroup.description
    : activeRecipient
    ? `${activeRecipient.name} (Direct Chat - Private & instant)`
    : "Keep discussion strictly focused on your curriculum to pass the moderator's filter.";

  // Authorization state check for activeGroup
  const isAuthorizedInGroup = activeGroup
    ? currentUser?.groups.includes(activeGroup.id)
    : true; // Always authorized for DMs

  return (
    <div className="flex flex-col h-screen bg-white font-sans text-slate-800 overflow-hidden">
      
      {/* Toast Notification Container */}
      {toast && (
        <div
          id="toast-alert"
          className={`fixed top-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl transition-all animate-bounce ${
            toast.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : toast.type === "error"
              ? "bg-rose-50 border-rose-200 text-rose-800"
              : "bg-sky-50 border-sky-200 text-sky-800"
          }`}
        >
          {toast.type === "success" && <CheckCircle className="w-5 h-5 text-emerald-600" />}
          {toast.type === "error" && <XCircle className="w-5 h-5 text-rose-600" />}
          {toast.type === "info" && <Info className="w-5 h-5 text-sky-600" />}
          <span className="text-xs font-semibold">{toast.message}</span>
        </div>
      )}

      {/* Top Main Navigation Header */}
      <header id="app-header" className={`flex items-center justify-between px-6 py-4 shrink-0 transition-colors ${!currentUser ? "bg-slate-50 border-b border-slate-50" : "bg-white border-b border-slate-200"}`}>
        <div className="flex items-start sm:items-center gap-3">
          <div className="flex items-center justify-center w-11 sm:w-12 h-11 sm:h-12 rounded-xl bg-gradient-to-tr from-indigo-500 to-sky-500 shadow-md shadow-sky-500/10 shrink-0">
            <BookOpen className="w-5 sm:w-6 h-5 sm:h-6 text-white" />
          </div>
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
              <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-900">Gatekeeper Universal Chat</h1>
              <span className="inline-block w-fit px-2 py-0.5 text-[8px] sm:text-[9px] font-extrabold bg-indigo-50 text-indigo-700 rounded-full border border-indigo-150 uppercase tracking-wide whitespace-nowrap">
                Topic-Enforced Platform
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-500 leading-tight mt-0.5 sm:mt-0">All-purpose chat with groups and DMs, featuring topic-enforcement and optional friendly filters.</p>
          </div>
        </div>

        {currentUser && (
          <button
            onClick={() => {
              setAiSearchResults(null);
              setAiSearchExplanation("");
              setShowAiSearchModal(true);
            }}
            className="px-3 py-1.5 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-sm flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
            title="Search messages and attached files using AI"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-200 animate-pulse" />
            <span className="hidden sm:inline">✨ AI Search Messages & Files</span>
            <span className="sm:hidden">✨ AI Search</span>
          </button>
        )}


      </header>

      {/* Main Container Content */}
      {!currentUser ? (
        // SIMPLIFIED SIGN UP / LOGIN PAGE
        <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 bg-slate-50 overflow-y-auto">
          <div className="w-full max-w-md md:max-w-4xl grid grid-cols-1 md:grid-cols-12 gap-8 items-center mx-auto">
            
            {/* Left Side: Pitch and Seed Users (Desktop/Tablet only) */}
            <div className="hidden md:block md:col-span-7 space-y-6 text-left mt-0">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-50 border border-sky-200 text-[11px] text-sky-700 font-bold uppercase tracking-wider">
                <BookOpen className="w-3.5 h-3.5" /> Topic Enforced Chats
              </div>
              
              <h2 className="text-3xl font-extrabold text-slate-900 leading-tight">
                Focused discussions, <br/>
                <span className="bg-gradient-to-r from-sky-600 to-indigo-600 bg-clip-text text-transparent">zero off-topic noise.</span>
              </h2>
              
              <p className="text-slate-600 text-sm leading-relaxed max-w-md">
                Welcome to Gatekeeper Universal Chat. A focused space for your custom groups, private discussions, and media-rich sharing.
              </p>

              <div className="bg-white rounded-2xl p-5 border border-slate-200 space-y-3 max-w-md shadow-sm">
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                  <Shield className="w-4 h-4 text-indigo-600" /> Topic Enforcement System
                </h4>
                <ul className="space-y-2 text-xs text-slate-600 leading-relaxed">
                  <li className="flex items-start gap-2">
                    <span className="text-sky-600 font-bold">•</span>
                    <span><strong>Moderated Channels:</strong> Every message, file, or video link in group chats is screened in real-time by the Gatekeeper AI to align strictly with the group's custom topic.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-sky-600 font-bold">•</span>
                    <span><strong>Custom Groups:</strong> Create your own groups for any topic (e.g., Inorganic Chemistry, Family Time, Study Group) with custom guidelines.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-sky-600 font-bold">•</span>
                    <span><strong>Verified Accounts:</strong> Sign up with your email and confirm it from the link we send. Disposable email addresses are not accepted.</span>
                  </li>
                </ul>
              </div>
            </div>
 
            {/* Right Side: Form Block (Login or Sign Up with passwords) */}
            <div className="md:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-left space-y-4">
              {!authUser && (
              <div className="flex border-b border-slate-200 shrink-0">
                <button
                  type="button"
                  onClick={() => setAuthMode("login")}
                  className={`flex-1 pb-2.5 text-center text-xs font-bold transition-all border-b-2 ${
                    authMode === "login" ? "border-sky-500 text-sky-600" : "border-transparent text-slate-400 hover:text-slate-700"
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode("register")}
                  className={`flex-1 pb-2.5 text-center text-xs font-bold transition-all border-b-2 ${
                    authMode === "register" ? "border-sky-500 text-sky-600" : "border-transparent text-slate-400 hover:text-slate-700"
                  }`}
                >
                  Create Account
                </button>
              </div>
              )}
 
              {!authReady || (authUser && !profileLoaded) ? (
                <div className="py-10 text-center text-xs text-slate-500">Loading…</div>
              ) : authUser && !authUser.emailVerified ? (
                <div className="space-y-4 text-xs">
                  <h3 className="text-sm font-bold text-slate-800">Verify your email</h3>
                  <p className="text-slate-600 leading-relaxed">
                    We sent a verification link to <strong>{authUser.email}</strong>. Open it, then come back and press the button below.
                    Check your spam folder if you can't find it.
                  </p>
                  <button type="button" onClick={handleCheckVerified} disabled={authBusy} className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg shadow-sm cursor-pointer flex items-center justify-center gap-1.5 transition-all text-xs disabled:opacity-50">
                    {authBusy ? "Checking..." : "I've verified my email"} <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <div className="flex gap-2">
                    <button type="button" onClick={handleResendVerification} disabled={authBusy} className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg cursor-pointer transition-all text-xs disabled:opacity-50">
                      Resend email
                    </button>
                    <button type="button" onClick={handleLogout} className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg cursor-pointer transition-all text-xs">
                      Use another account
                    </button>
                  </div>
                </div>
              ) : authUser && !profile ? (
                <form onSubmit={handleCompleteProfile} className="space-y-4 text-xs">
                  <h3 className="text-sm font-bold text-slate-800">Finish your profile</h3>
                  <p className="text-slate-600">Choose the name and username other people will see.</p>
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase">Your Full Name</label>
                        <input
                          type="text"
                          required
                          value={profileName}
                          onChange={(e) => setProfileName(e.target.value)}
                          placeholder="e.g. David Thompson"
                          className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:bg-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase">Choose a Username</label>
                        <input
                          type="text"
                          required
                          value={profileUsername}
                          onChange={(e) => setProfileUsername(e.target.value)}
                          placeholder="e.g. david99"
                          className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:bg-white"
                        />
                      </div>
                  <button type="submit" disabled={authBusy} className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg shadow-sm cursor-pointer flex items-center justify-center gap-1.5 transition-all text-xs disabled:opacity-50">
                    {authBusy ? "Saving..." : "Save profile"} <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={handleLogout} className="w-full text-slate-500 hover:text-slate-800 text-[11px] cursor-pointer">Sign out</button>
                </form>
              ) : authMode === "login" ? (
                <div className="space-y-4 text-xs">
                    <form onSubmit={handleLogin} className="space-y-4">
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase">Your Email Address</label>
                        <input
                          type="email"
                          required
                          value={loginEmail}
                          onChange={(e) => setLoginEmail(e.target.value)}
                          placeholder="you@school.edu"
                          autoComplete="email"
                          className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:bg-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase">Password</label>
                        <div className="relative">
                          <input
                            type={showLoginPassword ? "text" : "password"}
                            required
                            value={loginPassword}
                            onChange={(e) => setLoginPassword(e.target.value)}
                            placeholder="Enter your password"
                            autoComplete="current-password"
                            className="w-full pl-3.5 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:bg-white"
                          />
                          <button
                            type="button"
                            onClick={() => setShowLoginPassword(!showLoginPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors focus:outline-none"
                          >
                            {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      <button type="submit" disabled={authBusy} className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg shadow-sm cursor-pointer flex items-center justify-center gap-1.5 transition-all text-xs disabled:opacity-50">
                        {authBusy ? "Signing in..." : "Sign In"} <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={handleForgotPassword} className="w-full text-sky-600 hover:underline text-[11px] cursor-pointer">
                        Forgot your password?
                      </button>
                    </form>
                </div>
              ) : (
                <div className="space-y-4 text-xs">
                    <form onSubmit={handleRegister} className="space-y-4">
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase">Your Full Name</label>
                        <input
                          type="text"
                          required
                          value={regName}
                          onChange={(e) => setRegName(e.target.value)}
                          placeholder="e.g. David Thompson"
                          className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:bg-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase">Choose a Username</label>
                        <input
                          type="text"
                          required
                          value={regUsername}
                          onChange={(e) => setRegUsername(e.target.value)}
                          placeholder="e.g. david99"
                          className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:bg-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase">Your Email Address</label>
                        <input
                          type="email"
                          required
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          placeholder="you@school.edu"
                          autoComplete="email"
                          className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:bg-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase">Password</label>
                        <div className="relative">
                          <input
                            type={showRegPassword ? "text" : "password"}
                            required
                            value={regPassword}
                            onChange={(e) => setRegPassword(e.target.value)}
                            placeholder="At least 6 characters"
                            autoComplete="new-password"
                            className="w-full pl-3.5 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:bg-white"
                          />
                          <button
                            type="button"
                            onClick={() => setShowRegPassword(!showRegPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors focus:outline-none"
                          >
                            {showRegPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      <button type="submit" disabled={authBusy} className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg shadow-sm cursor-pointer flex items-center justify-center gap-1.5 transition-all text-xs disabled:opacity-50">
                        {authBusy ? "Creating account..." : "Create Account"} <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                      <p className="text-[10px] text-slate-500 leading-relaxed">We'll email you a link to confirm your address before you can chat.</p>
                    </form>
                </div>
              )}
            </div>

          </div>
        </main>
      ) : (
        // THE FULL LOGGED IN CHAT INTERFACE WITH DIRECT MESSAGING & AUTHORIZATION ACCESS BLOCKS
        <div className="flex flex-1 overflow-hidden">
          
          {/* Left Column: Navigation rooms & private DMs */}
          <aside id="sidebar-panel" className={`w-full md:w-80 border-r border-slate-200 bg-slate-50 flex flex-col shrink-0 ${activeGroup || activeRecipient ? "hidden md:flex" : "flex"}`}>
            
            {/* Active User Persona Badge with Logout */}
            <div className="p-4 border-b border-slate-200 bg-slate-100/30">
              <div className="flex items-center justify-between">
                <label className="block text-[10px] font-bold text-sky-700 uppercase tracking-wider">Signed in as</label>
                <button
                  onClick={handleLogout}
                  className="text-slate-500 hover:text-rose-600 flex items-center gap-1 text-[10px] font-bold transition-colors cursor-pointer"
                  title="Sign out of student account"
                >
                  <LogOut className="w-3 h-3" /> Sign Out
                </button>
              </div>

              <div className="flex items-center justify-start mt-2 p-2.5 rounded-xl bg-white border border-slate-200">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-sky-50 text-sky-600 font-extrabold border border-sky-100 text-xs">
                    {currentUser.name.split(" ").map(n => n[0]).join("")}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-semibold text-slate-800 truncate">{currentUser.name}</h4>
                    <p className="text-[10px] text-slate-500 truncate">@{currentUser.username}</p>
                  </div>
                </div>
              </div>

              {/* Native App Notifications Controller */}
              <div className="mt-2.5 p-2 rounded-xl bg-slate-50 border border-slate-200/80 text-[10px] space-y-1.5 text-left">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-700 flex items-center gap-1">
                    <Bell className="w-3 h-3 text-sky-600" /> App Push Notifications
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSoundEnabled(!soundEnabled)}
                      className={`p-1 rounded hover:bg-slate-200 transition-colors cursor-pointer ${
                        soundEnabled ? "text-sky-600" : "text-slate-400"
                      }`}
                      title={soundEnabled ? "Mute notification sounds" : "Unmute notification sounds"}
                    >
                      {soundEnabled ? <Volume2 className="w-3 h-3" /> : <BellOff className="w-3 h-3" />}
                    </button>
                    <span className={`px-1.5 py-0.5 rounded-md font-bold text-[8px] uppercase tracking-wider ${
                      notifPermission === "granted"
                        ? "bg-emerald-100 text-emerald-800"
                        : notifPermission === "denied"
                        ? "bg-rose-100 text-rose-800"
                        : "bg-amber-100 text-amber-800"
                    }`}>
                      {notifPermission === "granted" ? "Active" : notifPermission === "denied" ? "Blocked" : "Disabled"}
                    </span>
                  </div>
                </div>

                {notifPermission !== "granted" ? (
                  <button
                    onClick={requestNotificationPermission}
                    className="w-full py-1 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg text-[9px] flex items-center justify-center gap-1 transition-all cursor-pointer shadow-sm shadow-sky-100"
                  >
                    <Smartphone className="w-3 h-3" /> Enable App Push Popups
                  </button>
                ) : (
                  <div className="flex items-center justify-between text-slate-500 text-[9px] leading-tight">
                    <span className="flex items-center gap-0.5">
                      <Monitor className="w-3 h-3 text-emerald-500" /> System alerts on
                    </span>
                    <button
                      onClick={() => {
                        // Trigger test
                        const testNotif = new Notification("Gatekeeper Chat", {
                          body: "Great! Native system push alerts are fully working.",
                          icon: "/favicon.ico"
                        });
                        testNotif.onclick = () => window.focus();
                        playNotificationSound();
                      }}
                      className="text-sky-600 hover:underline font-bold"
                    >
                      Test Send
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar Tabs (Study Rooms vs Direct Messages vs Alerts) */}
            <div className="flex border-b border-slate-200 text-[10px] bg-slate-100/50 shrink-0 font-bold">
              <button
                onClick={() => setLeftTab("groups")}
                className={`flex-1 py-3 text-center border-b-2 transition-all flex items-center justify-center gap-1 ${
                  leftTab === "groups"
                    ? "border-sky-500 text-sky-600 bg-white"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                <Users className="w-3.5 h-3.5" /> Rooms
              </button>
              <button
                onClick={() => setLeftTab("dms")}
                className={`flex-1 py-3 text-center border-b-2 transition-all flex items-center justify-center gap-1 ${
                  leftTab === "dms"
                    ? "border-sky-500 text-sky-600 bg-white"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" /> DMs (1-on-1)
              </button>
              <button
                onClick={() => setLeftTab("warnings")}
                className={`flex-1 py-3 text-center border-b-2 transition-all flex items-center justify-center gap-1 relative ${
                  leftTab === "warnings"
                    ? "border-sky-500 text-sky-600 bg-white"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" /> Warnings
                {notifications.length > 0 && (
                  <span className="absolute top-2.5 right-1 px-1.5 py-0.5 text-[8px] font-extrabold bg-rose-500 text-white rounded-full leading-none scale-90">
                    {notifications.length}
                  </span>
                )}
              </button>
            </div>

            {/* Tab content area */}
            <div className="flex-1 overflow-y-auto p-3">
              {leftTab === "groups" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between px-1">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Chat Groups</div>
                    <button
                      onClick={() => setShowCreateGroupModal(true)}
                      className="px-2 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-[10px] font-bold flex items-center gap-1 shadow-sm transition-all cursor-pointer"
                    >
                      + Create Group
                    </button>
                  </div>
                  {groups.filter((g) => currentUser?.groups.includes(g.id)).length === 0 ? (
                    <div className="text-center py-8 text-xs text-slate-500 border border-slate-200 border-dashed rounded-xl p-4 bg-slate-50/50">
                      You haven't created or joined any chat groups yet.
                      <p className="mt-2 text-[10px] text-slate-500 leading-normal">
                        Click the <strong>"+ Create Group"</strong> button above to launch your custom chat group and invite other members!
                      </p>
                    </div>
                  ) : (
                    groups
                      .filter((g) => currentUser?.groups.includes(g.id))
                      .map((g) => {
                        const isActive = activeGroup?.id === g.id;

                        return (
                          <div
                            key={g.id}
                            className={`p-3 rounded-xl border transition-all text-left ${
                              isActive
                                ? "bg-white border-sky-500/50 shadow-sm shadow-sky-500/5"
                                : "bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <h4 className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                                  <BookOpen className="w-3.5 h-3.5 text-sky-600" />
                                  {g.name}
                                </h4>
                                <p className="text-[10px] text-slate-500 line-clamp-2 mt-1">{g.description}</p>
                              </div>
                            </div>

                            <div className="mt-2.5 flex items-center justify-between">
                              <span className="text-[9px] text-slate-500 font-semibold flex items-center gap-1">
                                <Users className="w-3 h-3" />
                                {g.members.length} student{g.members.length !== 1 ? "s" : ""}
                              </span>
                              
                              <button
                                onClick={() => {
                                  setActiveGroup(g);
                                  setActiveRecipient(null);
                                }}
                                className={`px-2 py-1 rounded text-[10px] font-bold transition-all cursor-pointer ${
                                  isActive
                                    ? "bg-sky-50 text-sky-600 border border-sky-100 cursor-default"
                                    : "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
                                }`}
                              >
                                {isActive ? "Viewing Chat" : "Enter Room"}
                              </button>
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              )}

              {leftTab === "dms" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between px-1">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Chat Contacts</div>
                    <button
                      onClick={() => {
                        setContactSearchQuery("");
                        setShowAddContactModal(true);
                      }}
                      className="px-2 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-[10px] font-bold flex items-center gap-1 shadow-sm transition-all cursor-pointer"
                    >
                      <UserPlus className="w-3 h-3" /> Add Contact
                    </button>
                  </div>

                  {/* Search box for chatted contacts */}
                  <div className="relative px-1">
                    <input
                      type="text"
                      placeholder="Search contacts..."
                      value={dmSearchQuery}
                      onChange={(e) => setDmSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-sky-500 font-medium"
                    />
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    {dmSearchQuery && (
                      <button
                        onClick={() => setDmSearchQuery("")}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold text-xs"
                      >
                        &times;
                      </button>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    {(() => {
                      const chatted = users.filter(u => u.uid !== currentUser.uid && chattedUserIds.includes(u.uid));
                      const filtered = chatted.filter(u => {
                        if (!dmSearchQuery.trim()) return true;
                        const queryLower = dmSearchQuery.trim().toLowerCase();
                        return (
                          u.name.toLowerCase().includes(queryLower) ||
                          u.username.toLowerCase().includes(queryLower) ||
                          (u.email || "").toLowerCase().includes(queryLower)
                        );
                      });

                      if (chatted.length === 0) {
                        return (
                          <div className="text-center py-8 text-xs text-slate-500 border border-slate-200 border-dashed rounded-xl p-4 bg-slate-50/50">
                            No active chats yet.
                            <p className="mt-2 text-[10px] text-slate-400 leading-normal">
                              Click the <strong>"Add Contact"</strong> button above to search the student directory and start a new direct 1-on-1 discussion!
                            </p>
                          </div>
                        );
                      }

                      if (filtered.length === 0) {
                        return (
                          <div className="text-center py-6 text-xs text-slate-400">
                            No contacts matched "{dmSearchQuery}"
                          </div>
                        );
                      }

                      return filtered.map((u) => {
                        const isActive = activeRecipient?.uid === u.uid;
                        const initial = u.name.split(" ").map(n => n[0]).join("");
                        
                        return (
                          <button
                            key={u.uid}
                            onClick={() => {
                              setActiveRecipient(u);
                              setActiveGroup(null);
                            }}
                            className={`w-full p-2.5 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                              isActive
                                ? "bg-white border-sky-500/50 shadow-sm"
                                : "bg-white border-transparent hover:bg-slate-50 hover:border-slate-200"
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 text-slate-650 font-bold text-[11px] flex items-center justify-center shrink-0">
                                {initial}
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-xs text-slate-800 truncate">{u.name}</div>
                                <div className="text-[9px] text-slate-500 font-mono truncate">@{u.username}</div>
                              </div>
                            </div>
                            
                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                          </button>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}

              {leftTab === "warnings" && (
                <div className="space-y-3 text-left">
                  <div className="flex items-start gap-1.5 p-2 bg-rose-50 border border-rose-100 rounded-lg text-[10px] text-rose-800">
                    <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                    <p>Blocked posts are stored privately here for your personal reference. Other users cannot view them.</p>
                  </div>
                  
                  {notifications.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center text-slate-400">
                      <CheckCircle className="w-8 h-8 text-slate-300 mb-2" />
                      <p className="text-xs font-semibold">Excellent Topic Focus</p>
                      <p className="text-[9px] text-slate-400 mt-1">No moderated warnings issued to your account.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {notifications.map((n) => (
                        <div key={n.id} className="p-3 bg-white border border-rose-200 rounded-xl relative overflow-hidden shadow-sm">
                          <div className="absolute top-0 left-0 bottom-0 w-1 bg-rose-500"></div>
                          <div className="flex items-center justify-between text-[9px] text-slate-500 mb-1">
                            <span className="font-bold text-rose-600 flex items-center gap-0.5">
                              <Shield className="w-3 h-3" /> System Alert
                            </span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5" />
                              {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              <button
                                onClick={() => dismissWarning(n.id)}
                                className="ml-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                                title="Dismiss this warning"
                              >
                                <XCircle className="w-3 h-3" />
                              </button>
                            </span>
                          </div>
                          <div className="text-[10px] bg-slate-50 p-2 rounded border border-slate-150 text-slate-600 font-mono italic my-1 break-words line-clamp-3">
                            "{n.messageText}"
                          </div>
                          <div className="text-[10px] text-slate-600 leading-normal">
                            <strong className="text-rose-750 font-semibold">Reason:</strong> {n.explanation}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

          </aside>

          {/* Central Column: Academic Chat Room with Authorization Locks */}
          <section id="chat-panel" className={`flex-1 flex flex-col bg-slate-50 overflow-hidden relative ${activeGroup || activeRecipient ? "flex" : "hidden md:flex"}`}>
            
            {activeGroup || activeRecipient ? (
              <>
                {/* Chat Header panel with contextual info */}
                <div className="flex items-center justify-between px-4 md:px-6 py-4 bg-white border-b border-slate-200 shrink-0 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {/* Back Button for Mobile */}
                    <button
                      onClick={() => {
                        setActiveGroup(null);
                        setActiveRecipient(null);
                      }}
                      className="md:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer shrink-0"
                      title="Back to Rooms/DMs"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>

                    <div 
                      onClick={() => {
                        if (activeGroup) {
                          setShowGroupInfo(!showGroupInfo);
                        }
                      }}
                      className={`flex items-center gap-2.5 min-w-0 ${
                        activeGroup 
                          ? "cursor-pointer hover:bg-slate-50 p-1.5 -m-1.5 rounded-xl transition-all" 
                          : ""
                      }`}
                      title={activeGroup ? "Click to view study room details, members & shared media" : ""}
                    >
                      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-sky-50 text-sky-600 shrink-0">
                        {activeGroup ? <BookOpen className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0 text-left">
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-xs font-bold text-slate-900 truncate">{conversationTitle}</h3>
                          {activeGroup && (
                            <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded font-normal shrink-0">
                              Room Info
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500 truncate">{conversationSub}</p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Action components: Member controls for group rooms */}
                  {activeGroup && isAuthorizedInGroup && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setShowAddMemberPanel(!showAddMemberPanel)}
                        className={`px-2.5 py-1 text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer rounded border ${
                          showAddMemberPanel 
                            ? "bg-sky-600 border-sky-500 text-white hover:bg-sky-500" 
                            : "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200 hover:text-slate-900"
                        }`}
                      >
                        <UserPlus className="w-3.5 h-3.5" /> Add Member
                      </button>
                      <button
                        onClick={() => setShowGroupInfo(!showGroupInfo)}
                        className={`px-2.5 py-1 text-[10px] font-bold flex items-center gap-1 transition-all cursor-pointer rounded border ${
                          showGroupInfo 
                            ? "bg-sky-50 border-sky-200 text-sky-700" 
                            : "bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-800 hover:bg-slate-100"
                        }`}
                        title="Toggle Study Room Info panel"
                      >
                        <Info className="w-3.5 h-3.5" /> Info
                      </button>
                    </div>
                  )}

                  {/* DM Optional Polite Filter Toggle Switch */}
                  {activeRecipient && (
                    <div className="flex items-center gap-2 shrink-0 bg-sky-50/50 border border-sky-100 px-3 py-1.5 rounded-xl">
                      <div className="flex flex-col text-left shrink-0">
                        <span className="text-[9px] font-bold text-sky-800 uppercase tracking-wider flex items-center gap-1 leading-none">
                          ✨ Polite Filter
                        </span>
                        <span className="text-[8px] text-slate-400 mt-0.5 leading-none">Auto-polite phrasing</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const val = !friendlyFilterActive;
                          setFriendlyFilterActive(val);
                          showToast(`Polite & Friendly Filter ${val ? "ENABLED" : "DISABLED"} for this DM.`, "success");
                        }}
                        className={`w-9 h-5 rounded-full p-0.5 transition-all relative flex items-center shrink-0 cursor-pointer ${
                          friendlyFilterActive ? "bg-emerald-500" : "bg-slate-300"
                        }`}
                        title={friendlyFilterActive ? "Friendly filter is active. Offenses will be automatically rephrased." : "Friendly filter is inactive."}
                      >
                        <span
                          className={`w-4 h-4 rounded-full bg-white shadow-sm transition-all absolute ${
                            friendlyFilterActive ? "left-4.5" : "left-0.5"
                          }`}
                        />
                      </button>
                    </div>
                  )}
                </div>

                {/* Inline Add Member Tray Panel */}
                {activeGroup && showAddMemberPanel && (
                  <div className="p-4 bg-slate-50 border-b border-slate-200 text-left space-y-4 animate-slide-down">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-sky-700 uppercase tracking-wider flex items-center gap-1">
                        <UserPlus className="w-4 h-4" /> Add fellow student to "{activeGroup.name}"
                      </span>
                      <button
                        onClick={() => {
                          setShowAddMemberPanel(false);
                          setSearchMemberAccountName("");
                        }}
                        className="text-slate-500 hover:text-slate-800 text-xs font-bold cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>

                    {/* Search Inputs */}
                    <div className="space-y-1">
                      <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider">Account Name (Username)</label>
                      <input
                        type="text"
                        placeholder="Enter exact username"
                        value={searchMemberAccountName}
                        onChange={(e) => setSearchMemberAccountName(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 text-xs text-slate-800 placeholder-slate-400 rounded-lg focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                      />
                    </div>

                    {/* Results / Help Text */}
                    <div className="pt-1">
                      {!searchMemberAccountName.trim() ? (
                        <div className="text-slate-500 text-xs bg-white/60 p-3 rounded-lg border border-slate-200/50 italic">
                          Please enter the exact username of the user you want to add.
                        </div>
                      ) : (() => {
                        const trimmedSearchAccount = searchMemberAccountName.trim().toLowerCase();
                        const matched = users.filter(u => 
                          u.username.trim().toLowerCase() === trimmedSearchAccount
                        );

                        if (matched.length === 0) {
                          return (
                            <div className="text-rose-600 font-medium text-xs bg-rose-50/50 p-3 rounded-lg border border-rose-100/50">
                              No registered user found with the exact username "{searchMemberAccountName.trim()}".
                            </div>
                          );
                        }

                        // We found matching user(s)
                        return (
                          <div className="space-y-2">
                            <div className="text-emerald-700 text-[10px] font-bold uppercase tracking-wide">
                              1 Student Found
                            </div>
                            <div className="grid grid-cols-1 gap-2">
                              {matched.map(u => {
                                const isAlreadyMember = activeGroup.members.includes(u.uid);
                                return (
                                  <div
                                    key={u.uid}
                                    className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between text-xs transition-all shadow-sm"
                                  >
                                    <div className="space-y-0.5">
                                      <div className="font-semibold text-slate-800">{u.name}</div>
                                      <div className="text-[10px] text-slate-500">@{u.username}</div>
                                    </div>
                                    {isAlreadyMember ? (
                                      <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-lg">
                                        Already a member
                                      </span>
                                    ) : (
                                      <button
                                        onClick={() => {
                                          handleAddMemberToGroup(u.uid);
                                          setSearchMemberAccountName("");
                                        }}
                                        className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg text-xs transition-all cursor-pointer flex items-center gap-1 shadow-sm"
                                      >
                                        <PlusCircle className="w-4 h-4 shrink-0" /> Add to Room
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* Group Membership Authorization Shield */}
                {!isAuthorizedInGroup ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-lg mx-auto space-y-5 animate-fade-in">
                    <div className="w-16 h-16 rounded-full bg-rose-50 border border-rose-100 text-rose-600 flex items-center justify-center">
                      <Lock className="w-8 h-8" />
                    </div>
                    
                    <div className="space-y-2">
                      <h4 className="text-md font-bold text-slate-900 flex items-center justify-center gap-1.5">
                        <Lock className="w-4 h-4 text-rose-500" />
                        Room Membership Required
                      </h4>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        This chat group is restricted to approved members only. You must join or be added to this room to view and participate.
                      </p>
                    </div>
                  </div>
                ) : (
                  // AUTHORIZED CHAT STREAM VIEW
                  <>
                    <div className="flex-1 overflow-y-auto p-6 space-y-4">
                      {messages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center max-w-sm mx-auto opacity-80">
                          <MessageSquare className="w-8 h-8 text-slate-300 mb-2" />
                          <p className="text-xs font-semibold text-slate-800">No message history</p>
                          <p className="text-[10px] text-slate-500 mt-1 leading-normal">
                            This is a topic-moderated room. Keep discussions aligned with the group guidelines.
                          </p>
                        </div>
                      ) : (
                        messages.map((m) => {
                          const isMyMessage = m.senderId === currentUser.uid;
                          const initial = m.senderName.split(" ").map(n => n[0]).join("");
                          
                          return (
                            <div
                              id={`chat-msg-${m.id}`}
                              key={m.id}
                              className={`flex items-end gap-2.5 transition-all duration-500 ${
                                highlightedMessageId === m.id ? "ring-2 ring-sky-500 p-2.5 rounded-2xl bg-sky-50 shadow-md scale-[1.01]" : ""
                              } ${isMyMessage ? "flex-row-reverse" : "text-left"}`}
                            >
                              <div className={`w-8 h-8 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 border ${
                                isMyMessage
                                  ? "bg-sky-600 border-sky-500 text-white"
                                  : "bg-slate-100 border-slate-200 text-slate-700"
                              }`}>
                                {initial}
                              </div>

                              <div className="max-w-[75%] space-y-1">
                                <div className={`flex items-baseline gap-1.5 text-[10px] text-slate-500 ${isMyMessage ? "flex-row-reverse" : ""}`}>
                                  <span className="font-bold text-slate-700">{m.senderName}</span>
                                  <span className="text-[9px] text-slate-400">
                                    {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>

                                <div className={`p-3 rounded-2xl border text-xs break-words relative shadow-sm ${
                                  isMyMessage
                                    ? "bg-sky-600 text-white border-sky-500"
                                    : "bg-white border-slate-200 text-slate-800"
                                }`}>
                                  
                                  {/* Forwarded Status Label */}
                                  {m.isForwarded && (
                                    <div className={`flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider mb-2 ${
                                      isMyMessage ? "text-slate-100/90" : "text-sky-600"
                                    }`}>
                                      <Forward className="w-3 h-3" />
                                      <span>Forwarded from {m.originalSenderName || "student"}</span>
                                    </div>
                                  )}

                                  {/* Replied Message Quote Header */}
                                  {m.replyToId && (
                                    <div className={`mb-2 p-2 rounded-xl text-[10px] border leading-normal ${
                                      isMyMessage
                                        ? "bg-sky-700/20 border-sky-500/10 text-white"
                                        : "bg-slate-100 border-slate-200 text-slate-500"
                                    }`}>
                                      <div className="font-semibold opacity-75">Replying to @{m.replyToSenderName || "student"}:</div>
                                      <div className="line-clamp-2 italic mt-0.5">"{m.replyToText}"</div>
                                    </div>
                                  )}

                                  {/* Rendering Word, PPT, PDF, YouTube links as attachments */}
                                  {m.fileName && (
                                    <div className={`mb-2 p-2.5 rounded-xl flex items-center justify-between gap-3 text-left ${
                                      isMyMessage
                                        ? "bg-sky-700/20 border border-sky-500/20 text-white"
                                        : "bg-slate-50 border border-slate-200 text-slate-700"
                                    }`}>
                                      <div className="flex items-center gap-2 min-w-0">
                                        {m.fileType === "Word" && <FileText className="w-5 h-5 text-blue-500 shrink-0" />}
                                        {m.fileType === "PPT" && <FileSpreadsheet className="w-5 h-5 text-orange-500 shrink-0" />}
                                        {m.fileType === "PDF" && <File className="w-5 h-5 text-red-500 shrink-0" />}
                                        {m.fileType === "Video" && <Video className="w-5 h-5 text-indigo-500 shrink-0" />}
                                        {m.fileType === "YouTube" && <Youtube className="w-5 h-5 text-red-500 shrink-0" />}
                                        {m.fileType === "Image" && <Image className="w-5 h-5 text-emerald-500 shrink-0" />}
                                        {(!m.fileType || m.fileType === "Other") && <Paperclip className="w-5 h-5 text-slate-500 shrink-0" />}

                                        <div className="min-w-0">
                                          <div className="font-bold text-[10px] truncate leading-tight">{m.fileName}</div>
                                          <span className={`text-[8px] px-1 py-0.5 rounded uppercase leading-none font-extrabold ${
                                            isMyMessage ? "bg-sky-500/40 text-white" : "bg-slate-100 text-slate-500"
                                          }`}>
                                            {m.fileType || "File Attachment"}
                                          </span>
                                        </div>
                                      </div>

                                      <a
                                        href="#"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          openAttachment(m);
                                        }}
                                        className={`text-[9px] font-bold shrink-0 hover:underline ${
                                          isMyMessage ? "text-white" : "text-sky-600"
                                        }`}
                                      >
                                        Preview
                                      </a>
                                    </div>
                                  )}

                                  {m.fileDescription && (
                                    <p className={`text-[10px] font-bold italic mb-1.5 leading-snug ${
                                      isMyMessage ? "text-slate-100/80" : "text-slate-500"
                                    }`}>
                                      File Context: {m.fileDescription}
                                    </p>
                                  )}

                                  {m.text && <p className="leading-relaxed whitespace-pre-wrap">{m.text}</p>}

                                  {/* Interaction Utilities Block */}
                                  <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-dashed border-current/10 opacity-70 hover:opacity-100 transition-all">
                                    <button
                                      type="button"
                                      onClick={() => setReplyingToMessage(m)}
                                      className={`p-1 rounded hover:bg-current/10 transition-colors flex items-center gap-0.5 text-[9px] font-bold cursor-pointer ${
                                        isMyMessage ? "text-white" : "text-sky-600"
                                      }`}
                                      title="Reply to message"
                                    >
                                      <Reply className="w-3 h-3" />
                                      <span>Reply</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => setForwardingMessage(m)}
                                      className={`p-1 rounded hover:bg-current/10 transition-colors flex items-center gap-0.5 text-[9px] font-bold cursor-pointer ${
                                        isMyMessage ? "text-white" : "text-sky-600"
                                      }`}
                                      title="Forward message to another circle"
                                    >
                                      <Forward className="w-3 h-3" />
                                      <span>Forward</span>
                                    </button>

                                    {isMyMessage && (
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteMessage(m.id)}
                                        className={`p-1 rounded hover:bg-rose-500/25 transition-colors flex items-center gap-0.5 text-[9px] font-bold cursor-pointer ${
                                          isMyMessage ? "text-rose-200" : "text-rose-600"
                                        }`}
                                        title="Delete your message"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                        <span>Delete</span>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}

                      {/* Message Sending Indicator */}
                      {evaluating && (
                        <div className="flex items-end gap-2.5 text-left animate-pulse">
                          <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center">
                            <Clock className="w-4 h-4 text-sky-600" />
                          </div>
                          <div className="max-w-[70%] space-y-1">
                            <span className="text-[10px] font-bold text-sky-600">System</span>
                            <div className="p-3 bg-white border border-slate-200 rounded-2xl text-xs space-y-1 shadow-sm">
                              <div className="flex items-center gap-1.5">
                                <div className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-ping"></div>
                                <span className="font-bold text-sky-700 flex items-center gap-1 text-[11px]">
                                  Delivering message...
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Active Evaluation Response Prompt (Only show on rejection) */}
                      {evalResult && evalResult.status === "REJECTED" && (
                        <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl flex items-start justify-between text-xs animate-fade-in text-left">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-rose-700">
                                  Message Delivery Failed
                                </span>
                              </div>
                              <p className="text-slate-600 mt-0.5 leading-normal">{evalResult.explanation}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => setEvalResult(null)}
                            className="text-slate-400 hover:text-slate-600 font-bold text-sm leading-none"
                          >
                            &times;
                          </button>
                        </div>
                      )}

                      <div ref={chatEndRef} />
                    </div>

                    {/* Chat Input Area (Evaluated instantly) */}
                    <div className="p-4 bg-white border-t border-slate-200 space-y-2.5 shrink-0">
                      
                      {/* Replying Indicator Preview */}
                      {replyingToMessage && (
                        <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs animate-fade-in text-left">
                          <div className="flex items-center gap-2 min-w-0">
                            <Reply className="w-4 h-4 text-sky-600 shrink-0" />
                            <div className="min-w-0 text-left">
                              <span className="font-bold text-slate-700 block">Replying to @{replyingToMessage.senderName}</span>
                              <span className="text-[10px] text-slate-500 italic truncate block">
                                "{replyingToMessage.text || (replyingToMessage.fileName ? `[Attached ${replyingToMessage.fileType}]` : "Attachment")}"
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setReplyingToMessage(null)}
                            className="p-1 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                            title="Cancel reply"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      )}

                      {/* Hidden File Input */}
                      <input
                        type="file"
                        id="file-attachment-input"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        className="hidden"
                      />

                      {/* Clean File Attachment Badge */}
                      {attachedFile && (
                        <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs animate-fade-in">
                          <div className="flex items-center gap-2 min-w-0">
                            <Paperclip className="w-4 h-4 text-sky-600 shrink-0" />
                            <span className="font-bold text-slate-800 truncate">{attachedFile.name}</span>
                            <span className="text-[10px] text-slate-500 font-mono">({(attachedFile.size / 1024).toFixed(1)} KB)</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setAttachedFile(null);
                              setFileBase64("");
                              if (fileInputRef.current) fileInputRef.current.value = "";
                            }}
                            className="p-1 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                            title="Remove file"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      )}

                      {/* Live Evaluation Process Field */}
                      {liveEvalField && (
                        <div id="live-evaluation-process-field" className="p-3.5 bg-slate-100 border border-slate-200 rounded-xl space-y-2 text-left animate-slide-down shadow-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-extrabold text-sky-700 uppercase tracking-wider flex items-center gap-1.5">
                              <Shield className="w-3.5 h-3.5 text-sky-600" />
                              Gatekeeper AI Live Evaluation Process
                            </span>
                            <div className="flex items-center gap-1.5 text-[9px] font-mono">
                              <span className={liveEvalField.geminiActive ? "text-slate-500" : "text-amber-600 font-bold"}>
                                Model: {liveEvalField.geminiActive ? "Gemini 3.5 Flash" : "Fail-Safe Local Heuristics"}
                              </span>
                              <span className="text-slate-400">•</span>
                              <span className="text-slate-500">{liveEvalField.latencyMs}ms</span>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-2.5 bg-white rounded-lg border border-slate-200 text-[11px]">
                            {/* Left part: status */}
                            <div className="sm:col-span-3 flex flex-col justify-center items-start sm:items-center p-2 bg-slate-50 border border-slate-200 rounded-lg shrink-0">
                              <span className="text-[9px] font-bold text-slate-500 uppercase">Decision Status</span>
                              <span className={`mt-1.5 px-2.5 py-1 text-[10px] font-extrabold uppercase rounded-full tracking-wider flex items-center gap-1.5 ${
                                liveEvalField.status === "APPROVED" 
                                  ? "bg-emerald-50 border border-emerald-200 text-emerald-800" 
                                  : "bg-rose-50 border border-rose-200 text-rose-800"
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${liveEvalField.status === "APPROVED" ? "bg-emerald-500 animate-pulse" : "bg-rose-500 animate-pulse"}`}></span>
                                {liveEvalField.status}
                              </span>
                            </div>

                            {/* Right part: Explanation & details */}
                            <div className="sm:col-span-9 space-y-1.5">
                              <div>
                                <span className="font-semibold text-slate-500">Moderation Explanation:</span>
                                <p className="text-slate-700 font-normal leading-relaxed mt-0.5">{liveEvalField.explanation}</p>
                              </div>

                              {liveEvalField.academicTopics && liveEvalField.academicTopics.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                  <span className="font-semibold text-slate-500 mr-1">Detected Classes:</span>
                                  {liveEvalField.academicTopics.map((topic, idx) => (
                                    <span key={idx} className="px-2 py-0.5 text-[9px] font-medium bg-sky-50 text-sky-700 rounded-md border border-sky-200">
                                      {topic}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Message Input Form */}
                      <form onSubmit={handleSendMessage} className="flex gap-2.5 items-center">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className={`p-2.5 rounded-xl border transition-colors flex items-center justify-center shrink-0 cursor-pointer ${
                            attachedFile
                              ? "bg-sky-600 text-white border-sky-500 font-bold"
                              : "bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                          }`}
                          title="Attach file from your computer"
                        >
                          <Paperclip className="w-4.5 h-4.5" />
                        </button>

                        <div className="relative flex-1">
                          <input
                            type="text"
                            value={messageText}
                            onChange={(e) => setMessageText(e.target.value)}
                            placeholder="Type a message..."
                            className="w-full pl-4 pr-12 py-2.5 bg-slate-50 border border-slate-200 text-xs text-slate-800 placeholder-slate-400 rounded-xl focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:bg-white"
                          />
                          <div className="absolute right-3.5 top-3 flex items-center text-[9px] font-mono text-slate-400">
                            ENTER
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={evaluating}
                          className="p-2.5 bg-sky-600 hover:bg-sky-500 text-white rounded-xl font-bold flex items-center justify-center transition-all shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        >
                          <Send className="w-4.5 h-4.5" />
                        </button>
                      </form>

                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center max-w-sm mx-auto p-8 space-y-4">
                <Compass className="w-12 h-12 text-slate-300 animate-spin" />
                <h3 className="text-sm font-bold text-slate-800">Start a Conversation</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Choose a room under <strong>Rooms</strong> or click on any user under <strong>DMs</strong> to start real-time messaging.
                </p>
              </div>
            )}

          </section>

          {/* Right Column: WhatsApp-style Study Room Details & Shared Resources */}
          {activeGroup && showGroupInfo && (
            <aside id="group-info-sidebar" className="fixed inset-y-0 right-0 z-30 w-full sm:w-80 md:static md:inset-auto md:z-auto md:w-80 border-l border-slate-200 bg-white flex flex-col shrink-0 shadow-2xl md:shadow-none animate-slide-left">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-4 bg-slate-50 border-b border-slate-200 shrink-0 text-left">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase tracking-wide">
                  <Info className="w-4 h-4 text-sky-600" />
                  Chat Group Details
                </span>
                <button
                  onClick={() => setShowGroupInfo(false)}
                  className="text-slate-400 hover:text-rose-600 transition-colors p-1 rounded-full hover:bg-slate-150 cursor-pointer"
                  title="Close sidebar"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              {/* Sidebar Content */}
              <div className="flex-1 overflow-y-auto p-4 space-y-6 text-left">
                {/* Profile overview */}
                <div className="flex flex-col items-center text-center space-y-3 pb-5 border-b border-slate-100">
                  <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-sky-50 text-sky-600 shadow-sm border border-sky-100">
                    <BookOpen className="w-7 h-7" />
                  </div>
                  <div>
                    <h4 className="text-sm font-extrabold text-slate-900">{activeGroup.name}</h4>
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider mt-0.5">Topic-Enforced Chat Group</p>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed max-w-xs italic">
                    "{activeGroup.description || 'No description available for this chat group.'}"
                  </p>
                </div>

                {/* Quick actions (Leave room is located here now) */}
                <div className="space-y-2">
                  <button
                    onClick={() => setShowLeaveConfirm(true)}
                    className="w-full py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 hover:text-rose-800 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm"
                    title="Leave this chat group"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Leave Chat Group
                  </button>
                </div>

                {/* Tabs selection: Members vs Shared Media */}
                <div className="space-y-3">
                  <div className="flex border-b border-slate-150 text-[11px] font-bold">
                    <button
                      onClick={() => setGroupSidebarTab("members")}
                      className={`flex-1 pb-2 border-b-2 transition-all cursor-pointer text-center ${
                        groupSidebarTab === "members"
                          ? "border-sky-600 text-sky-600"
                          : "border-transparent text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      Students ({activeGroup.members.length})
                    </button>
                    <button
                      onClick={() => setGroupSidebarTab("media")}
                      className={`flex-1 pb-2 border-b-2 transition-all cursor-pointer text-center ${
                        groupSidebarTab === "media"
                          ? "border-sky-600 text-sky-600"
                          : "border-transparent text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      Shared Media ({messages.filter(m => m.groupId === activeGroup.id && (m.fileName || m.fileUrl)).length})
                    </button>
                  </div>

                  {/* Tab Contents */}
                  <div className="space-y-2">
                    {groupSidebarTab === "members" ? (
                      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                        {users
                          .filter((u) => activeGroup.members.includes(u.uid))
                          .map((u) => {
                            const isMe = u.uid === currentUser?.uid;
                            return (
                              <div
                                key={u.uid}
                                className="flex items-center justify-between p-2 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="flex items-center justify-center w-7 h-7 rounded-full bg-slate-200 text-slate-700 font-bold text-[10px] uppercase shrink-0 border border-slate-300">
                                    {u.name.split(" ").map((n) => n[0]).join("")}
                                  </div>
                                  <div className="min-w-0 text-left">
                                    <div className="text-xs font-semibold text-slate-800 truncate flex items-center gap-1">
                                      {u.name}
                                      {isMe && (
                                        <span className="text-[8px] px-1 py-0.2 bg-sky-100 text-sky-700 rounded-md shrink-0 font-bold">
                                          You
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[9px] text-slate-500 truncate">@{u.username}</div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    ) : (
                      // Shared Media / files
                      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                        {(() => {
                          const sharedFiles = messages.filter(
                            (m) => m.groupId === activeGroup.id && (m.fileName || m.fileUrl)
                          );

                          if (sharedFiles.length === 0) {
                            return (
                              <div className="text-center py-6 text-slate-400 italic text-[11px] bg-slate-50/30 rounded-xl border border-dashed border-slate-200">
                                No files or study media shared in this room yet.
                              </div>
                            );
                          }

                          return sharedFiles.map((m) => {
                            return (
                              <div
                                key={m.id}
                                className="p-2.5 rounded-xl border border-slate-200 bg-white shadow-sm space-y-2 text-xs flex flex-col"
                              >
                                <div className="flex items-start gap-2">
                                  {m.fileType === "PDF" && <FileText className="w-4 h-4 text-rose-500 shrink-0" />}
                                  {m.fileType === "Word" && <FileText className="w-4 h-4 text-blue-500 shrink-0" />}
                                  {m.fileType === "PPT" && <FileText className="w-4 h-4 text-amber-500 shrink-0" />}
                                  {m.fileType === "Video" && <Video className="w-4 h-4 text-pink-500 shrink-0" />}
                                  {m.fileType === "YouTube" && <Youtube className="w-4 h-4 text-red-500 shrink-0" />}
                                  {m.fileType === "Image" && <Image className="w-4 h-4 text-emerald-500 shrink-0" />}
                                  {(!m.fileType || m.fileType === "Other") && (
                                    <Paperclip className="w-4 h-4 text-slate-500 shrink-0" />
                                  )}

                                  <div className="min-w-0 flex-1 text-left">
                                    <div className="font-bold text-[11px] text-slate-800 truncate leading-tight" title={m.fileName}>
                                      {m.fileName}
                                    </div>
                                    <div className="text-[9px] text-slate-500 flex flex-wrap items-center gap-1.5 mt-0.5">
                                      <span>By {m.senderName}</span>
                                      <span>•</span>
                                      <span>{new Date(m.timestamp).toLocaleDateString()}</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center justify-between pt-1.5 border-t border-slate-100">
                                  <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded uppercase font-extrabold leading-none shrink-0">
                                    {m.fileType || "Attachment"}
                                  </span>

                                  <a
                                    href="#"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      openAttachment(m);
                                    }}
                                    className="text-[10px] font-bold text-sky-600 hover:underline flex items-center gap-1 shrink-0 bg-sky-50 px-2 py-0.5 rounded transition-all hover:bg-sky-100"
                                  >
                                    Preview
                                  </a>
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </aside>
          )}

        </div>
      )}

      {/* Forward Message Modal Dialog */}
      {forwardingMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xl p-6 text-left space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Forward className="w-4.5 h-4.5 text-sky-600" />
                Forward Study Message
              </h3>
              <button
                onClick={() => setForwardingMessage(null)}
                className="text-slate-400 hover:text-slate-600 transition-colors text-lg font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs text-slate-600 leading-relaxed">
              <div className="font-semibold text-[10px] uppercase text-slate-400 mb-1">Message Content preview</div>
              {forwardingMessage.text && <p className="italic">"{forwardingMessage.text}"</p>}
              {forwardingMessage.fileName && (
                <p className="font-bold text-sky-600 mt-1 flex items-center gap-1">
                  📎 {forwardingMessage.fileName} ({forwardingMessage.fileType})
                </p>
              )}
            </div>

            <div className="space-y-3 text-left">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Select Forward Destination</label>
              
              <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                {/* Academic Rooms */}
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mt-2">Study Rooms</div>
                {groups.filter(g => currentUser?.groups.includes(g.id)).map(g => (
                  <button
                    key={g.id}
                    onClick={() => handleForwardMessage(g.id, undefined)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 hover:border-sky-500 bg-slate-50 hover:bg-sky-50/55 text-left text-xs font-semibold text-slate-800 hover:text-sky-700 flex items-center justify-between transition-all cursor-pointer group animate-fade-in"
                  >
                    <span>{g.name}</span>
                    <span className="text-[10px] text-slate-400 group-hover:text-sky-600">Send →</span>
                  </button>
                ))}

                {/* Direct Messages */}
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide pt-2">Direct Messages</div>
                {users.filter(u => u.uid !== currentUser?.uid).map(u => (
                  <button
                    key={u.uid}
                    onClick={() => handleForwardMessage(undefined, u.uid)}
                    className="w-full p-2.5 rounded-xl border border-slate-200 hover:border-sky-500 bg-slate-50 hover:bg-sky-50/55 text-left text-xs font-semibold text-slate-800 hover:text-sky-700 flex items-center justify-between transition-all cursor-pointer group animate-fade-in"
                  >
                    <span>{u.name} (@{u.username})</span>
                    <span className="text-[10px] text-slate-400 group-hover:text-sky-600">Send →</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setForwardingMessage(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold rounded-xl text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leave Group Confirmation Modal */}
      {showLeaveConfirm && activeGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl shadow-xl p-6 text-left space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-rose-600 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-500" />
                Leave Chat Group
              </h3>
              <button
                onClick={() => setShowLeaveConfirm(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors text-lg font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            <div className="space-y-2 text-slate-600 text-xs leading-relaxed">
              <p>
                Are you sure you want to leave <strong className="text-slate-900">"{activeGroup.name}"</strong>?
              </p>
              <p className="text-slate-400 text-[11px]">
                You will no longer have access to this chat group's feed, members, and shared files.
              </p>
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                onClick={() => setShowLeaveConfirm(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleLeaveGroup}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm shadow-rose-100"
              >
                <LogOut className="w-3.5 h-3.5" />
                Yes, Leave Room
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Dynamic Group Modal */}
      {showCreateGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xl p-6 text-left space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Users className="w-4 h-4 text-sky-600" />
                Create Custom Chat Group
              </h3>
              <button
                onClick={() => setShowCreateGroupModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors text-lg font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateGroup} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-slate-500 uppercase">Group Name</label>
                <input
                  type="text"
                  required
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="e.g. Inorganic Chemistry, Family Time, Study Group"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:bg-white"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[10px] font-bold text-slate-500 uppercase">Topic Rules & Criteria</label>
                <textarea
                  required
                  rows={4}
                  value={newGroupDescription}
                  onChange={(e) => setNewGroupDescription(e.target.value)}
                  placeholder="Describe what conversations are allowed in this group. Gatekeeper AI will strictly enforce this topic. Casual chats are allowed, but off-topic messages will be filtered. E.g. 'Must focus on study material, organic chemistry concepts, homework assignments.'"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:bg-white resize-none"
                />
              </div>

              <div className="text-[10px] text-slate-500 leading-normal bg-sky-50 border border-sky-100 p-3 rounded-lg flex items-start gap-1.5">
                <span className="text-sky-600 text-xs font-bold">ℹ️</span>
                <span>
                  The <strong>Gatekeeper AI Guardrail</strong> will intercept and inspect every message in real-time, matching against this description to ensure discussions never deviate from the topic.
                </span>
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateGroupModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer shadow-sm shadow-sky-100"
                >
                  Create Group
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add New Contact Modal */}
      {showAddContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xl p-6 text-left space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-sky-600" />
                Add New Contact
              </h3>
              <button
                onClick={() => setShowAddContactModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors text-lg font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-500 leading-normal">
                Search or select a student from the directory to start a direct 1-on-1 private academic conversation.
              </p>

              {/* Directory search input */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search students by name, email, or username..."
                  value={contactSearchQuery}
                  onChange={(e) => setContactSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:bg-white"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                {contactSearchQuery && (
                  <button
                    onClick={() => setContactSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold"
                  >
                    &times;
                  </button>
                )}
              </div>

              {/* Student Directory List */}
              <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                {(() => {
                  const directory = users.filter((u) => u.uid !== currentUser?.uid);
                  const filtered = directory.filter((u) => {
                    if (!contactSearchQuery.trim()) return true;
                    const qLower = contactSearchQuery.trim().toLowerCase();
                    return (
                      u.name.toLowerCase().includes(qLower) ||
                      u.username.toLowerCase().includes(qLower) ||
                      (u.email || "").toLowerCase().includes(qLower)
                    );
                  });

                  if (filtered.length === 0) {
                    return (
                      <div className="text-center py-8 text-slate-400 text-xs">
                        No students found matching "{contactSearchQuery}"
                      </div>
                    );
                  }

                  return filtered.map((u) => {
                    const hasChatted = chattedUserIds.includes(u.uid);
                    const initial = u.name.split(" ").map((n) => n[0]).join("");

                    return (
                      <button
                        key={u.uid}
                        onClick={() => {
                          setActiveRecipient(u);
                          setActiveGroup(null);
                          setShowAddContactModal(false);
                          showToast(`Selected contact: ${u.name}. Send a message to start chatting!`, "info");
                        }}
                        className="w-full p-2.5 rounded-xl border border-slate-100 hover:border-sky-500 hover:bg-sky-50/20 text-left flex items-center justify-between transition-all cursor-pointer"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 text-slate-600 font-bold text-[11px] flex items-center justify-center shrink-0">
                            {initial}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-xs text-slate-800 truncate flex items-center gap-1.5">
                              {u.name}
                              {hasChatted && (
                                <span className="text-[8px] font-extrabold px-1.5 py-0.2 bg-emerald-50 text-emerald-600 rounded">
                                  Chatted
                                </span>
                              )}
                            </div>
                            <div className="text-[9px] text-slate-500 font-mono truncate">
                              @{u.username} {u.email ? `• ${u.email}` : ""}
                            </div>
                          </div>
                        </div>

                        <span className="text-[10px] text-sky-600 font-bold hover:underline">Chat →</span>
                      </button>
                    );
                  });
                })()}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                onClick={() => setShowAddContactModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Message & File Search Modal */}
      {showAiSearchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl shadow-2xl p-6 text-left space-y-4 max-h-[90vh] flex flex-col">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 text-white">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-800 flex items-center gap-1.5">
                    AI Message & File Search
                  </h3>
                  <p className="text-[10px] text-slate-500">
                    Find messages and attached files by content, name, description, or topic via Gemini AI.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAiSearchModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors text-lg font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            {/* Search Controls & Input Form */}
            <div className="space-y-3 shrink-0">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handlePerformAiSearch();
                }}
                className="flex items-center gap-2"
              >
                <div className="relative flex-1">
                  <input
                    type="text"
                    placeholder="Search file contents, filenames, or keywords (e.g. 'PDF notes', 'SN2 mechanisms', 'assignment 2')..."
                    value={aiSearchQuery}
                    onChange={(e) => setAiSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:bg-white font-medium"
                  />
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  {aiSearchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setAiSearchQuery("");
                        setAiSearchResults(null);
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold text-xs"
                    >
                      &times;
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={aiSearchLoading || !aiSearchQuery.trim()}
                  className="px-4 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer shrink-0"
                >
                  {aiSearchLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>{aiSearchLoading ? "AI Searching..." : "Search"}</span>
                </button>
              </form>

              {/* Example Search Query Pills */}
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className="font-bold text-slate-400 uppercase tracking-wider text-[9px]">Try searching:</span>
                {[
                  "📄 PDF notes",
                  "🧪 SN2 reaction mechanisms",
                  "📝 Homework assignments",
                  "🎥 YouTube video links",
                  "📊 Lab report slides"
                ].map((pill) => (
                  <button
                    key={pill}
                    type="button"
                    onClick={() => {
                      const cleanPill = pill.replace(/^[^\w]+/, "").trim();
                      setAiSearchQuery(cleanPill);
                      handlePerformAiSearch(cleanPill);
                    }}
                    className="px-2 py-0.5 rounded-full bg-slate-100 hover:bg-sky-50 hover:text-sky-700 text-slate-600 border border-slate-200 text-[10px] transition-all cursor-pointer"
                  >
                    {pill}
                  </button>
                ))}
              </div>

              {/* Filter Tabs */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 text-[10px] font-bold text-slate-600">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 uppercase tracking-wider text-[9px]">Type:</span>
                  <button
                    type="button"
                    onClick={() => setAiSearchFileTypeFilter("all")}
                    className={`px-2.5 py-1 rounded-lg border transition-all ${
                      aiSearchFileTypeFilter === "all" ? "bg-sky-50 border-sky-300 text-sky-700" : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    All Messages
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiSearchFileTypeFilter("files")}
                    className={`px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1 ${
                      aiSearchFileTypeFilter === "files" ? "bg-sky-50 border-sky-300 text-sky-700" : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <Paperclip className="w-3 h-3" /> Attached Files Only
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiSearchFileTypeFilter("text")}
                    className={`px-2.5 py-1 rounded-lg border transition-all ${
                      aiSearchFileTypeFilter === "text" ? "bg-sky-50 border-sky-300 text-sky-700" : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    Text Only
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 uppercase tracking-wider text-[9px]">Scope:</span>
                  <select
                    value={aiSearchScope}
                    onChange={(e) => setAiSearchScope(e.target.value as any)}
                    className="px-2 py-0.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-700 focus:outline-none"
                  >
                    <option value="current">Current Chat Room/DM</option>
                    <option value="all">All Joined Rooms & DMs</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Results Area */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 min-h-[220px]">
              {aiSearchLoading ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-slate-500 space-y-2">
                  <Sparkles className="w-8 h-8 text-sky-500 animate-spin" />
                  <p className="text-xs font-bold text-slate-800">Gemini AI analyzing content and file attachments...</p>
                  <p className="text-[10px] text-slate-400">Scanning filenames, file descriptions, and message text for matching references.</p>
                </div>
              ) : aiSearchResults === null ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-slate-400 space-y-2">
                  <Search className="w-8 h-8 text-slate-300" />
                  <p className="text-xs font-semibold text-slate-600">Enter a query above to start AI Search</p>
                  <p className="text-[10px] text-slate-400 max-w-sm">
                    AI will search through both direct text and attached files (PDF, Word, PPT, Videos, YouTube links) by name and contextual content.
                  </p>
                </div>
              ) : aiSearchResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center text-slate-500 space-y-2 bg-slate-50 rounded-2xl border border-slate-200/60 p-6">
                  <AlertTriangle className="w-8 h-8 text-amber-500" />
                  <p className="text-xs font-bold text-slate-800">No matching messages or files found</p>
                  <p className="text-[10px] text-slate-500 max-w-md">{aiSearchExplanation}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* AI Overview Explanation */}
                  {aiSearchExplanation && (
                    <div className="p-3 bg-sky-50 border border-sky-100 rounded-xl text-xs text-sky-800 flex items-start gap-2">
                      <Sparkles className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold block text-[10px] uppercase tracking-wider text-sky-700">AI Summary</span>
                        <p className="text-[11px] leading-relaxed mt-0.5">{aiSearchExplanation}</p>
                      </div>
                    </div>
                  )}

                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
                    Matching Results ({aiSearchResults.length})
                  </div>

                  <div className="space-y-2.5">
                    {aiSearchResults.map((resItem) => {
                      const m = resItem.message;
                      const initial = m.senderName.split(" ").map((n) => n[0]).join("");

                      return (
                        <div
                          key={m.id}
                          className="p-3.5 bg-white border border-slate-200 hover:border-sky-300 rounded-2xl space-y-2 transition-all shadow-sm text-left hover:shadow-md"
                        >
                          <div className="flex items-center justify-between text-[10px]">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-slate-100 border border-slate-200 text-slate-700 font-bold text-[9px] flex items-center justify-center">
                                {initial}
                              </div>
                              <span className="font-bold text-slate-800">{m.senderName}</span>
                              <span className="text-slate-400 text-[9px]">
                                {new Date(m.timestamp).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              {resItem.score && (
                                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 font-extrabold text-[9px] rounded-full border border-emerald-200">
                                  {resItem.score}% match
                                </span>
                              )}
                              <button
                                onClick={() => jumpToMessage(m)}
                                className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white font-bold text-[10px] rounded-lg transition-all cursor-pointer flex items-center gap-1 shadow-sm"
                              >
                                Jump to Message →
                              </button>
                            </div>
                          </div>

                          {/* AI Match Reason Badge */}
                          <div className="text-[10px] bg-slate-50 border border-slate-200/80 p-2 rounded-xl text-slate-700 flex items-start gap-1.5">
                            <span className="font-bold text-sky-600 shrink-0">✨ AI Match:</span>
                            <span className="font-medium text-slate-600">{resItem.matchReason}</span>
                          </div>

                          {/* Render File Attachment Card if present */}
                          {m.fileName && (
                            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-3 text-xs">
                              <div className="flex items-center gap-2 min-w-0">
                                {m.fileType === "Word" && <FileText className="w-5 h-5 text-blue-500 shrink-0" />}
                                {m.fileType === "PPT" && <FileSpreadsheet className="w-5 h-5 text-orange-500 shrink-0" />}
                                {m.fileType === "PDF" && <File className="w-5 h-5 text-red-500 shrink-0" />}
                                {m.fileType === "Video" && <Video className="w-5 h-5 text-indigo-500 shrink-0" />}
                                {m.fileType === "YouTube" && <Youtube className="w-5 h-5 text-red-500 shrink-0" />}
                                {m.fileType === "Image" && <Image className="w-5 h-5 text-emerald-500 shrink-0" />}
                                {(!m.fileType || m.fileType === "Other") && <Paperclip className="w-5 h-5 text-slate-500 shrink-0" />}

                                <div className="min-w-0">
                                  <div className="font-bold text-xs text-slate-800 truncate">{m.fileName}</div>
                                  <div className="text-[9px] text-slate-500 truncate">{m.fileDescription || m.fileType || "File attachment"}</div>
                                </div>
                              </div>
                              <span className="text-[9px] font-bold px-2 py-0.5 bg-white border border-slate-200 text-slate-600 rounded-md shrink-0">
                                {m.fileType || "File"}
                              </span>
                            </div>
                          )}

                          {m.text && (
                            <p className="text-xs text-slate-700 leading-relaxed bg-slate-50/50 p-2 rounded-xl border border-slate-100">
                              "{m.text}"
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end pt-3 border-t border-slate-100 shrink-0">
              <button
                onClick={() => setShowAiSearchModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors cursor-pointer"
              >
                Close Search
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
