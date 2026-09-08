export type Platform = 'twitter' | 'instagram' | 'reddit';

export type MediaType = 'image' | 'video' | 'gif';

export interface MediaQuality {
  label: string;
  url: string;
  width?: number;
  height?: number;
  bitrate?: number;
}

export interface MediaItem {
  id: string;
  platform: Platform;
  type: MediaType;
  url: string;
  ext?: string;
  extension?: string;
  quality?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  audioUrl?: string;
  isDashMuxRequired?: boolean;
  index?: number;
  total?: number;
  author?: string;
  title?: string;
  caption?: string;
  filename?: string;
  thumbnailUrl?: string;
  qualities?: MediaQuality[];
  timestamp?: number;
}

export type ExtractedMediaItem = MediaItem;

export interface PostMetadata {
  id: string;
  platform: Platform;
  author: string;
  title?: string;
  caption?: string;
  media: MediaItem[];
  timestamp?: number;
  url?: string;
}

export interface UserSettings {
  subfolder: string;
  filenameTemplate: string;
  autoDownloadAllCarousel: boolean;
}

export interface DownloadHistoryItem {
  id: string;
  platform: Platform;
  author: string;
  filename: string;
  timestamp: number;
  thumbnailUrl?: string;
  status: 'completed' | 'failed';
}

export type ExtensionMessage =
  | { action: 'DOWNLOAD_MEDIA'; payload?: { media: MediaItem[]; post?: PostMetadata }; items?: MediaItem[]; forceAll?: boolean; explicit?: boolean; }
  | { action: 'GET_SETTINGS' }
  | { action: 'SAVE_SETTINGS'; payload?: Partial<UserSettings>; settings?: Partial<UserSettings> }
  | { action: 'GET_HISTORY' }
  | { action: 'CLEAR_HISTORY' }
  | { action: 'MUX_DASH'; payload: { videoUrl: string; audioUrl: string; filename?: string } }
  | { action: 'CURRENT_PAGE_DETECT'; payload?: { platform?: Platform } }
  | { action: 'DOWNLOAD_CURRENT_PAGE' };
