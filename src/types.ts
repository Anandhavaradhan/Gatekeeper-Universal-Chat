export interface User {
  uid: string;
  name: string;
  username: string;
  password?: string;
  email?: string;
  emailVerified?: boolean;
  groups: string[];
}

export interface Group {
  id: string;
  name: string;
  description: string;
  members: string[];
  createdBy?: string;
}

export interface Message {
  id: string;
  groupId?: string; // Optional for direct messages
  recipientId?: string; // Set for one-on-one direct messages
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
  friendlyPoliteFilter?: boolean;
  // Reply fields
  replyToId?: string;
  replyToSenderName?: string;
  replyToText?: string;
  // Forward fields
  isForwarded?: boolean;
  originalSenderName?: string;
}

export interface Notification {
  id: string;
  userId: string;
  messageId: string;
  messageText: string;
  explanation: string;
  timestamp: string;
}

export interface GatekeeperLog {
  id: string;
  timestamp: string;
  type: "PENDING" | "APPROVED" | "REJECTED" | "INFO";
  details: string;
  data: any;
}

export interface AppConfig {
  geminiActive: boolean;
  apiModel: string;
  fallbackEnabled: boolean;
}
