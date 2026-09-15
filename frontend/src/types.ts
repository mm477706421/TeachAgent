export interface User {
  id: string;
  username: string;
  name: string;
  role: "admin" | "teacher";
}
export interface Metrics {
  characters: number;
  segments: number;
  questions: number;
  interactions: number;
  speech_rate: number;
  labeled_student_segments: number;
}
export interface Segment {
  id: number;
  start: number;
  end: number;
  text: string;
  stage: string;
  speaker: string;
  question: boolean;
  interaction: boolean;
  timing: string;
}
export interface Suggestion {
  priority: string;
  title: string;
  evidence: string;
  action: string;
  segment_id: number;
}
export interface Analysis {
  summary: string;
  engine: string;
  duration: number;
  metrics: Metrics;
  segments: Segment[];
  timeline: {
    name: string;
    start: number;
    end: number;
    segment_ids: number[];
  }[];
  distribution: { name: string; seconds: number; percent: number }[];
  questions: { segment_id: number; start: number; text: string }[];
  interactions: { segment_id: number; start: number; text: string }[];
  fillers: { word: string; count: number }[];
  rhythm: {
    start: number;
    questions: number;
    interactions: number;
    characters: number;
  }[];
  suggestions: Suggestion[];
  limitations: string[];
}
export interface Lesson {
  id: string;
  user_id: string;
  title: string;
  subject: string;
  class_name: string;
  filename?: string;
  status: string;
  progress: number;
  stage: string;
  error?: string;
  duration: number;
  example: number;
  created: number;
  metrics?: Metrics;
  analysis?: Analysis | null;
  frames?: string[];
  has_video?: boolean;
}
export interface Message {
  role: string;
  content: string;
  engine?: string;
  created?: number;
}
export interface System {
  local_only: boolean;
  asr_ready: boolean;
  ffmpeg_ready: boolean;
  ffprobe_ready: boolean;
  probe_backend: string;
  asr_device: string;
  max_upload_mb: number;
  chat_model: string;
  chat_mode: string;
  disk_free_gb: number;
}
