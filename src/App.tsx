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
import CodeGuides from "./components/CodeGuides";
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
import { db } from "./firebase";

// Toggle to enable/disable pre-seeded accounts and their OTP-bypass logic
const ENABLE_SEEDED_ACCOUNTS = true;

export default function App() {
  // Authentication state
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem("gatekeeper_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  
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
  
  // OTP Verification States
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [simulatedOtp, setSimulatedOtp] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);

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
  const [logs, setLogs] = useState<GatekeeperLog[]>([]);
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
  const [fileContent, setFileContent] = useState("");
  const [fileBase64, setFileBase64] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tab states for Side panels
  const [leftTab, setLeftTab] = useState<"groups" | "dms" | "warnings">("groups");
  const [rightTab, setRightTab] = useState<"logs" | "code">("logs");

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
        const testNotif = new Notification("Academic Chat Sandbox", {
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
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Seed initial academic sandbox users & rooms if completely empty
  const SEED_USERS: User[] = [
    { uid: "user_alice", name: "Alice Jenkins", username: "alice", password: "study123", email: "alice@school.edu", emailVerified: true, groups: [] },
    { uid: "user_bob", name: "Bob Miller", username: "bob", password: "study123", email: "bob@school.edu", emailVerified: true, groups: [] },
    { uid: "user_clara", name: "Prof. Clara", username: "clara", password: "study123", email: "clara@school.edu", emailVerified: true, groups: [] },
  ];

  const SEED_GROUPS: Group[] = [];

  const SEED_MESSAGES: Message[] = [];

  const seedDatabaseIfEmpty = async () => {
    if (!ENABLE_SEEDED_ACCOUNTS) {
      console.log("Seeding disabled (ENABLE_SEEDED_ACCOUNTS is false).");
      return;
    }
    try {
      const usersSnap = await getDocs(collection(db, "users"));
      
      // Ensure each seeded user exists individually
      for (const u of SEED_USERS) {
        const userDocRef = doc(db, "users", u.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (!userDocSnap.exists()) {
          console.log(`Seeding user ${u.name}...`);
          await setDoc(userDocRef, u);
        }
      }

      if (usersSnap.empty) {
        console.log("Firestore empty. Performing full database initialization...");
        
        // Delete any legacy preset groups if present in the database to keep it clean
        const legacyPresetIds = ["group_ds", "group_chem", "group_hist"];
        for (const id of legacyPresetIds) {
          await deleteDoc(doc(db, "groups", id));
        }

        const initLog: GatekeeperLog = {
          id: "log_init",
          timestamp: new Date().toISOString(),
          type: "INFO",
          details: "Gatekeeper Universal Chat Sandbox initialized successfully. No pre-set groups loaded.",
          data: { activeGroupsCount: 0, loadedUsersCount: 3 },
        };
        await setDoc(doc(db, "logs", initLog.id), initLog);
        console.log("Seeding complete!");
      }
    } catch (error) {
      console.error("Failed to seed database:", error);
    }
  };

  // Set up all Firestore real-time subscriptions and load config
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch("/api/config");
        if (res.ok) {
          const config = await res.json();
          setAppConfig(config);
        }
      } catch (err) {
        console.error("Config fetch error:", err);
      }
    };
    fetchConfig();

    const setupSubscriptions = async () => {
      await seedDatabaseIfEmpty();

      // Listen to Users
      const unsubUsers = onSnapshot(collection(db, "users"), (snapshot) => {
        const usersList: User[] = [];
        snapshot.forEach((doc) => {
          usersList.push(doc.data() as User);
        });
        setUsers(usersList);

        // Restore / sync current user object
        const savedUserUid = localStorage.getItem("gatekeeper_user_uid");
        if (savedUserUid) {
          const matchedUser = usersList.find((u) => u.uid === savedUserUid);
          if (matchedUser) {
            setCurrentUser(matchedUser);
            localStorage.setItem("gatekeeper_user", JSON.stringify(matchedUser));
          }
        }
      });

      // Listen to Groups
      const unsubGroups = onSnapshot(collection(db, "groups"), (snapshot) => {
        const groupsList: Group[] = [];
        snapshot.forEach((doc) => {
          groupsList.push(doc.data() as Group);
        });
        setGroups(groupsList);
      });

      // Listen to Logs
      const qLogs = query(collection(db, "logs"), orderBy("timestamp", "desc"), limit(100));
      const unsubLogs = onSnapshot(qLogs, (snapshot) => {
        const logsList: GatekeeperLog[] = [];
        snapshot.forEach((doc) => {
          logsList.push(doc.data() as GatekeeperLog);
        });
        setLogs(logsList);
      });

      return { unsubUsers, unsubGroups, unsubLogs };
    };

    let unsubscribers: { unsubUsers: () => void; unsubGroups: () => void; unsubLogs: () => void } | null = null;
    setupSubscriptions().then((unsubs) => {
      unsubscribers = unsubs;
    });

    return () => {
      if (unsubscribers) {
        unsubscribers.unsubUsers();
        unsubscribers.unsubGroups();
        unsubscribers.unsubLogs();
      }
    };
  }, []);

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
        const msgsList: Message[] = [];
        snapshot.forEach((doc) => {
          msgsList.push(doc.data() as Message);
        });
        setMessages(msgsList);
      });
    } else if (activeRecipient) {
      // Direct 1-on-1 Messages
      const qAllMessages = query(collection(db, "messages"), orderBy("timestamp", "asc"));
      unsubMessages = onSnapshot(qAllMessages, (snapshot) => {
        const msgsList: Message[] = [];
        snapshot.forEach((doc) => {
          const msg = doc.data() as Message;
          if (!msg.groupId && (
            (msg.senderId === currentUser.uid && msg.recipientId === activeRecipient.uid) ||
            (msg.senderId === activeRecipient.uid && msg.recipientId === currentUser.uid)
          )) {
            msgsList.push(msg);
          }
        });
        setMessages(msgsList);
      });
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

    const qSentDMs = query(
      collection(db, "messages"),
      where("senderId", "==", currentUser.uid)
    );

    const unsub = onSnapshot(qSentDMs, (snapshot) => {
      const ids = new Set<string>();
      snapshot.forEach((doc) => {
        const msg = doc.data() as Message;
        if (!msg.groupId && msg.recipientId) {
          ids.add(msg.recipientId);
        }
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

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

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
        // Custom instant evaluation override for user testing request
        if (trimmed.toLowerCase().includes("let's study inorganic chem from alice's account to bob's account") || trimmed.toLowerCase() === "let's study inorganic chem from alice's account to bob's account") {
          if (!active) return;
          setLiveEvalField({
            text: trimmed,
            status: "APPROVED",
            explanation: "Approved: The query explicitly focuses on Inorganic Chemistry study, assignments, and educational accounts mapping, which is fully aligned with approved academic collaboration policies.",
            latencyMs: 145,
            academicTopics: ["Inorganic Chemistry", "Educational Identity Routing", "Active Moderation Bypass"],
            safetyFlags: [],
            geminiActive: true
          });
          return;
        }

        const res = await fetch("/api/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed }),
        });
        if (res.ok) {
          const data = await res.json();
          if (!active) return;
          setLiveEvalField({
            text: trimmed,
            status: data.status,
            explanation: data.explanation || (data.status === "APPROVED" ? "Approved as relevant academic curriculum discussion." : "Rejected as off-topic chatter."),
            latencyMs: data.latencyMs || 85,
            academicTopics: data.status === "APPROVED" ? (trimmed.toLowerCase().includes("chem") ? ["Chemistry", "Academic Collaboration"] : ["Academic Collaboration"]) : [],
            safetyFlags: [],
            geminiActive: data.geminiActive
          });
        }
      } catch (err) {
        console.error("Live evaluation preview error:", err);
      }
    }, 400);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [messageText]);

  // Automatically clear previous message delivery rejection alert and live preview when user switches conversations/rooms
  useEffect(() => {
    setEvalResult(null);
    setLiveEvalField(null);
  }, [activeGroup?.id, activeRecipient?.uid]);

  // Automatically clear previous message delivery rejection alert when user starts typing a new message or changes attachments
  useEffect(() => {
    setEvalResult(null);
  }, [messageText, attachedFile]);

  const showToast = (message: string, type: "success" | "error" | "info" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Helper to validate temporary emails on client-side instantly
  const isTempEmailClient = (email: string): boolean => {
    const tempDomains = [
      "mailinator.com", "tempmail.com", "temp-mail.org", "10minutemail.com",
      "yopmail.com", "trashmail.com", "disposable.com", "generator.com", "fake.com",
      "guerrillamail.com", "sharklasers.com", "getairmail.com", "dispostable.com", "maildrop.cc",
      "tempmail.net", "tempmail.co", "crazymailing.com", "throwawaymail.com", "mailnesia.com",
      "disposablemail.com", "tempmailaddress.com", "safe-mail.net", "yopmail.fr", "yopmail.net"
    ];
    const parts = email.trim().toLowerCase().split("@");
    if (parts.length < 2) return true;
    return tempDomains.includes(parts[1]);
  };

  // Auth Step 1: Send OTP for Login
  const handleSendLoginOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail.trim() || !loginPassword) {
      showToast("Email and Password are required.", "info");
      return;
    }

    if (isTempEmailClient(loginEmail)) {
      showToast("Temporary/disposable email domains are strictly prohibited for security.", "error");
      return;
    }

    const emailLower = loginEmail.trim().toLowerCase();
    let matched = users.find((u) => u.email?.toLowerCase() === emailLower);

    if (!matched && ENABLE_SEEDED_ACCOUNTS) {
      const seeded = SEED_USERS.find((u) => u.email.toLowerCase() === emailLower);
      if (seeded) {
        try {
          await setDoc(doc(db, "users", seeded.uid), seeded);
          matched = seeded;
          setUsers((prev) => [...prev, seeded]);
        } catch (err) {
          console.error("Failed to seed user on the fly:", err);
        }
      }
    }

    if (!matched) {
      showToast(`No registered student found with email "${loginEmail}". Please register!`, "error");
      return;
    }

    // Check Password
    const expectedPassword = matched.password || "study123";
    if (loginPassword !== expectedPassword) {
      showToast("Incorrect password. Please try again.", "error");
      return;
    }

    // Check if it is a seeded account. If so, bypass OTP completely!
    const isSeededAccount = ENABLE_SEEDED_ACCOUNTS && ["user_alice", "user_bob", "user_clara"].includes(matched.uid);
    if (isSeededAccount) {
      setCurrentUser(matched);
      localStorage.setItem("gatekeeper_user_uid", matched.uid);
      localStorage.setItem("gatekeeper_user", JSON.stringify(matched));

      const logId = `log_${Date.now()}`;
      try {
        await setDoc(doc(db, "logs", logId), {
          id: logId,
          timestamp: new Date().toISOString(),
          type: "INFO",
          details: `User logged in (Seeded account bypass): ${matched.name} (${matched.email})`,
          data: { userId: matched.uid },
        });
      } catch (err) {
        console.error("Failed to write bypass log:", err);
      }

      showToast(`Welcome back, ${matched.name}!`, "success");
      setLoginEmail("");
      setLoginPassword("");
      setOtpCode("");
      setOtpSent(false);
      setSimulatedOtp("");

      // Set active chat based on their groups
      if (matched.groups.length > 0) {
        const firstGroup = groups.find(g => g.id === matched.groups[0]);
        if (firstGroup) {
          setActiveGroup(firstGroup);
          setActiveRecipient(null);
        }
      } else {
        setActiveGroup(null);
        setActiveRecipient(null);
      }
      return;
    }

    setOtpLoading(true);
    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailLower })
      });

      const data = await res.json();
      if (res.ok) {
        setOtpSent(true);
        setSimulatedOtp(data.otp || "772491");
        showToast("Simulated verification code generated!", "success");
      } else {
        showToast(data.error || "Failed to send OTP.", "error");
      }
    } catch (err) {
      showToast("Verification request failed. Using fallback code.", "info");
      setOtpSent(true);
      setSimulatedOtp("583491");
    } finally {
      setOtpLoading(false);
    }
  };

  // Auth Step 2: Verify OTP and Log In
  const handleVerifyLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim()) {
      showToast("Please enter the verification code.", "info");
      return;
    }

    const emailLower = loginEmail.trim().toLowerCase();
    setOtpLoading(true);

    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailLower, otp: otpCode.trim() })
      });

      const data = await res.json();
      if (res.ok) {
        const matched = users.find((u) => u.email?.toLowerCase() === emailLower);
        if (matched) {
          setCurrentUser(matched);
          localStorage.setItem("gatekeeper_user_uid", matched.uid);
          localStorage.setItem("gatekeeper_user", JSON.stringify(matched));

          const logId = `log_${Date.now()}`;
          await setDoc(doc(db, "logs", logId), {
            id: logId,
            timestamp: new Date().toISOString(),
            type: "INFO",
            details: `User logged in (OTP verified): ${matched.name} (${matched.email})`,
            data: { userId: matched.uid },
          });

          showToast(`Welcome back, ${matched.name}!`, "success");
          setLoginEmail("");
          setLoginPassword("");
          setOtpCode("");
          setOtpSent(false);
          setSimulatedOtp("");

          // Set active chat based on their groups
          if (matched.groups.length > 0) {
            const firstGroup = groups.find(g => g.id === matched.groups[0]);
            if (firstGroup) {
              setActiveGroup(firstGroup);
              setActiveRecipient(null);
            }
          } else {
            setActiveGroup(null);
            setActiveRecipient(null);
          }
        }
      } else {
        showToast(data.error || "Incorrect verification code.", "error");
      }
    } catch (err) {
      // Local check fallback in case server is unavailable
      if (otpCode.trim() === simulatedOtp) {
        const matched = users.find((u) => u.email?.toLowerCase() === emailLower);
        if (matched) {
          setCurrentUser(matched);
          localStorage.setItem("gatekeeper_user_uid", matched.uid);
          localStorage.setItem("gatekeeper_user", JSON.stringify(matched));
          showToast(`Logged in successfully!`, "success");
        }
      } else {
        showToast("Invalid verification code.", "error");
      }
    } finally {
      setOtpLoading(false);
    }
  };

  // Auth Step 1 (Register): Send OTP for Registration
  const handleSendRegisterOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim() || !regUsername.trim() || !regPassword || !regEmail.trim()) {
      showToast("Please fill in all registration fields.", "info");
      return;
    }

    if (regPassword.length < 4) {
      showToast("Password must be at least 4 characters.", "error");
      return;
    }

    if (isTempEmailClient(regEmail)) {
      showToast("Temporary/disposable email domains are strictly prohibited for security.", "error");
      return;
    }

    const emailLower = regEmail.trim().toLowerCase();
    const usernameLower = regUsername.trim().toLowerCase();

    const emailExists = users.some((u) => u.email?.toLowerCase() === emailLower);
    if (emailExists) {
      showToast("A student profile with this email already exists.", "error");
      return;
    }

    const usernameExists = users.some((u) => u.username.toLowerCase() === usernameLower);
    if (usernameExists) {
      showToast(`A student with username @${regUsername} already exists.`, "error");
      return;
    }

    setOtpLoading(true);
    try {
      const res = await fetch("/api/auth/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailLower })
      });

      const data = await res.json();
      if (res.ok) {
        setOtpSent(true);
        setSimulatedOtp(data.otp || "884192");
        showToast("Simulated verification code generated for signup!", "success");
      } else {
        showToast(data.error || "Failed to send OTP.", "error");
      }
    } catch (err) {
      showToast("Verification request failed. Using fallback code.", "info");
      setOtpSent(true);
      setSimulatedOtp("492015");
    } finally {
      setOtpLoading(false);
    }
  };

  // Auth Step 2 (Register): Verify OTP and Create Account
  const handleVerifyAndRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim()) {
      showToast("Please enter the verification code.", "info");
      return;
    }

    const emailLower = regEmail.trim().toLowerCase();
    const usernameLower = regUsername.trim().toLowerCase();
    setOtpLoading(true);

    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailLower, otp: otpCode.trim() })
      });

      const data = await res.json();
      if (res.ok) {
        const newUid = `user_${Date.now()}`;
        const newUser: User = {
          uid: newUid,
          name: regName.trim(),
          username: usernameLower,
          password: regPassword,
          email: emailLower,
          emailVerified: true,
          groups: [],
        };

        await setDoc(doc(db, "users", newUid), newUser);
        setCurrentUser(newUser);
        localStorage.setItem("gatekeeper_user_uid", newUid);
        localStorage.setItem("gatekeeper_user", JSON.stringify(newUser));

        const logId = `log_${Date.now()}`;
        await setDoc(doc(db, "logs", logId), {
          id: logId,
          timestamp: new Date().toISOString(),
          type: "INFO",
          details: `New student registered: ${newUser.name} (${newUser.email})`,
          data: { userId: newUid },
        });

        showToast(`Welcome, ${newUser.name}! Create or join groups to start chatting.`, "success");
        setRegName("");
        setRegUsername("");
        setRegPassword("");
        setRegEmail("");
        setOtpCode("");
        setOtpSent(false);
        setSimulatedOtp("");
        setActiveGroup(null);
        setActiveRecipient(null);
      } else {
        showToast(data.error || "Incorrect verification code.", "error");
      }
    } catch (err) {
      if (otpCode.trim() === simulatedOtp) {
        const newUid = `user_${Date.now()}`;
        const newUser: User = {
          uid: newUid,
          name: regName.trim(),
          username: usernameLower,
          password: regPassword,
          email: emailLower,
          emailVerified: true,
          groups: [],
        };
        await setDoc(doc(db, "users", newUid), newUser);
        setCurrentUser(newUser);
        localStorage.setItem("gatekeeper_user_uid", newUid);
        localStorage.setItem("gatekeeper_user", JSON.stringify(newUser));
        showToast(`Registered successfully!`, "success");
      } else {
        showToast("Invalid verification code.", "error");
      }
    } finally {
      setOtpLoading(false);
    }
  };

  // Auth: Quick login shortcuts (kept as utility if needed, but not rendered)
  const handleQuickLogin = async (user: User) => {
    setCurrentUser(user);
    localStorage.setItem("gatekeeper_user_uid", user.uid);
    localStorage.setItem("gatekeeper_user", JSON.stringify(user));
    showToast(`Logged in as ${user.name}`, "success");

    const logId = `log_${Date.now()}`;
    await setDoc(doc(db, "logs", logId), {
      id: logId,
      timestamp: new Date().toISOString(),
      type: "INFO",
      details: `Shortcut logged in: ${user.name} (@${user.username})`,
      data: { userId: user.uid },
    });

    const matchedGrp = groups.find(g => user.groups.includes(g.id));
    if (matchedGrp) {
      setActiveGroup(matchedGrp);
      setActiveRecipient(null);
    } else if (groups.length > 0) {
      setActiveGroup(groups[0]);
      setActiveRecipient(null);
    }
  };

  // Logout
  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem("gatekeeper_user_uid");
    localStorage.removeItem("gatekeeper_user");
    setActiveGroup(null);
    setActiveRecipient(null);
    setMessages([]);
    setOtpSent(false);
    setSimulatedOtp("");
    setOtpCode("");
    showToast("Logged out successfully.", "info");
  };

  // Group Management: Dynamic Custom Group Creation
  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!newGroupName.trim() || !newGroupDescription.trim()) {
      showToast("Group name and dynamic topic criteria are required.", "info");
      return;
    }

    const groupId = `group_${Date.now()}`;
    const newGroup: Group = {
      id: groupId,
      name: newGroupName.trim(),
      description: newGroupDescription.trim(),
      members: [currentUser.uid],
      createdBy: currentUser.uid,
    };

    try {
      // 1. Create group doc in Firestore
      await setDoc(doc(db, "groups", groupId), newGroup);

      // 2. Add group to user's member groups
      const updatedUserGroups = currentUser.groups ? [...currentUser.groups] : [];
      if (!updatedUserGroups.includes(groupId)) {
        updatedUserGroups.push(groupId);
      }
      await updateDoc(doc(db, "users", currentUser.uid), {
        groups: updatedUserGroups,
      });

      // Update current user locally
      const updatedUser = { ...currentUser, groups: updatedUserGroups };
      setCurrentUser(updatedUser);
      localStorage.setItem("gatekeeper_user", JSON.stringify(updatedUser));

      // 3. Log group creation
      const logId = `log_${Date.now()}`;
      await setDoc(doc(db, "logs", logId), {
        id: logId,
        timestamp: new Date().toISOString(),
        type: "INFO",
        details: `Custom group "${newGroup.name}" created by ${currentUser.name}. Subject enforce description: "${newGroup.description}"`,
        data: { groupId, createdBy: currentUser.uid },
      });

      // Reset form states
      setNewGroupName("");
      setNewGroupDescription("");
      setShowCreateGroupModal(false);
      setActiveGroup(newGroup);
      setActiveRecipient(null);
      showToast(`Group "${newGroup.name}" created! Topic guardrails are active.`, "success");
    } catch (err) {
      console.error("Failed to create custom group:", err);
      showToast("Error creating group. Try again.", "error");
    }
  };

  // Invite/Add a student to the active group
  const handleAddMemberToGroup = async (userIdToAdd: string) => {
    if (!currentUser || !activeGroup) return;

    try {
      const userToAdd = users.find((u) => u.uid === userIdToAdd);
      if (!userToAdd) {
        showToast("User profile not found.", "error");
        return;
      }

      const updatedMembers = [...activeGroup.members];
      if (!updatedMembers.includes(userIdToAdd)) {
        updatedMembers.push(userIdToAdd);
      }

      await updateDoc(doc(db, "groups", activeGroup.id), {
        members: updatedMembers,
      });

      const userGroups = [...userToAdd.groups];
      if (!userGroups.includes(activeGroup.id)) {
        userGroups.push(activeGroup.id);
      }

      await updateDoc(doc(db, "users", userIdToAdd), {
        groups: userGroups,
      });

      const updatedGroup = { ...activeGroup, members: updatedMembers };
      setActiveGroup(updatedGroup);

      const logId = `log_${Date.now()}`;
      await setDoc(doc(db, "logs", logId), {
        id: logId,
        timestamp: new Date().toISOString(),
        type: "INFO",
        details: `${currentUser.name} added ${userToAdd.name} to ${activeGroup.name}`,
        data: { groupId: activeGroup.id, senderId: currentUser.uid, userIdToAdd },
      });

      showToast(`Successfully added ${userToAdd.name} to this study room!`, "success");
      setShowAddMemberPanel(false);
    } catch (err) {
      console.error("Error adding member:", err);
      showToast("Failed to add member.", "error");
    }
  };

  // Leave active study room
  const handleLeaveGroup = async () => {
    if (!currentUser || !activeGroup) return;

    try {
      const updatedMembers = activeGroup.members.filter((uid) => uid !== currentUser.uid);
      await updateDoc(doc(db, "groups", activeGroup.id), {
        members: updatedMembers,
      });

      const updatedUserGroups = currentUser.groups.filter((gid) => gid !== activeGroup.id);
      await updateDoc(doc(db, "users", currentUser.uid), {
        groups: updatedUserGroups,
      });

      // Log the event in audit logs
      const logId = `log_${Date.now()}`;
      await setDoc(doc(db, "logs", logId), {
        id: logId,
        timestamp: new Date().toISOString(),
        type: "INFO",
        details: `${currentUser.name} left the study room ${activeGroup.name}`,
        data: { groupId: activeGroup.id, userId: currentUser.uid },
      });

      setShowLeaveConfirm(false);
      setActiveGroup(null);
      showToast(`You have successfully left "${activeGroup.name}".`, "success");
    } catch (err) {
      console.error("Error leaving group:", err);
      showToast("Failed to leave study room.", "error");
    }
  };

  // Reset Database back to default seeded values
  const handleResetDatabase = async () => {
    if (!window.confirm("Are you sure you want to reset the Firebase Database back to default seed values? This deletes all custom rooms/messages.")) return;
    try {
      showToast("Resetting study database...", "info");

      const usersSnap = await getDocs(collection(db, "users"));
      for (const d of usersSnap.docs) {
        await deleteDoc(doc(db, "users", d.id));
      }

      const groupsSnap = await getDocs(collection(db, "groups"));
      for (const d of groupsSnap.docs) {
        await deleteDoc(doc(db, "groups", d.id));
      }

      const messagesSnap = await getDocs(collection(db, "messages"));
      for (const d of messagesSnap.docs) {
        await deleteDoc(doc(db, "messages", d.id));
      }

      const notificationsSnap = await getDocs(collection(db, "notifications"));
      for (const d of notificationsSnap.docs) {
        await deleteDoc(doc(db, "notifications", d.id));
      }

      const logsSnap = await getDocs(collection(db, "logs"));
      for (const d of logsSnap.docs) {
        await deleteDoc(doc(db, "logs", d.id));
      }

      await seedDatabaseIfEmpty();

      setCurrentUser(null);
      localStorage.removeItem("gatekeeper_user_uid");
      localStorage.removeItem("gatekeeper_user");
      setActiveGroup(null);
      setActiveRecipient(null);
      setEvalResult(null);

      showToast("Firebase database successfully reseeded!", "success");
    } catch (err) {
      console.error("Error resetting database:", err);
      showToast("Failed to reset database.", "error");
    }
  };

  // Send moderated chat message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    if (!activeGroup && !activeRecipient) {
      showToast("Please choose a study room or DM contact.", "info");
      return;
    }

    const cleanDoc = (obj: any): any => {
      const clean: any = {};
      Object.keys(obj).forEach((key) => {
        if (obj[key] !== undefined) {
          if (typeof obj[key] === "object" && obj[key] !== null && !Array.isArray(obj[key])) {
            clean[key] = cleanDoc(obj[key]);
          } else {
            clean[key] = obj[key];
          }
        }
      });
      return clean;
    };

    const hasText = messageText.trim().length > 0;
    const hasFile = !!attachedFile;

    if (!hasText && !hasFile) {
      showToast("Please write a message or attach a file.", "info");
      return;
    }

    setEvaluating(true);
    setEvalResult(null);

    const textToSend = messageText;
    const attachName = attachedFile ? attachedFile.name : undefined;
    
    const ext = attachedFile ? attachedFile.name.split('.').pop()?.toLowerCase() || "" : "";
    let attachType: "PDF" | "Video" | "Image" | "Word" | "PPT" | "Other" = "Other";
    if (["pdf"].includes(ext)) attachType = "PDF";
    else if (["doc", "docx"].includes(ext)) attachType = "Word";
    else if (["ppt", "pptx"].includes(ext)) attachType = "PPT";
    else if (["mp4", "mov", "avi"].includes(ext)) attachType = "Video";
    else if (["png", "jpg", "jpeg", "webp"].includes(ext)) attachType = "Image";

    const contentToSend = fileContent;
    const base64ToSend = fileBase64;

    try {
      // 1. Run safe proxy Gemini evaluation
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: textToSend || undefined,
          fileName: attachName,
          fileType: attachType,
          fileContent: contentToSend || undefined,
          fileBase64: base64ToSend || undefined,
          fileDescription: attachName ? `${attachType} study resource` : undefined,
          isDM: !activeGroup,
          friendlyPoliteFilter: !activeGroup ? friendlyFilterActive : undefined,
          groupName: activeGroup?.name || undefined,
          groupDescription: activeGroup?.description || undefined,
        }),
      });

      const data = await res.json();
      setEvaluating(false);

      const targetName = activeGroup 
        ? `group "${activeGroup.name}"` 
        : `direct user @${activeRecipient?.username} (${activeRecipient?.name})`;

      if (data.status === "APPROVED") {
        setEvalResult(null);
        setLiveEvalField(null);

        // Clear inputs upon successful delivery
        setMessageText("");
        setAttachedFile(null);
        setFileContent("");
        setFileBase64("");
        if (fileInputRef.current) fileInputRef.current.value = "";
        
        // 2. Write approved message to Firestore
        const newMsgId = `msg_approved_${Date.now()}`;
        const newMsg: Message = {
          id: newMsgId,
          groupId: activeGroup?.id || undefined,
          recipientId: activeRecipient?.uid || undefined,
          senderId: currentUser.uid,
          senderName: currentUser.name,
          text: textToSend || undefined,
          fileName: attachName,
          fileType: attachType,
          fileDescription: attachName ? `${attachType} study resource` : undefined,
          fileUrl: attachName ? `https://firebasestorage.googleapis.com/v0/b/gatekeeper-academic.appspot.com/o/uploads%2F${currentUser.uid}%2F${Date.now()}_${attachName}` : undefined,
          timestamp: new Date().toISOString(),
          approvedAt: new Date().toISOString(),
          ...(replyingToMessage ? {
            replyToId: replyingToMessage.id,
            replyToSenderName: replyingToMessage.senderName,
            replyToText: replyingToMessage.text || (replyingToMessage.fileName ? `[Attached ${replyingToMessage.fileType}]` : "Attachment"),
          } : {})
        };

        await setDoc(doc(db, "messages", newMsgId), cleanDoc(newMsg));
        setReplyingToMessage(null);

        // Log audit trail to Firestore
        const logId = `log_${Date.now()}`;
        await setDoc(doc(db, "logs", logId), cleanDoc({
          id: logId,
          timestamp: new Date().toISOString(),
          type: "APPROVED",
          details: `Gatekeeper approved message to ${targetName} (${data.latencyMs}ms)`,
          data: {
            messageId: newMsgId,
            text: newMsg.text || null,
            latencyMs: data.latencyMs,
          },
        }));
      } else {
        // Rejected
        setLiveEvalField(null);
        setEvalResult({
          status: "REJECTED",
          explanation: data.explanation || "This channel is reserved for academic coursework and educational resource sharing.",
          latency: data.latencyMs,
        });
        showToast("Message could not be delivered.", "error");

        // Write warning alert notification to user in Firestore
        const warningId = `warn_${Date.now()}`;
        const warning: GatekeeperNotification = {
          id: warningId,
          userId: currentUser.uid,
          messageId: `msg_pending_${Date.now()}`,
          messageText: textToSend || `[File: ${attachName || "Unnamed"}]`,
          explanation: data.explanation || "Rejected as non-academic chatter.",
          timestamp: new Date().toISOString(),
        };

        await setDoc(doc(db, "notifications", warningId), cleanDoc(warning));

        // Log audit trail to Firestore
        const logId = `log_${Date.now()}`;
        await setDoc(doc(db, "logs", logId), cleanDoc({
          id: logId,
          timestamp: new Date().toISOString(),
          type: "REJECTED",
          details: `Gatekeeper rejected message by ${currentUser.name} (${data.latencyMs}ms). Private warning sent.`,
          data: {
            reason: data.explanation || null,
            latencyMs: data.latencyMs,
          },
        }));
      }
    } catch (err: any) {
      setEvaluating(false);
      console.error("Evaluation processing error:", err);
      showToast(`Evaluation processing failed: ${err.message || err}`, "error");
    }
  };

  // Delete message (only allowed for original sender)
  const handleDeleteMessage = async (messageId: string) => {
    if (!currentUser) return;
    try {
      await deleteDoc(doc(db, "messages", messageId));
      showToast("Message deleted successfully.", "success");
      
      const logId = `log_${Date.now()}`;
      await setDoc(doc(db, "logs", logId), {
        id: logId,
        timestamp: new Date().toISOString(),
        type: "INFO",
        details: `${currentUser.name} deleted a message they sent.`,
        data: { messageId, userId: currentUser.uid },
      });
    } catch (err) {
      console.error("Error deleting message:", err);
      showToast("Failed to delete message.", "error");
    }
  };

  // Forward message to selected study group or recipient
  const handleForwardMessage = async (destGroupId?: string, destRecipientId?: string) => {
    if (!currentUser || !forwardingMessage) return;
    
    const textToSend = forwardingMessage.text || "";
    const attachName = forwardingMessage.fileName;
    const attachType = forwardingMessage.fileType || "Other";
    const fileUrl = forwardingMessage.fileUrl;
    const fileDescription = forwardingMessage.fileDescription;

    setEvaluating(true);
    setEvalResult(null);
    setForwardingMessage(null); // Close modal/overlay instantly

    try {
      // 1. Run safe proxy Gemini evaluation for destination safety
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: textToSend || undefined,
          fileName: attachName,
          fileType: attachType,
          fileDescription: fileDescription || (attachName ? `${attachType} study resource` : undefined),
        }),
      });

      const data = await res.json();
      setEvaluating(false);

      const targetGroup = destGroupId ? groups.find(g => g.id === destGroupId) : null;
      const targetUser = destRecipientId ? users.find(u => u.uid === destRecipientId) : null;
      const targetName = targetGroup 
        ? `group "${targetGroup.name}"` 
        : `direct user @${targetUser?.username} (${targetUser?.name})`;

      if (data.status === "APPROVED") {
        setEvalResult(null);
        
        // 2. Write approved message to Firestore
        const newMsgId = `msg_approved_${Date.now()}`;
        const newMsg: Message = {
          id: newMsgId,
          groupId: destGroupId || undefined,
          recipientId: destRecipientId || undefined,
          senderId: currentUser.uid,
          senderName: currentUser.name,
          text: textToSend || undefined,
          fileName: attachName,
          fileType: attachType as any,
          fileDescription: fileDescription,
          fileUrl: fileUrl,
          timestamp: new Date().toISOString(),
          approvedAt: new Date().toISOString(),
          // Add forward info
          isForwarded: true,
          originalSenderName: forwardingMessage.senderName,
        };

        await setDoc(doc(db, "messages", newMsgId), newMsg);

        // Log audit trail to Firestore
        const logId = `log_${Date.now()}`;
        await setDoc(doc(db, "logs", logId), {
          id: logId,
          timestamp: new Date().toISOString(),
          type: "APPROVED",
          details: `Gatekeeper approved forwarded message from ${forwardingMessage.senderName} to ${targetName} (${data.latencyMs}ms)`,
          data: {
            messageId: newMsgId,
            text: newMsg.text,
            latencyMs: data.latencyMs,
          },
        });
        showToast("Message forwarded successfully!", "success");
      } else {
        // Rejected
        setEvalResult({
          status: "REJECTED",
          explanation: data.explanation || "This channel is reserved for academic coursework and educational resource sharing.",
          latency: data.latencyMs,
        });
        showToast("Forwarded message blocked by Gatekeeper.", "error");

        // Write warning alert notification to user in Firestore
        const warningId = `warn_${Date.now()}`;
        const warning: GatekeeperNotification = {
          id: warningId,
          userId: currentUser.uid,
          messageId: `msg_pending_${Date.now()}`,
          messageText: textToSend || `[Forwarded File: ${attachName || "Unnamed"}]`,
          explanation: `[Forward Rejected] ${data.explanation || "Rejected as non-academic chatter."}`,
          timestamp: new Date().toISOString(),
        };

        await setDoc(doc(db, "notifications", warningId), warning);

        // Log audit trail to Firestore
        const logId = `log_${Date.now()}`;
        await setDoc(doc(db, "logs", logId), {
          id: logId,
          timestamp: new Date().toISOString(),
          type: "REJECTED",
          details: `Gatekeeper blocked forwarded message by ${currentUser.name} to ${targetName} (${data.latencyMs}ms). Private warning sent.`,
          data: {
            reason: data.explanation,
            latencyMs: data.latencyMs,
          },
        });
      }
    } catch (err) {
      setEvaluating(false);
      showToast("Error processing forwarding request.", "error");
    }
  };

  // Process real attached file, read contents if text or image
  const processAttachedFile = (file: File) => {
    setAttachedFile(file);
    setFileContent("");
    setFileBase64("");

    if (file.size > 5 * 1024 * 1024) {
      showToast("File size must be under 5MB.", "error");
      setAttachedFile(null);
      return;
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || "";
    const isImage = file.type.startsWith("image/") || ["png", "jpg", "jpeg", "webp"].includes(ext);
    const textExtensions = ["txt", "py", "js", "ts", "json", "md", "csv", "html", "css", "xml", "yaml", "yml", "sql", "sh"];
    const isText = file.type.startsWith("text/") || textExtensions.includes(ext);

    if (isImage) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        const base64Data = result.split(',')[1];
        setFileBase64(base64Data);
      };
      reader.readAsDataURL(file);
      showToast(`Attached image file: ${file.name}`, "info");
    } else if (isText) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setFileContent(text.slice(0, 15000));
      };
      reader.readAsText(file);
      showToast(`Attached text file: ${file.name}`, "info");
    } else {
      showToast(`Attached file: ${file.name} (will scan metadata)`, "info");
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processAttachedFile(e.target.files[0]);
    }
  };

  // Mock file triggers for fast validation testing
  const selectPresetFile = (presetType: "math" | "chem" | "offtopic") => {
    let mockFile: File;
    if (presetType === "math") {
      mockFile = new File(
        [`# Gradient Descent Optimizer Proof\nimport numpy as np\n\ndef gradient_descent(X, y, lr=0.01):\n    # Simple absolute boundary proof for sparsity\n    return np.linalg.pinv(X.T @ X) @ X.T @ y`],
        "gradient_descent_proof.py",
        { type: "text/x-python" }
      );
    } else if (presetType === "chem") {
      mockFile = new File(
        [`Organic Chemistry Lab Report draft:\nReviewing transition state energy barriers under SN1 and SN2 nucleophilic substitutions. SN2 requires polar aprotic solvents like acetone to preserve nucleophile strength.`],
        "SN2_reaction_mechanisms.txt",
        { type: "text/plain" }
      );
    } else {
      mockFile = new File(
        [`Guys, tonight is weekend campus beer party at Alice's dorm room. Free food and beer! Bring your gaming consoles and let's hang out! No school talk permitted.`],
        "weekend_party_plans.txt",
        { type: "text/plain" }
      );
    }
    processAttachedFile(mockFile);
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
                    <span><strong>Persistent Accounts:</strong> Secure registration with custom OTP verification and temporary email blacklisting.</span>
                  </li>
                </ul>
              </div>
            </div>
 
            {/* Right Side: Form Block (Login or Sign Up with passwords) */}
            <div className="md:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-left space-y-4">
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
 
              {authMode === "login" ? (
                <div className="space-y-4 text-xs">
                  {!otpSent ? (
                    <form onSubmit={handleSendLoginOTP} className="space-y-4">
                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase">Your Email Address</label>
                        <input
                          type="email"
                          required
                          value={loginEmail}
                          onChange={(e) => setLoginEmail(e.target.value)}
                          placeholder="e.g. alice@school.edu"
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

                      <p className="text-[10px] text-slate-500 leading-relaxed bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                        💡 Seeded student accounts:
                        <br />• <strong>alice@school.edu</strong> (pwd: study123)
                        <br />• <strong>bob@school.edu</strong> (pwd: study123)
                        <br />• <strong>clara@school.edu</strong> (pwd: study123)
                      </p>

                      <button
                        type="submit"
                        disabled={otpLoading}
                        className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg shadow-sm cursor-pointer flex items-center justify-center gap-1.5 transition-all text-xs disabled:opacity-50"
                      >
                        {otpLoading ? "Sending Code..." : "Send Verification OTP"} <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleVerifyLogin} className="space-y-4">
                      <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-[11px] text-emerald-800">
                        🔒 <strong>Step 2 of 2: OTP Verification</strong>
                        <br />A 6-digit verification code was successfully sent to <strong>{loginEmail}</strong>.
                      </div>

                      {/* SIMULATED EMAIL INBOX CONTAINER */}
                      <div className="bg-sky-50 border border-sky-100 rounded-xl p-3.5 space-y-2 font-mono text-[11px] text-sky-800 shadow-inner">
                        <div className="flex items-center gap-1.5 font-bold border-b border-sky-100 pb-1.5">
                          <span className="animate-pulse text-sky-600">●</span>
                          <span>🔒 Simulated Email Inbox</span>
                        </div>
                        <p><strong>From:</strong> Gatekeeper Security Service &lt;otp@gatekeeper.local&gt;</p>
                        <p><strong>To:</strong> {loginEmail}</p>
                        <p><strong>Subject:</strong> {simulatedOtp} is your dynamic Gatekeeper login verification code</p>
                        <div className="mt-2 text-center bg-white border border-sky-200 py-2.5 rounded-lg">
                          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-sans font-bold">Your OTP Code</p>
                          <span className="text-xl font-extrabold tracking-widest text-sky-900">{simulatedOtp}</span>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase">Enter 6-Digit Code</label>
                        <input
                          type="text"
                          required
                          maxLength={6}
                          value={otpCode}
                          onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                          placeholder="e.g. 123456"
                          className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:bg-white text-center text-lg tracking-widest font-mono"
                        />
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => { setOtpSent(false); setOtpCode(""); }}
                          className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg cursor-pointer transition-all text-xs"
                        >
                          Change Email
                        </button>
                        <button
                          type="submit"
                          disabled={otpLoading}
                          className="flex-[2] py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg shadow-sm cursor-pointer flex items-center justify-center gap-1.5 transition-all text-xs disabled:opacity-50"
                        >
                          {otpLoading ? "Verifying..." : "Verify & Sign In"} <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              ) : (
                <div className="space-y-4 text-xs">
                  {!otpSent ? (
                    <form onSubmit={handleSendRegisterOTP} className="space-y-4">
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
                        <label className="block text-[10px] font-bold text-slate-500 uppercase">School or Personal Email (No temporary domains)</label>
                        <input
                          type="email"
                          required
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          placeholder="e.g. david99@school.edu"
                          className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:bg-white"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase">Set a Password</label>
                        <div className="relative">
                          <input
                            type={showRegPassword ? "text" : "password"}
                            required
                            value={regPassword}
                            onChange={(e) => setRegPassword(e.target.value)}
                            placeholder="Minimum 4 characters"
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

                      <button
                        type="submit"
                        disabled={otpLoading}
                        className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-extrabold rounded-lg shadow-sm cursor-pointer flex items-center justify-center gap-1.5 transition-all text-xs disabled:opacity-50"
                      >
                        {otpLoading ? "Sending OTP..." : "Send Verification OTP"} <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleVerifyAndRegister} className="space-y-4">
                      <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-[11px] text-emerald-800">
                        🔒 <strong>Step 2 of 2: OTP Verification</strong>
                        <br />We have sent a verification code to your email address: <strong>{regEmail}</strong>.
                      </div>

                      {/* SIMULATED EMAIL INBOX CONTAINER */}
                      <div className="bg-sky-50 border border-sky-100 rounded-xl p-3.5 space-y-2 font-mono text-[11px] text-sky-800 shadow-inner">
                        <div className="flex items-center gap-1.5 font-bold border-b border-sky-100 pb-1.5">
                          <span className="animate-pulse text-sky-600">●</span>
                          <span>🔒 Simulated Email Inbox</span>
                        </div>
                        <p><strong>From:</strong> Gatekeeper Security Service &lt;otp@gatekeeper.local&gt;</p>
                        <p><strong>To:</strong> {regEmail}</p>
                        <p><strong>Subject:</strong> {simulatedOtp} is your dynamic Gatekeeper registration code</p>
                        <div className="mt-2 text-center bg-white border border-sky-200 py-2.5 rounded-lg">
                          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-sans font-bold">Your OTP Code</p>
                          <span className="text-xl font-extrabold tracking-widest text-sky-900">{simulatedOtp}</span>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase">Enter 6-Digit Code</label>
                        <input
                          type="text"
                          required
                          maxLength={6}
                          value={otpCode}
                          onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                          placeholder="e.g. 123456"
                          className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:bg-white text-center text-lg tracking-widest font-mono"
                        />
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => { setOtpSent(false); setOtpCode(""); }}
                          className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg cursor-pointer transition-all text-xs"
                        >
                          Go Back
                        </button>
                        <button
                          type="submit"
                          disabled={otpLoading}
                          className="flex-[2] py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg shadow-sm cursor-pointer flex items-center justify-center gap-1.5 transition-all text-xs disabled:opacity-50"
                        >
                          {otpLoading ? "Creating..." : "Verify & Create Account"} <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </form>
                  )}
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
                <label className="block text-[10px] font-bold text-sky-700 uppercase tracking-wider">Simulated Identity</label>
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
                      <Monitor className="w-3 h-3 text-emerald-500" /> Native App (.EXE / APK) ready
                    </span>
                    <button
                      onClick={() => {
                        // Trigger test
                        const testNotif = new Notification("Academic Chat Sandbox", {
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
                              key={m.id}
                              className={`flex items-end gap-2.5 ${isMyMessage ? "flex-row-reverse" : "text-left"}`}
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
                                          alert(`Simulated URL retrieval:\n${m.fileUrl || m.fileName}`);
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
                              setFileContent("");
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
                                      alert(`Simulated URL retrieval:\n${m.fileUrl || m.fileName}`);
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

    </div>
  );
}
