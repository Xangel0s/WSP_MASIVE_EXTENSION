export interface Contact {
  id: string;
  phone: string;
  name?: string;
  business?: string;
  location?: string;
}

export interface MessageVariation {
  id: string;
  label: string;
  content: string;
  media?: {
    dataUrl: string;
    fileName: string;
    mimeType: string;
  };
}

export interface SendingParams {
  mode: "automatic" | "human";
  delay: number;
  sessionLimit: number;
  autoRetry: boolean;
  variationEvery: number;
  variationMode: "sequential" | "random";
}

export interface ActivityEntry {
  id: string;
  phone: string;
  message: string;
  status: "pending" | "sent" | "failed";
  timestamp: Date;
}

export interface CampaignState {
  contacts: Contact[];
  messages: MessageVariation[];
  params: SendingParams;
  activity: ActivityEntry[];
  status: "idle" | "running" | "paused" | "completed";
}
